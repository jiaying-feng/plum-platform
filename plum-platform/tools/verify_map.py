# -*- coding: utf-8 -*-
"""
Offline acceptance for the upgraded map widget, plus device-pixel previews.

    python tools/verify_map.py
    -> tools/map_device_2x.png   (694 x 320 device px, 1rpx = 1px)
    -> tools/map_device_3x.png   (1041 x 480 device px, 1rpx = 1.5px)

Checks the asset contract, the WXML/WXSS wiring, and that the pin anchors in
index.js stay in sync with the farmsteads painted into the basemap. No network,
no WeChat DevTools, no backend required.
"""
from pathlib import Path
import json
import re
import subprocess
import sys

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
import gen_map_base as G

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
MP = ROOT / "mp-weixin"
IMG = MP / "images" / "map_base.jpg"
WXML = MP / "pages" / "index" / "index.wxml"
WXSS = MP / "app.wxss"
INDEXJS = MP / "pages" / "index" / "index.js"
GEN = TOOLS / "gen_map_base.py"

EXPECTED_W, EXPECTED_H = 2082, 960
BOX_RATIO = 694 / 320
MAX_BYTES = 600 * 1024

failures = []

# Loads the real page module with a minimal wx shim and calls apply() twice.
RUNTIME_JS = r"""
const store = {};
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getStorageInfoSync: () => ({ keys: [], currentSize: 0, limitSize: 10240 }),
  showToast: () => {}, hideToast: () => {}, navigateTo: () => {}, switchTab: () => {},
  request: () => { throw new Error('map must not need network'); }
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {}, setListType() {}, bumpData() {} });
let page = null;
global.Page = (d) => { page = d; };
require(process.argv[1]);
let data = {};
page.setData = (o) => { data = o; };
function run(ids) {
  const d = { orchards: ids.map((id, i) => ({
    id: id, name: 'orchard' + id, lng: 103.42 + i * 0.009, lat: 30.58 + i * 0.006
  })) };
  page.apply(d, false);
  return data.pins.map((p) => [p.left, p.top]);
}
console.log('MAPJSON' + JSON.stringify({ mock: run([1,2,3,4,5,6]), local: run([1,2,3,4,5]) }));
"""


def check(name, ok, detail=""):
    print(("  OK   " if ok else "  FAIL ") + name + (" | " + detail if detail else ""))
    if not ok:
        failures.append(name)


def anchors_of(path):
    # Both files declare a multi-line list closed by a ']' on its own line;
    # a lazy `.*?]` would stop at the first nested pair in the JS version.
    m = re.search(r"PIN_ANCHORS\s*=\s*\[(.*?)^\s*\]",
                  path.read_text(encoding="utf-8"), re.S | re.M)
    if not m:
        return []
    return [float(v) for v in re.findall(r"-?\d+\.\d+", m.group(1))]


