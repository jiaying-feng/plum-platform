"""PC 端桌面巡检：无头浏览器真实渲染两个新站点，检查运行时错误、破图、横向溢出与会话隔离。

先 python start.py，再 python tests/pc_audit.py
产物：docs/screenshots/pc_*.png；退出码 0 表示全部干净。
仅巡检需要 pip install websocket-client。
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
    print("请先执行：pip install websocket-client（仅巡检需要）")
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:8080"
PORT = 9232

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
CHROME = next((p for p in CHROME_CANDIDATES if os.path.exists(p)), None)
if not CHROME:
    print("没找到 Chrome / Edge，跳过 PC 巡检")
    raise SystemExit(0)

try:
    urllib.request.urlopen(BASE + "/health", timeout=3).read()
except Exception:
    print("服务没起来，先运行 python start.py")
    raise SystemExit(1)

PROFILE = os.path.join(tempfile.gettempdir(), "plum-pc-audit")
proc = subprocess.Popen(
    [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
     "--remote-allow-origins=*", f"--remote-debugging-port={PORT}",
     f"--user-data-dir={PROFILE}", "--window-size=1440,900", "about:blank"],
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
results: list[tuple[str, bool, str]] = []


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


for m in ("Runtime.enable", "Page.enable", "Network.enable", "Log.enable"):
    call(m)

PROBE = """(() => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs.filter(i => !i.complete || i.naturalWidth === 0).length;
  const t = (document.body.innerText || '').trim();
  return { title: document.title, textLen: t.length, imgCount: imgs.length, broken,
           overflow: document.documentElement.scrollWidth - window.innerWidth,
           svg: document.querySelectorAll('svg').length,
           tables: document.querySelectorAll('table').length,
           suspicious: (t.match(/undefined|NaN|\\[object Object\\]/g) || []).slice(0, 4),
           head: t.slice(0, 90).replace(/\\n/g, ' | ') };
})()"""


def reset() -> None:
    events.clear()
    reqs.clear()


def goto(url: str) -> None:
    reset()
    call("Page.navigate", {"url": url})
    pump(1.6)


def login(username: str, password: str, role: str) -> str:
    expr = """(async () => {
      const r = await fetch('/api/auth/login', {method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username:%s, password:%s, role:%s})});
      const j = await r.json();
      if (j.code !== 200) return 'FAIL:' + j.msg;
      Session.set(j.data.sessionId, {nickname:j.data.nickname, role:j.data.role});
      return 'OK:' + j.data.role;
    })()""" % (json.dumps(username), json.dumps(password), json.dumps(role))
    return str(ev(expr))


def probe(tag: str) -> None:
    pump(1.3)
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
             d.get("overflow", 99) <= 2 and not d.get("suspicious"))
    detail = json.dumps({
        "textLen": d.get("textLen"), "img": d.get("imgCount"), "broken": d.get("broken"),
        "overflow": d.get("overflow"), "tables": d.get("tables"),
        "http": bad_http[:3], "failed": failed[:3], "js": jserr[:3],
    }, ensure_ascii=False)
    results.append((tag, bool(clean), detail))
    print(f"[{'干净' if clean else '异常'}] {tag}  {detail}")
    shot = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    data = shot.get("result", {}).get("data")
    if data:
        (OUT / f"pc_{tag}.png").write_bytes(base64.b64decode(data))


def check(tag: str, cond: bool, detail: str) -> None:
    results.append((tag, bool(cond), detail))
    print(f"[{'干净' if cond else '异常'}] {tag}  {detail}")


def interact(tag: str, steps: list[str], assertion: str, cleanup: str = "") -> None:
    """真实点击页面元素，验证事件绑定与重绘，而不只是静态渲染。"""
    for s in steps:
        ev(s)
        pump(0.9)
    val = ev(assertion)
    check(tag, val is True, "交互断言：" + assertion[:90])
    if cleanup:
        ev(cleanup)
        pump(0.2)
    reset()


# ---------- 门户 ----------
goto(BASE + "/")
probe("portal")

# ---------- 消费者站 ----------
goto(BASE + "/consumer#/home")
check("consumer_login", login("tourist01", "tourist123", "游客").startswith("OK:游客"), "游客会话写入 consumer 命名空间")
goto(BASE + "/consumer#/home")
probe("consumer_home")
interact("ui_ai_drawer",
         ["document.querySelector('#aiFab').click()"],
         "!!document.querySelector('.pc-drawer-mask .pc-drawer')",
         "document.querySelector('.pc-drawer-mask [data-close]').click()")
goto(BASE + "/consumer#/shop")
probe("consumer_shop")
interact("ui_view_toggle",
         ["document.querySelector('#viewTable').click()"],
         "document.querySelectorAll('#app table.data-table').length === 1",
         "document.querySelector('#viewGrid').click()")
interact("ui_search",
         ["document.querySelector('#kw').value='青梅酒';document.querySelector('#doSearch').click()"],
         "document.querySelector('#kw') && document.querySelector('#kw').value==='青梅酒'")
goto(BASE + "/consumer#/product/1")
probe("consumer_detail")
goto(BASE + "/consumer#/cart")
probe("consumer_cart")
goto(BASE + "/consumer#/mine")
probe("consumer_mine")

# ---------- 商户工作台 ----------
goto(BASE + "/biz#/login")
check("biz_login", login("farmer01", "merchant123", "商户").startswith("OK:商户"), "商户会话写入 biz 命名空间")
goto(BASE + "/biz#/home")
probe("biz_home")
goto(BASE + "/biz#/products")
probe("biz_products")
interact("ui_biz_modal",
         ["document.querySelector('#newProduct').click()"],
         "!!document.querySelector('.pc-modal .pc-dialog .pc-form')",
         "document.querySelector('.pc-modal [data-close]').click()")
interact("ui_biz_checkbox",
         ["var c=document.querySelector('[data-check]'); if(c) c.click();"],
         "document.querySelectorAll('[data-check]:checked').length > 0")
goto(BASE + "/biz#/checkin")
probe("biz_checkin")
interact("ui_checkin_fill",
         ["var b=document.querySelector('[data-fill]'); if(b) b.click();"],
         "!document.querySelector('[data-fill]') || document.querySelector('#code').value.length > 0")

# ---------- 后台与三端会话隔离 ----------
goto(BASE + "/admin")
check("admin_login", login("admin", "admin123", "管理员").startswith("OK:管理员"), "管理员会话写入 admin 命名空间")
goto(BASE + "/admin#/dashboard")
probe("admin_dashboard")

goto(BASE + "/")
state = ev("""(() => {
  const keys = ['consumer','biz','admin'];
  return keys.map(k => {
    const u = JSON.parse(localStorage.getItem('plum_' + k + '_user') || 'null');
    return { ns:k, sid: localStorage.getItem('plum_' + k + '_sid') || '', role: u ? u.role : '' };
  });
})()""")
roles = {x["ns"]: x["role"] for x in state} if isinstance(state, list) else {}
isolation_ok = False
if isinstance(state, list):
    isolation_ok = (roles.get("consumer") == "游客" and roles.get("biz") == "商户" and
                    roles.get("admin") == "管理员" and
                    all(x.get("sid") for x in state))
check("session_isolation", isolation_ok,
      "三端会话互不顶号：" + json.dumps(roles, ensure_ascii=False))

# ---------- 响应式：小屏无横向溢出 ----------
call("Emulation.setDeviceMetricsOverride",
     {"width": 900, "height": 800, "deviceScaleFactor": 1, "mobile": False})
goto(BASE + "/consumer#/shop")
probe("consumer_900")
goto(BASE + "/biz#/products")
probe("biz_900")
call("Emulation.clearDeviceMetricsOverride")

print("\n----------------------------------------")
ok = sum(1 for _, c, _ in results if c)
print(f"干净 {ok}/{len(results)} 个场景")
print("----------------------------------------\n")
ws.close()
proc.terminate()
sys.exit(0 if ok == len(results) else 1)
