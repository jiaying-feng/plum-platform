"""可选的三端界面巡检：无头浏览器走真实渲染，检查运行时错误、破图、接口失败并截图。

启动项目本身不需要任何额外依赖；只有跑这个巡检脚本时才需要：
    pip install websocket-client

用法：先 python start.py，再 python tests/ui_audit.py
产物：docs/screenshots/*.png 和控制台摘要；退出码 0 表示所有场景干净。
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

try:
    import websocket
except ImportError:
    print("请先执行：pip install websocket-client（仅巡检需要，不影响项目启动）")
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:8080"
PORT = 9231

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
CHROME = next((p for p in CHROME_CANDIDATES if os.path.exists(p)), None)
if not CHROME:
    print("没找到 Chrome / Edge，跳过界面巡检（接口验收请用 smoke_test.py）")
    raise SystemExit(0)

PROFILE = os.path.join(tempfile.gettempdir(), "plum-ui-audit")
proc = subprocess.Popen(
    [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
     "--remote-allow-origins=*", f"--remote-debugging-port={PORT}",
     f"--user-data-dir={PROFILE}", "--window-size=1280,900", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

tabs = None
for _ in range(30):
    try:
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
        break
    except Exception:
        time.sleep(0.6)
if not tabs:
    proc.terminate()
    print("CDP_NOT_READY")
    raise SystemExit(1)

page = next(t for t in tabs if t["type"] == "page")
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
ws.settimeout(0.25)
mid = 0
events: list[tuple[str, dict]] = []
reqs: dict[str, str] = {}


def collect(msg: dict) -> None:
    if "method" not in msg:
        return
    p = msg.get("params", {})
    if msg["method"] == "Network.requestWillBeSent":
        reqs[p.get("requestId", "")] = p.get("request", {}).get("url", "")
    events.append((msg["method"], p))


def pump(seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            collect(json.loads(ws.recv()))
        except Exception:
            continue


def call(method: str, params: dict | None = None) -> dict:
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    end = time.time() + 20
    while time.time() < end:
        try:
            msg = json.loads(ws.recv())
        except Exception:
            continue
        if "method" in msg:
            collect(msg)
        elif msg.get("id") == mid:
            return msg
    return {}


def ev(expr: str):
    r = call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    res = r.get("result", {})
    if "exceptionDetails" in res:
        return "EVAL_ERROR:" + str(res["exceptionDetails"].get("text", ""))
    return res.get("result", {}).get("value")


PROBE = """(() => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs.filter(i => !i.complete || i.naturalWidth === 0).length;
  const t = (document.body.innerText || '').trim();
  return { title: document.title, textLen: t.length, imgCount: imgs.length,
           broken: broken, svg: document.querySelectorAll('svg').length,
           suspicious: (t.match(/undefined|NaN|\\[object Object\\]/g) || []).slice(0, 4),
           head: t.slice(0, 100).replace(/\\n/g, ' | ') };
})()"""

results: list[tuple[str, bool, str]] = []


def probe(tag: str, shot: bool = True) -> None:
    pump(1.5)
    info = ev(PROBE)
    bad_http, failed, jserr = [], [], []
    for m, p in events:
        url = p.get("response", {}).get("url", "") if m == "Network.responseReceived" else ""
        if m == "Network.responseReceived" and p.get("response", {}).get("status", 0) >= 400:
            if "favicon.ico" not in url:
                bad_http.append(f"{p['response']['status']} {url[:100]}")
        elif m == "Network.loadingFailed":
            u = reqs.get(p.get("requestId", ""), "")
            if "favicon.ico" not in u:
                failed.append(f"{p.get('errorText', '')} {u[:90]}")
        elif m == "Runtime.exceptionThrown":
            jserr.append(p.get("exceptionDetails", {}).get("text", "exception")[:110])
        elif m == "Log.entryAdded" and p.get("entry", {}).get("level") == "error":
            jserr.append(p.get("entry", {}).get("text", "")[:110])
        elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
            jserr.append(" ".join(str(a.get("value", "")) for a in p.get("args", []))[:110])
    d = info if isinstance(info, dict) else {}
    clean = (not bad_http and not failed and not jserr and
             d.get("broken", 1) == 0 and d.get("textLen", 0) > 80 and
             not d.get("suspicious"))
    results.append((tag, bool(clean), json.dumps({
        "textLen": d.get("textLen"), "img": d.get("imgCount"), "broken": d.get("broken"),
        "svg": d.get("svg"), "http": bad_http[:3], "failed": failed[:3], "js": jserr[:3],
    }, ensure_ascii=False)))
    print(f"[{'干净' if clean else '异常'}] {tag}  {results[-1][2]}")
    if shot:
        s = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        data = s.get("result", {}).get("data")
        if data:
            (OUT / f"{tag}.png").write_bytes(base64.b64decode(data))


def reset() -> None:
    events.clear()
    reqs.clear()


def enter(path: str, user: str, pwd: str, role: str, tag: str,
          hash_path: str = "", shot: bool = True) -> None:
    reset()
    call("Page.navigate", {"url": BASE + path})
    pump(2.5)
    payload = json.dumps({"username": user, "password": pwd, "role": role}, ensure_ascii=False)
    expr = f"""(async () => {{
      const r = await fetch('/api/auth/login', {{method:'POST',
        headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({payload})}});
      const j = await r.json();
      if (j.code !== 200) return 'LOGIN_FAIL:' + j.msg;
      Session.set(j.data.sessionId, {{nickname:j.data.nickname, role:j.data.role}});
      return 'OK';
    }})()"""
    logged = ev(expr)
    if logged != "OK":
        print(f"  登录失败 {tag}: {logged}")
    call("Page.reload", {"ignoreCache": True})
    pump(3.0)
    # 未登录时路由会停在 #/login，写回会话后要显式跳到目标页
    if hash_path:
        ev(f"location.hash='#{hash_path}'")
        pump(2.5)
    probe(tag, shot)


def switch(hash_path: str, tag: str, shot: bool = True) -> None:
    reset()
    ev(f"location.hash='#{hash_path}'")
    pump(2.5)
    probe(tag, shot)


for m in ("Page.enable", "Runtime.enable", "Network.enable", "Log.enable"):
    call(m)

print("=" * 66)
print("三端界面巡检（真实浏览器渲染）")
print("=" * 66)

# 门户与 PC 后台：桌面视口
call("Emulation.setDeviceMetricsOverride",
     {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
reset()
call("Page.navigate", {"url": BASE + "/"})
pump(2.5)
probe("portal")

enter("/admin", "admin", "admin123", "管理员", "admin_dashboard", "/dashboard")
switch("/merchants", "admin_merchants")
switch("/festivals", "admin_festivals")

# 游客 H5 与商户工作台：手机视口
call("Emulation.setDeviceMetricsOverride",
     {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
enter("/visitor", "tourist01", "tourist123", "游客", "visitor_home", "/home")
switch("/ai", "visitor_ai")
enter("/merchant", "farmer01", "merchant123", "商户", "merchant_home", "/home")
switch("/checkin", "merchant_checkin")

ok = sum(1 for _, good, _ in results if good)
print("-" * 66)
print(f"界面巡检：共 {len(results)} 个场景，干净 {ok} 个，异常 {len(results) - ok} 个")
print(f"截图目录：{OUT}")
print("=" * 66)

ws.close()
proc.terminate()
raise SystemExit(0 if ok == len(results) else 1)