def contract_checks():
    print("\n[1] Basemap asset")
    check("local basemap exists", IMG.is_file(), str(IMG))
    if not IMG.is_file():
        return
    im = Image.open(IMG)
    check("decodes as JPEG 2082x960", im.format == "JPEG" and im.size == (EXPECTED_W, EXPECTED_H),
          "%s %s" % (im.format, im.size))
    ratio = im.size[0] / im.size[1]
    check("aspect matches WXSS box 694:320", abs(ratio - BOX_RATIO) < 0.001,
          "%.6f vs %.6f" % (ratio, BOX_RATIO))
    check("3x resolution covers @3x devices", im.size[0] >= 1041 and im.size[1] >= 480)
    n = IMG.stat().st_size
    check("package cost under 600 KB", n < MAX_BYTES, "%d bytes" % n)

    print("\n[2] WXML / WXSS wiring")
    wxml = WXML.read_text(encoding="utf-8")
    wxss = WXSS.read_text(encoding="utf-8")
    m = re.search(r"<image[^>]*map_base[^>]*>", wxml)
    check("basemap referenced by a local absolute path",
          bool(m) and 'src="/images/map_base.jpg"' in m.group(0))
    check("image tag is self-closing (smoke VOID rule)", bool(m) and m.group(0).endswith("/>"))
    check("basemap does NOT go through config.asset()", "{{" not in (m.group(0) if m else "{{"))
    block = wxml[wxml.find('<view class="map">'):wxml.find("镇上的节庆")]
    check("no network image in map block", "http://" not in block and "https://" not in block)
    check("CSS pseudo-river/road removed", 'class="river"' not in block and 'class="road"' not in block)
    check("map-bg is absolutely stretched", ".map-bg" in wxss and ".map .pin" in wxss)
    check("cartographic overlays present",
          all(k in wxss for k in (".map-label", ".map-north", ".map-scale", ".legend-row")))
    check("onPin handler retained", 'bindtap="onPin"' in wxml and "onPin(e)" in INDEXJS.read_text(encoding="utf-8"))

    print("\n[3] Pin anchor contract")
    a_js, a_gen = anchors_of(INDEXJS), anchors_of(GEN)
    check("6 anchors declared in both files",
          len(a_js) == 12 and len(a_gen) == 12, "js=%d gen=%d" % (len(a_js), len(a_gen)))
    check("anchors identical", a_js == a_gen)
    pairs = [tuple(a_js[i:i + 2]) for i in range(0, len(a_js), 2)]
    check("all anchors inside the safe area",
          all(8 <= x <= 92 and 12 <= y <= 86 for x, y in pairs))
    # mock serves ids 1..6, Flask /home serves ids 1..5 (6th is 'pending review').
    check("mock (6 pins) and local (5 pins) both resolve by id",
          all(1 <= i <= len(pairs) for i in range(1, 7)))
    gaps = []
    for i in range(len(pairs)):
        for j in range(i + 1, len(pairs)):
            gaps.append(((pairs[i][0] - pairs[j][0]) ** 2
                         + (pairs[i][1] - pairs[j][1]) ** 2) ** 0.5)
    check("pins do not collide (>=14% apart)", bool(gaps) and min(gaps) >= 14,
          ("min gap %.1f%%" % min(gaps)) if gaps else "no pairs")

    print("\n[4] Real apply() output (Node, no DevTools)")
    expected = [["%.1f" % x, "%.1f" % y] for x, y in pairs]
    try:
        p = subprocess.run(["node", "-e", RUNTIME_JS, str(INDEXJS.resolve())],
                           capture_output=True, text=True, cwd=str(ROOT),
                           encoding="utf-8", timeout=30)
        line = next((l for l in (p.stdout or "").splitlines() if l.startswith("MAPJSON")), "")
        got = json.loads(line[len("MAPJSON"):]) if line else {}
        check("index.js loads without wx APIs", p.returncode == 0 and bool(got),
              (p.stderr or "").strip()[:120])
        check("mock 6 pins match basemap farmsteads",
              got.get("mock") == expected, str(got.get("mock")))
        check("local 5 pins match basemap farmsteads",
              got.get("local") == expected[:5], str(got.get("local")))
        check("left/top stay strings for WXML percent binding",
              all(isinstance(v, str) for row in got.get("mock", []) for v in row))
    except (OSError, ValueError, StopIteration, subprocess.TimeoutExpired) as exc:
        check("runtime apply() probe", False, str(exc))
    print("\n[5] Device-pixel previews")


def R(v, scale):
    return max(1, int(round(v * scale)))


def text(d, xy, value, size, color, scale, stroke=2):
    f = G.font(R(size, scale))
    d.text(xy, value, font=f, fill=color,
           stroke_width=R(stroke, scale), stroke_fill=(255, 255, 255, 230))


