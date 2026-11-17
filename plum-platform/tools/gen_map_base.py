# -*- coding: utf-8 -*-
"""
Build-time generator for the offline high-fidelity terrain basemap.

Runtime dependency: NONE. The output is a single plain JPEG bundled inside the
mini program package; the mini program never contacts a map service.

    python tools/gen_map_base.py
    -> mp-weixin/images/map_base.jpg
    -> tools/map_preview.png   (WYSIWYG preview of the WXML overlay)

Canvas: 2082 x 960 = 3x of the WXSS box 694rpx x 320rpx (ratio 2.16875:1),
so `mode="scaleToFill"` stretches nothing on any rpx-scaled device.

Cartographic layers, back to front:
  hypsometric tint + hillshade + contours  ->  farmland strips
  ->  woodland / plum-grove canopy  ->  river + tributaries
  ->  trunk road / country lanes / footpaths  ->  bridges
  ->  villages and the six orchard farmsteads  ->  grid + vignette
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_JPG = ROOT / "mp-weixin" / "images" / "map_base.jpg"
OUT_PREVIEW = ROOT / "tools" / "map_preview.png"

W, H = 2082, 960
SS = 2
VW, VH = W * SS, H * SS
RESAMPLE = Image.Resampling.LANCZOS

# Normalized (left%, top%) anchors of the six orchard pins. Keep in sync with
# PIN_ANCHORS in mp-weixin/pages/index/index.js. Each anchor sits on a farmstead
# drawn into the basemap (see draw_farmstead).
PIN_ANCHORS = [
    (15.5, 70.0),
    (31.0, 47.0),
    (44.5, 30.0),
    (55.0, 66.0),
    (73.0, 33.0),
    (86.5, 53.0),
]

PIN_NAMES = [
    "䢺江青梅采摘园", "青梅谷生态果园", "梅香坡家庭农场",
    "大双路青梅园", "山顶老梅林", "青梅溪畔果园",
]


# --------------------------------------------------------------------------
# Terrain
# --------------------------------------------------------------------------
def value_noise(gx, gy, seed):
    r = np.random.default_rng(seed)
    nodes = r.random((gy, gx)).astype(np.float32)
    im = Image.fromarray((nodes * 255).astype(np.uint8))
    im = im.resize((W, H), Image.Resampling.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def fbm(seed, octaves=5):
    acc = np.zeros((H, W), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        acc += amp * value_noise(3 * (2 ** o) + 2, 2 * (2 ** o) + 2, seed + o * 977)
        total += amp
        amp *= 0.52
    return acc / total


def river_y(t):
    t = np.asarray(t, dtype=np.float32)
    return (0.620 - 0.220 * t
            + 0.055 * np.sin(2 * np.pi * (1.05 * t + 0.06))
            + 0.022 * np.sin(2 * np.pi * (2.30 * t + 0.30)))


def build_terrain():
    ny, nx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx /= W
    ny /= H

    def hill(cx, cy, sx, sy, amp):
        return amp * np.exp(-(((nx - cx) / sx) ** 2 + ((ny - cy) / sy) ** 2))

    ridge = (hill(0.08, 0.00, 0.30, 0.55, 0.62)
             + hill(0.42, -0.12, 0.27, 0.44, 0.42)
             + hill(0.90, 1.04, 0.34, 0.54, 0.68)
             + hill(0.68, 0.06, 0.22, 0.30, 0.22))

    dist = np.abs(ny - river_y(nx))
    valley = 0.52 * np.exp(-(dist / 0.115) ** 2)

    elev = (0.15 + ridge + 0.22 * fbm(20261113)
            + 0.055 * fbm(88117, 3) - valley)
    elev = (elev - elev.min()) / (elev.max() - elev.min())

    # Hillshade: light from NW (azimuth 315deg, altitude 45deg).
    gy, gx = np.gradient(elev.astype(np.float32))
    sx, sy = -gx * 260.0, -gy * 260.0
    inv = 1.0 / np.sqrt(sx * sx + sy * sy + 1.0)
    az, alt = np.deg2rad(315.0), np.deg2rad(45.0)
    lx = np.cos(alt) * np.sin(az)
    ly = -np.cos(alt) * np.cos(az)
    lz = np.sin(alt)
    shade = np.clip((sx * lx + sy * ly + lz) * inv, 0.0, 1.0)

    # Hypsometric tint: humid valley green -> dry ridge grey-brown.
    stops = [
        (0.00, (196, 214, 176)), (0.16, (184, 206, 154)),
        (0.34, (169, 193, 132)), (0.52, (162, 180, 118)),
        (0.68, (170, 163, 114)), (0.82, (150, 140, 108)),
        (1.00, (124, 122, 110)),
    ]
    xs = [s[0] for s in stops]
    base = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        base[..., c] = np.interp(elev, xs, [s[1][c] for s in stops])
    base *= (0.68 + 0.52 * shade)[..., None]

    wet = np.exp(-(dist / 0.090) ** 2)[..., None]
    base = base * (1 - 0.12 * wet) + np.array([172, 202, 172], np.float32) * 0.12 * wet

    # Contours: minor every 1/18 of relief, index contour every fourth.
    lv = np.floor(elev * 18).astype(np.int16)
    edge = ((lv != np.roll(lv, -1, axis=1)) | (lv != np.roll(lv, -1, axis=0)))
    edge[:, -1] = False
    edge[-1, :] = False
    major = edge & (lv % 4 == 0)
    minor = edge & ~major

    def contour(mask, width, strength):
        im = Image.fromarray((mask * 255).astype(np.uint8))
        if width > 1:
            im = im.filter(ImageFilter.MaxFilter(width))
        a = np.asarray(im, dtype=np.float32) / 255.0 * strength
        return a[..., None]

    ink = np.array([88, 82, 64], np.float32)
    for m, w, s in ((minor, 3, 0.13), (major, 5, 0.22)):
        a = contour(m, w, s)
        base = base * (1 - a) + ink * a

    base += ((fbm(55501, 3) - 0.5) * 9)[..., None]

    # Grid + vignette.
    cx = (nx - 0.5) / 0.5
    cy = (ny - 0.5) / 0.5
    rad = np.sqrt(cx * cx + cy * cy) / 1.414
    base *= (1 - 0.15 * np.clip(rad, 0, 1) ** 1.6)[..., None]
    return np.clip(base, 0, 255).astype(np.uint8), nx, ny


# --------------------------------------------------------------------------
# Vector overlays (drawn at 2x then downsampled for antialiasing)
# --------------------------------------------------------------------------
def P(pt):
    return (int(round(pt[0] * VW)), int(round(pt[1] * VH)))


def S(px):
    return max(1, int(round(px * SS)))


def catmull(pts, steps=12):
    src = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(src) - 3):
        p0, p1, p2, p3 = src[i:i + 4]
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(pts[-1])
    return out


def line_px(d, pts, fill, width):
    d.line([P(p) for p in pts], fill=fill, width=S(width), joint="curve")


MAIN_ROAD = [
    (-0.03, 0.830), (0.10, 0.810), (0.24, 0.760), (0.38, 0.735),
    (0.52, 0.710), (0.66, 0.675), (0.82, 0.630), (1.03, 0.600),
]
CROSS_ROAD = [
    (0.545, 0.060), (0.552, 0.220), (0.566, 0.360),
    (0.578, 0.520), (0.590, 0.700), (0.610, 0.960),
]
LANE_NORTH = [
    (0.100, 0.810), (0.150, 0.640), (0.215, 0.450),
    (0.300, 0.290), (0.410, 0.170),
]
LANE_EAST = [
    (0.660, 0.675), (0.720, 0.540), (0.790, 0.420),
    (0.870, 0.340), (0.980, 0.290),
]

TRIBUTARIES = [
    [(0.175, 0.020), (0.192, 0.150), (0.212, 0.290), (0.238, 0.400)],
    [(0.470, 0.020), (0.482, 0.130), (0.500, 0.250), (0.515, 0.350)],
    [(0.790, 0.980), (0.810, 0.860), (0.830, 0.720), (0.845, 0.600)],
    [(0.930, 0.120), (0.918, 0.220), (0.900, 0.310), (0.885, 0.380)],
]

VILLAGES = [
    (0.130, 0.735, 26, 0.032, 0.022, 4401),
    (0.455, 0.585, 30, 0.036, 0.020, 4402),
    (0.785, 0.285, 22, 0.030, 0.020, 4403),
]

GROVES = [
    (0.220, 0.400, 0.130, 0.160, 300),
    (0.415, 0.290, 0.150, 0.140, 300),
    (0.660, 0.430, 0.140, 0.160, 280),
    (0.855, 0.560, 0.120, 0.150, 240),
    (0.335, 0.610, 0.090, 0.090, 140),
]
WOODS = [
    (0.090, 0.110, 0.150, 0.180, 420),
    (0.580, 0.075, 0.170, 0.110, 300),
    (0.930, 0.870, 0.160, 0.190, 380),
]


def to_curve(pts, steps=14):
    return catmull(pts, steps)


def draw_farmland(d):
    for cx, cy, rx, ry, tilt in [
        (0.285, 0.150, 0.105, 0.085, 0.16),
        (0.690, 0.830, 0.115, 0.080, -0.12),
        (0.930, 0.700, 0.070, 0.070, 0.20),
    ]:
        for k in range(9):
            t = k / 8.0 - 0.5
            yy = cy + t * ry
            pts = []
            for j in range(13):
                u = j / 12.0 - 0.5
                pts.append((cx + u * rx, yy + tilt * u * u * ry))
            line_px(d, pts, (222, 222, 168, 62), 3.0)
            line_px(d, [(x, y + 0.006) for x, y in pts], (108, 122, 78, 40), 1.4)


def draw_canopy(d, regions, colors, r0, r1, seed):
    r = np.random.default_rng(seed)
    for cx, cy, rx, ry, count in regions:
        x = r.normal(cx, rx * 0.46, count)
        y = r.normal(cy, ry * 0.46, count)
        rxr = np.abs(river_y(x))
        keep = ((x > 0.012) & (x < 0.988) & (y > 0.018) & (y < 0.982)
                & (np.abs(y - rxr) > 0.030))
        x, y = x[keep], y[keep]
        for fx, fy in zip(x, y):
            px, py = P((fx, fy))
            rr = S(r.uniform(r0, r1))
            c = colors[r.integers(0, len(colors))]
            d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=c)
            hl = S(r.uniform(0.9, 1.8))
            d.ellipse((px - rr - hl, py - rr - hl, px - rr // 2, py - rr // 2),
                      fill=(255, 255, 255, 28))


def draw_water(d):
    ts = np.linspace(-0.03, 1.03, 46)
    river = [(float(t), float(river_y(t))) for t in ts]
    line_px(d, river, (108, 132, 104, 150), 34)
    line_px(d, river, (96, 148, 174, 255), 27)
    line_px(d, river, (126, 178, 202, 255), 20)
    line_px(d, [(x, y - 0.005) for x, y in river], (176, 214, 228, 120), 7)

    for t in TRIBUTARIES:
        end_x = t[-1][0]
        pts = t + [(end_x + 0.010, float(river_y(end_x + 0.010)))]
        c = to_curve(pts)
        line_px(d, c, (112, 138, 108, 130), 17)
        line_px(d, c, (118, 172, 196, 255), 12)
        line_px(d, c, (156, 200, 218, 190), 5)
    return river


def draw_road(d, pts, width, center=False):
    c = to_curve(pts)
    line_px(d, c, (78, 76, 58, 90), width + 7)
    line_px(d, c, (198, 186, 152, 255), width + 3)
    line_px(d, c, (248, 241, 220, 255), width)
    if center:
        q = [P(p) for p in c]
        seg = 16
        for i in range(0, len(q) - seg, seg * 2):
            d.line(q[i:i + seg], fill=(196, 176, 132, 200), width=S(1.6))


def draw_footpaths(d):
    paths = [
        [(0.220, 0.400), (0.300, 0.440), (0.380, 0.500), (0.455, 0.585)],
        [(0.660, 0.430), (0.700, 0.540), (0.730, 0.640)],
        [(0.855, 0.560), (0.820, 0.630), (0.780, 0.710)],
    ]
    for p in paths:
        c = to_curve(p)
        q = [P(v) for v in c]
        for i in range(0, len(q) - 6, 14):
            d.line(q[i:i + 6], fill=(226, 216, 186, 190), width=S(1.8))


def draw_bridge(d, cx, cy, angle=0.0):
    x, y = P((cx, cy))
    w, h = S(40), S(15)
    d.rectangle((x - w // 2, y - h // 2, x + w // 2, y + h // 2),
                fill=(196, 190, 170, 255), outline=(110, 106, 90, 220), width=S(1.5))
    d.line((x - w // 2, y - h // 2 - S(2), x + w // 2, y - h // 2 - S(2)),
           fill=(238, 232, 212, 255), width=S(2))
    d.line((x - w // 2, y + h // 2 + S(2), x + w // 2, y + h // 2 + S(2)),
           fill=(238, 232, 212, 255), width=S(2))


def draw_buildings(d):
    r = np.random.default_rng(9091)
    roofs = [(176, 112, 88, 255), (150, 132, 108, 255),
             (206, 190, 158, 255), (138, 120, 100, 255)]

    def house(cx, cy, w, h):
        x, y = P((cx, cy))
        w, h = S(w), S(h)
        d.rectangle((x - w // 2 + S(2), y - h // 2 + S(3),
                     x + w // 2 + S(2), y + h // 2 + S(3)),
                    fill=(38, 44, 32, 95))
        roof = roofs[r.integers(0, len(roofs))]
        d.rectangle((x - w // 2, y - h // 2, x + w // 2, y + h // 2),
                    fill=roof, outline=(92, 82, 68, 210), width=S(1.2))
        d.line((x - w // 2, y - h // 2, x + w // 2, y - h // 2),
               fill=(240, 228, 200, 170), width=S(1.6))

    for cx, cy, n, sx, sy, seed in VILLAGES:
        rv = np.random.default_rng(seed)
        for i in range(n):
            fx = cx + rv.normal(0, sx)
            fy = cy + rv.normal(0, sy)
            if not (0.02 < fx < 0.98 and 0.03 < fy < 0.97):
                continue
            house(fx, fy, rv.uniform(9, 17), rv.uniform(7, 12))

    # Courtyard of the visitor centre.
    x0, y0 = P((0.128, 0.735))
    d.rectangle((x0 - S(34), y0 - S(20), x0 + S(34), y0 + S(20)),
                outline=(222, 210, 180, 220), width=S(2.2),
                fill=(214, 204, 172, 70))


def draw_farmstead(d, fx, fy, seed):
    """A small orchard compound so every pin lands on a real mapped feature."""
    r = np.random.default_rng(seed)
    cx, cy = P((fx, fy))
    d.ellipse((cx - S(26), cy - S(17), cx + S(26), cy + S(17)),
              fill=(226, 216, 182, 105))
    for k in range(3):
        ox = int((k - 1) * S(15) + r.uniform(-2, 2) * SS)
        oy = int(r.uniform(-5, 5) * SS)
        w, h = S(r.uniform(9, 13)), S(r.uniform(7, 10))
        d.rectangle((cx + ox - w // 2 + S(2), cy + oy - h // 2 + S(3),
                     cx + ox + w // 2 + S(2), cy + oy + h // 2 + S(3)),
                    fill=(40, 46, 34, 95))
        d.rectangle((cx + ox - w // 2, cy + oy - h // 2,
                     cx + ox + w // 2, cy + oy + h // 2),
                    fill=(188, 126, 96, 255), outline=(96, 84, 68, 220), width=S(1.2))
    for k in range(10):
        a = r.uniform(0, 2 * np.pi)
        rr = r.uniform(20, 34)
        px = cx + int(np.cos(a) * rr * SS * 0.75)
        py = cy + int(np.sin(a) * rr * SS * 0.55)
        q = S(r.uniform(2.6, 4.4))
        d.ellipse((px - q, py - q, px + q, py + q), fill=(68, 112, 62, 235))


def build_overlay():
    ov = Image.new("RGBA", (VW, VH), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)

    draw_farmland(d)
    draw_canopy(d, WOODS,
                [(52, 92, 56, 225), (62, 104, 60, 220), (44, 82, 52, 225)],
                3.6, 7.0, 7001)
    draw_canopy(d, GROVES,
                [(78, 124, 66, 225), (94, 140, 72, 220), (66, 110, 60, 230)],
                2.6, 5.0, 7002)

    draw_water(d)
    draw_footpaths(d)
    draw_road(d, MAIN_ROAD, 10, center=True)
    draw_road(d, CROSS_ROAD, 6)
    draw_road(d, LANE_NORTH, 4.5)
    draw_road(d, LANE_EAST, 4.5)

    draw_bridge(d, 0.573, float(river_y(0.573)))
    draw_bridge(d, 0.158, float(river_y(0.158)))
    draw_buildings(d)
    for i, (fx, fy) in enumerate(PIN_ANCHORS):
        draw_farmstead(d, fx / 100.0, fy / 100.0, 8100 + i)

    return ov.resize((W, H), RESAMPLE)


# --------------------------------------------------------------------------
# Compose + preview
# --------------------------------------------------------------------------
def compose():
    arr, nx, ny = build_terrain()
    base = Image.fromarray(arr, "RGB").convert("RGBA")

    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for i in range(1, 6):
        x = int(W * i / 6)
        gd.line((x, 0, x, H), fill=(255, 255, 255, 17), width=2)
    for j in range(1, 4):
        y = int(H * j / 4)
        gd.line((0, y, W, y), fill=(255, 255, 255, 17), width=2)
    base = Image.alpha_composite(base, grid)
    base = Image.alpha_composite(base, build_overlay())

    top = np.zeros((H, W, 4), np.uint8)
    a = np.clip((1 - ny / 0.20) * 52, 0, 52).astype(np.uint8)
    top[..., 0], top[..., 1], top[..., 2], top[..., 3] = 22, 36, 28, a
    base = Image.alpha_composite(base, Image.fromarray(top, "RGBA"))
    return base.convert("RGB")


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              r"C:\Windows\Fonts\simsun.ttc"):
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def labelled(d, xy, text, fnt, fill, stroke=(255, 255, 255), sw=3):
    d.text(xy, text, font=fnt, fill=fill, stroke_width=sw, stroke_fill=stroke)


def render_preview(base):
    """Approximate the WXML/CSS overlay to eyeball the final mini program look."""
    im = base.copy().convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    f_label = font(34)
    f_small = font(24)
    f_pin = font(30)

    # Place-name annotations (drawn as WXSS text in the mini program).
    # NOTE: the preview layer is 1x, so use W/H here, not P() (which is 2x).
    for xy, text, col in [
        ((0.255, 0.545), "䢺江", (36, 84, 118)),
        ((0.660, 0.700), "大双路", (104, 88, 60)),
        ((0.455, 0.435), "老街", (92, 76, 56)),
        ((0.800, 0.170), "青梅谷", (52, 92, 58)),
    ]:
        labelled(d, (int(W * xy[0]), int(H * xy[1])), text, f_label, col, sw=4)

    # North arrow.
    nx0, ny0 = int(W * 0.958), int(H * 0.105)
    d.polygon([(nx0, ny0 - 34), (nx0 - 13, ny0 + 16), (nx0, ny0 + 6),
               (nx0 + 13, ny0 + 16)], fill=(46, 62, 48, 235),
              outline=(255, 255, 255, 230))
    labelled(d, (nx0 - 9, ny0 - 88), "N", f_small, (40, 56, 42))

    # Scale bar.
    bx, by = int(W * 0.815), int(H * 0.905)
    d.rounded_rectangle((bx - 18, by - 44, bx + 200, by + 30), radius=10,
                        fill=(255, 255, 255, 215))
    d.rectangle((bx, by, bx + 90, by + 8), fill=(60, 76, 62, 255))
    d.rectangle((bx + 90, by, bx + 180, by + 8), fill=(255, 255, 255, 255),
                outline=(60, 76, 62, 255), width=2)
    labelled(d, (bx, by - 38), "0        500 m", f_small, (60, 76, 62))

    # Legend.
    lx, ly = int(W * 0.022), int(H * 0.870)
    d.rounded_rectangle((lx, ly, lx + 430, ly + 74), radius=12,
                        fill=(255, 255, 255, 220))
    d.ellipse((lx + 18, ly + 24, lx + 42, ly + 48), fill=(63, 143, 82, 255),
              outline=(255, 255, 255, 255), width=3)
    labelled(d, (lx + 56, ly + 18), "采摘园", f_small, (70, 84, 72))
    d.line((lx + 176, ly + 36, lx + 222, ly + 36), fill=(214, 190, 132, 255), width=8)
    labelled(d, (lx + 232, ly + 18), "道路", f_small, (70, 84, 72))
    d.line((lx + 316, ly + 36, lx + 362, ly + 36), fill=(118, 172, 196, 255), width=8)
    labelled(d, (lx + 372, ly + 18), "水系", f_small, (70, 84, 72))

    # Pins: halo + disc + number, anchored bottom-centre like the WXSS rule.
    for i, (left, top) in enumerate(PIN_ANCHORS):
        cx, cy = int(W * left / 100), int(H * top / 100)
        d.ellipse((cx - 42, cy - 82, cx + 42, cy + 2), fill=(63, 143, 82, 46))
        d.ellipse((cx - 29, cy - 69, cx + 29, cy - 11),
                  fill=(63, 143, 82, 255), outline=(255, 255, 255, 255), width=6)
        txt = str(i + 1)
        box = d.textbbox((0, 0), txt, font=f_pin)
        d.text((cx - (box[2] - box[0]) / 2, cy - 62), txt, font=f_pin,
               fill=(255, 255, 255, 255))

    out = Image.alpha_composite(im, layer).convert("RGB")
    # Show it at 1x device size (694 x 320) as an inset, plus the 3x master.
    small = out.resize((694, 320), RESAMPLE)
    canvas = Image.new("RGB", (W, H + 360), (247, 245, 239))
    canvas.paste(out, (0, 0))
    canvas.paste(small, (20, H + 20))
    ImageDraw.Draw(canvas).text((740, H + 150), "1x device preview (694 x 320 rpx)",
                                font=font(24), fill=(90, 96, 88))
    return canvas


def main():
    OUT_JPG.parent.mkdir(parents=True, exist_ok=True)
    OUT_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    base = compose()
    base.save(OUT_JPG, "JPEG", quality=90, subsampling=0, optimize=True)
    render_preview(base).save(OUT_PREVIEW, "PNG", optimize=True)
    print("basemap :", OUT_JPG, OUT_JPG.stat().st_size, "bytes", base.size)
    print("preview :", OUT_PREVIEW, OUT_PREVIEW.stat().st_size, "bytes")
    print("anchors :", PIN_ANCHORS)


if __name__ == "__main__":
    main()