def render(DW, DH, scale, out):
    base = Image.open(IMG).convert("RGB").resize((DW, DH), Image.Resampling.LANCZOS).convert("RGBA")
    layer = Image.new("RGBA", (DW, DH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    for xy, value, color in [
        ((0.255, 0.52), "䢺江", (40, 86, 122)),
        ((0.660, 0.68), "大双路", (108, 88, 60)),
        ((0.455, 0.435), "老街", (92, 76, 56)),
        ((0.800, 0.15), "青梅谷", (52, 92, 58)),
    ]:
        text(d, (int(DW * xy[0]), int(DH * xy[1])), value, 20, color, scale)

    # North arrow: right 22rpx / top 12rpx.
    nx = DW - R(22, scale) - R(9, scale)
    ny = R(12, scale)
    text(d, (nx - R(6, scale), ny), "N", 20, (44, 62, 48), scale)
    ay = ny + R(24, scale)
    d.polygon([(nx, ay), (nx - R(9, scale), ay + R(24, scale)),
               (nx + R(9, scale), ay + R(24, scale))],
              fill=(46, 62, 48, 245), outline=(255, 255, 255, 230))

    # Pins: 40rpx disc with 4rpx white rim, 58rpx halo, 64x56rpx hit area.
    for i, (left, top) in enumerate(G.PIN_ANCHORS):
        cx, cy = int(DW * left / 100), int(DH * top / 100)
        hr = R(29, scale)
        hy = cy - R(25, scale)
        d.ellipse((cx - hr, hy - hr, cx + hr, hy + hr), fill=(63, 143, 82, 52))
        dr = R(20, scale)
        d.ellipse((cx - dr, cy - R(40, scale), cx + dr, cy),
                  fill=(63, 143, 82, 255), outline=(255, 255, 255, 255), width=R(4, scale))
        f = G.font(R(21, scale))
        s = str(i + 1)
        b = d.textbbox((0, 0), s, font=f)
        d.text((cx - (b[2] - b[0]) / 2, cy - R(20, scale) - (b[3] - b[1]) / 2 - R(3, scale)),
               s, font=f, fill=(255, 255, 255, 255))

    # Legend card: left 16rpx / bottom 12rpx.
    lw, lh = R(232, scale), R(52, scale)
    lx, ly = R(16, scale), DH - R(12, scale) - lh
    d.rounded_rectangle((lx, ly, lx + lw, ly + lh), radius=R(10, scale),
                        fill=(255, 255, 255, 232))
    ky = ly + R(14, scale)
    kd = R(7, scale)
    d.ellipse((lx + R(12, scale), ky - kd, lx + R(12, scale) + 2 * kd, ky + kd),
              fill=(63, 143, 82, 255), outline=(255, 255, 255, 255), width=R(2, scale))
    text(d, (lx + R(30, scale), ky - R(10, scale)), "采摘园", 18, (74, 90, 76), scale, 1)
    d.rounded_rectangle((lx + R(92, scale), ky - R(3, scale),
                         lx + R(118, scale), ky + R(3, scale)),
                        radius=R(3, scale), fill=(214, 190, 132, 255))
    text(d, (lx + R(124, scale), ky - R(10, scale)), "道路", 18, (74, 90, 76), scale, 1)
    d.rounded_rectangle((lx + R(164, scale), ky - R(3, scale),
                         lx + R(190, scale), ky + R(3, scale)),
                        radius=R(3, scale), fill=(118, 172, 196, 255))
    text(d, (lx + R(196, scale), ky - R(10, scale)), "水系", 18, (74, 90, 76), scale, 1)
    text(d, (lx + R(12, scale), ly + R(28, scale)),
         "䢺江镇地形示意 · 6 个采摘点", 17, (121, 133, 124), scale, 1)

    # Scale bar: right 20rpx / bottom 12rpx, 0 - 500 m.
    sw, sh = R(128, scale), R(38, scale)
    sx, sy = DW - R(20, scale) - sw, DH - R(12, scale) - sh
    d.rounded_rectangle((sx, sy, sx + sw, sy + sh), radius=R(8, scale),
                        fill=(255, 255, 255, 232))
    bw = R(108, scale)
    bx, by = sx + R(10, scale), sy + R(8, scale)
    d.rectangle((bx, by, bx + bw, by + R(8, scale)), outline=(60, 78, 62, 255), width=1)
    d.rectangle((bx, by, bx + bw // 2, by + R(8, scale)), fill=(60, 78, 62, 255))
    text(d, (bx, by + R(10, scale)), "0", 16, (74, 90, 76), scale, 1)
    text(d, (bx + R(64, scale), by + R(10, scale)), "500 m", 16, (74, 90, 76), scale, 1)

    Image.alpha_composite(base, layer).convert("RGB").save(out, "PNG", optimize=True)
    print("  WROTE %s (%dx%d, rpx scale %.1f)" % (out.name, DW, DH, scale))


def main():
    contract_checks()
    render(694, 320, 1.0, TOOLS / "map_device_2x.png")
    render(1041, 480, 1.5, TOOLS / "map_device_3x.png")
    print("\n" + ("ALL MAP CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
