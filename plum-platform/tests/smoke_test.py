"""端到端验收脚本：一条命令验证三端数据打通、订单与核销闭环、状态流转一致、AI 四项能力。

用法：先 python start.py 启动服务，再 python tests/smoke_test.py
退出码 0 = 全部通过，1 = 有失败。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
BASE = os.getenv("PLUM_TEST_BASE", "http://127.0.0.1:8080")
_results: list[tuple[str, bool, str]] = []


def call(method: str, path: str, payload=None, session: str = ""):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if session:
        headers["X-Session-Id"] = session
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def check(name: str, cond: bool, detail: str = ""):
    _results.append((name, bool(cond), detail))
    print(f"[{'通过' if cond else '失败'}] {name}" + (f"  {detail}" if detail else ""))
    return bool(cond)


def body(resp):
    return resp.get("data") or {}


def main() -> int:
    # 每次验收都重建基准数据，保证结果可复现；服务按请求新建连接，不受影响
    from server import db
    db.init_db(force=True)
    print("=" * 68)
    print("青梅产业农商文旅综合平台 · 端到端验收（基准数据已重置）")
    print("=" * 68)

    # 0 健康检查
    status, h = call("GET", "/health")
    check("0 健康检查", status == 200 and h["code"] == 200,
          f"数据条目 {body(h).get('data')}")

    # 1 三端登录
    _, tourist = call("POST", "/api/auth/login",
                      {"username": "tourist01", "password": "tourist123", "role": "游客"})
    ts = body(tourist).get("sessionId", "")
    _, merchant = call("POST", "/api/auth/login",
                       {"username": "farmer01", "password": "merchant123", "role": "商户"})
    ms = body(merchant).get("sessionId", "")
    _, admin = call("POST", "/api/auth/login",
                    {"username": "admin", "password": "admin123", "role": "管理员"})
    ads = body(admin).get("sessionId", "")
    check("1 三端账号登录", all((ts, ms, ads)),
          f"游客/商户/管理员 = {bool(ts)}/{bool(ms)}/{bool(ads)}")
    _, wrong = call("POST", "/api/auth/login", {"username": "tourist01", "password": "x"})
    check("1b 错误口令被拦截", wrong["code"] == 401)

    # 2 首页聚合
    _, home = call("GET", "/api/home")
    hd = body(home)
    check("2 首页聚合数据", home["code"] == 200 and len(hd.get("orchards", [])) >= 5
          and len(hd.get("products", [])) >= 4 and len(hd.get("festivals", [])) >= 4,
          f"点位{len(hd.get('orchards', []))} 好物{len(hd.get('products', []))} 活动{len(hd.get('festivals', []))}")

    # 3 采摘预约 -> 商户核销 -> 游客端状态同步（闭环）
    _, olist = call("GET", "/api/orchards")
    oid = body(olist)["records"][0]["id"]
    _, odetail = call("GET", f"/api/orchards/{oid}")
    sessions = body(odetail).get("sessions", [])
    check("3 园区详情含可约场次", len(sessions) > 0, f"{len(sessions)} 场")
    s = next((x for x in sessions if x["left"] > 0), None)
    if s:
        _, res = call("POST", "/api/reservations", {
            "session_id": s["id"], "people": 2, "contact": "小梅", "phone": "13700000001",
            "requestId": str(uuid4())}, ts)
        ck = body(res).get("checkin_code", "")
        check("3b 创建采摘预约", res["code"] == 200 and bool(ck), body(res).get("code", ""))
        # 幂等：同一个 requestId 不应产生第二条
        key = str(uuid4())
        payload = {"session_id": s["id"], "people": 1, "contact": "小梅",
                   "phone": "13700000001", "requestId": key}
        _, r1 = call("POST", "/api/reservations", payload, ts)
        _, r2 = call("POST", "/api/reservations", payload, ts)
        check("3c 预约幂等", body(r1).get("code") == body(r2).get("code"))
        if ck:
            _, ci = call("POST", "/api/merchant/checkin", {"checkin_code": ck}, ms)
            check("3d 商户统一核销", ci["code"] == 200 and body(ci).get("status") == "已核销",
                  body(ci).get("tip", ""))
            _, again = call("POST", "/api/merchant/checkin", {"checkin_code": ck}, ms)
            check("3e 重复核销被拒", again["code"] == 409)
            _, mine = call("GET", "/api/my/reservations", session=ts)
            check("3f 游客端状态已同步", any(x["status"] == "已核销" for x in body(mine)))
    else:
        check("3b 创建采摘预约", False, "没有可用场次")

    # 4 商城 -> 购物车 -> 下单 -> 支付 -> 发货（闭环）
    _, plist = call("GET", "/api/products")
    pid = body(plist)["records"][0]["id"]
    _, add = call("POST", "/api/cart", {"product_id": pid, "quantity": 1}, ts)
    check("4 加入购物车", add["code"] == 200)
    _, order = call("POST", "/api/orders", {"receiver": "小梅", "phone": "13700000001",
                                            "address": "四川省成都市武侯区青梅巷1号",
                                            "requestId": str(uuid4())}, ts)
    ono = body(order).get("order_no", "")
    o_id = body(order).get("id")
    check("4b 下单", order["code"] == 200 and bool(ono), ono)
    if o_id:
        _, pay = call("POST", f"/api/orders/{o_id}/pay", {}, ts)
        check("4c 支付 待支付->已支付", pay["code"] == 200 and body(pay).get("status") == "已支付")
        _, pay2 = call("POST", f"/api/orders/{o_id}/pay", {}, ts)
        check("4d 重复支付被拒", pay2["code"] == 409)
        _, ship = call("POST", f"/api/merchant/orders/{o_id}/ship", {}, ms)
        check("4e 商户发货 已支付->已发货", ship["code"] == 200 and body(ship).get("status") == "已发货")
        _, myorders = call("GET", "/api/my/orders", session=ts)
        check("4f 游客订单状态同步", any(x["status"] == "已发货" for x in body(myorders)))

    # 5 研学报名 / 民宿预订 也走同一套核销
    _, full = call("POST", "/api/research/signup", {
        "research_id": 5, "people": 2, "contact": "小梅", "phone": "13700000001",
        "requestId": str(uuid4())}, ts)
    check("5 名额已满被拦下", full["code"] == 422, full.get("msg", ""))
    _, signup = call("POST", "/api/research/signup", {
        "research_id": 6, "people": 2, "contact": "小梅", "phone": "13700000001",
        "requestId": str(uuid4())}, ts)
    yj_ck = body(signup).get("checkin_code", "")
    check("5 研学报名", signup["code"] == 200 and bool(yj_ck))
    if yj_ck:
        _, ci2 = call("POST", "/api/merchant/checkin", {"checkin_code": yj_ck}, ms)
        check("5b 研学核销复用统一入口", ci2["code"] == 200 and body(ci2).get("type") == "research")
    _, book = call("POST", "/api/homestay-bookings", {
        "homestay_id": 1, "room_id": 1, "guests": 2, "contact": "小梅", "phone": "13700000001",
        "check_in": (date.today() + timedelta(days=2)).isoformat(),
        "check_out": (date.today() + timedelta(days=3)).isoformat(),
        "requestId": str(uuid4())}, ts)
    check("5c 民宿预订", book["code"] == 200 and body(book).get("nights") == 1,
          body(book).get("msg", ""))

    # 6 打卡集章
    _, spots = call("GET", "/api/checkin-spots", session=ts)
    free = next((x for x in body(spots).get("spots", []) if not x["stamped"]), None)
    if free:
        _, stamp = call("POST", "/api/checkin", {"spot_id": free["id"]}, ts)
        check("6 打卡集章", stamp["code"] == 200, body(stamp).get("tip", ""))
    else:
        check("6 打卡集章", True, "已全部集齐")

    # 7 后台看板 / 审核 / 活动发布
    _, dash = call("GET", "/api/admin/dashboard", session=ads)
    d = body(dash)
    check("7 后台看板", dash["code"] == 200 and "cards" in d and "trend" in d.get("charts", {}),
          f"总销售额 ¥{d.get('cards', {}).get('total_sales')}")
    _, ms_list = call("GET", "/api/admin/merchants", session=ads)
    pending = next((m for m in body(ms_list) if m["audit_status"] == "待审核"), None)
    if pending:
        _, bad = call("POST", f"/api/admin/merchants/{pending['id']}/audit", {"action": "驳回"}, ads)
        check("7b 驳回必须写原因", bad["code"] == 422)
        _, au = call("POST", f"/api/admin/merchants/{pending['id']}/audit",
                     {"action": "通过", "note": "材料齐了"}, ads)
        check("7c 商户审核通过", au["code"] == 200 and body(au).get("audit_status") == "已通过")
        _, dup = call("POST", f"/api/admin/merchants/{pending['id']}/audit",
                      {"action": "通过", "note": ""}, ads)
        check("7d 重复审核被拒", dup["code"] == 409)
    _, sessions_admin = call("GET", "/api/admin/sessions", session=ads)
    ps = next((x for x in body(sessions_admin) if x["audit_status"] == "待审核"), None)
    if ps:
        _, sa = call("POST", f"/api/admin/sessions/{ps['id']}/audit", {"action": "通过"}, ads)
        check("7e 场次审核", sa["code"] == 200)
    _, fest = call("POST", "/api/admin/festivals", {
        "title": "青梅开园尝鲜日", "festival_date": "每年 6 月", "place": "青梅谷",
        "intro": "开园头一天，摘一篮，喝一碗青梅茶。"}, ads)
    check("7f 活动发布后游客端可见", fest["code"] == 200)
    _, fest2 = call("GET", "/api/festivals")
    check("7g 活动已进游客端", any(x["title"] == "青梅开园尝鲜日" for x in body(fest2)))

    # 8 商户工作台
    _, mo = call("GET", "/api/merchant/overview", session=ms)
    check("8 商户工作台统计", mo["code"] == 200 and "pending_checkin" in body(mo))
    _, mrooms = call("GET", "/api/merchant/rooms", session=ms)
    check("8b 房间管理列表", mrooms["code"] == 200 and len(body(mrooms)) >= 2)
    _, mproducts = call("GET", "/api/merchant/products", session=ms)
    check("8c 商品管理列表", mproducts["code"] == 200)
    _, new_p = call("POST", "/api/merchant/products", {
        "name": "今夏新摘青梅", "price": "29.90", "stock": 30, "category_id": 1}, ms)
    check("8d 新增商品进入待审核", new_p["code"] == 200 and
          body(new_p).get("audit_status") == "待审核")

    # 9 AI 四项能力（基于真实业务数据）
    _, chat = call("POST", "/api/ai/chat", {"question": "青梅酒多少钱一瓶？"})
    ans = body(chat).get("answer", "")
    check("9 知识库客服", chat["code"] == 200 and len(ans) > 5, ans[:42])
    _, live = call("POST", "/api/ai/chat", {"question": "周末还有位置吗？"})
    check("9b 客服引用实时场次", live["code"] == 200 and
          body(live).get("source") == "平台实时数据", body(live).get("answer", "")[:42])
    _, gen = call("POST", "/api/ai/generate", {"type": "product", "target_id": 1})
    check("9c 产品文案基于真实商品", gen["code"] == 200 and
          body(gen).get("based_on", "") in body(gen).get("content", ""),
          body(gen).get("based_on", ""))
    _, script = call("POST", "/api/ai/generate", {"type": "script", "target_id": 2})
    check("9d 短视频脚本", script["code"] == 200 and "镜头1" in body(script).get("content", ""))
    _, trip = call("POST", "/api/ai/itinerary", {"days": 2})
    check("9e 两日游行程含真实地点", trip["code"] == 200 and
          "第二天" in body(trip).get("itinerary", ""))
    _, tts = call("POST", "/api/ai/tts", {"target_id": 2})
    check("9f 语音讲解稿", tts["code"] == 200 and len(body(tts).get("segments", [])) >= 2)

    # 10 边界与统一错误
    cases = [
        ("空问题", "POST", "/api/ai/chat", {"question": ""}, 400, ""),
        ("非法天数", "POST", "/api/ai/itinerary", {"days": 5}, 400, ""),
        ("布尔天数", "POST", "/api/ai/itinerary", {"days": True}, 400, ""),
        ("非法生成类型", "POST", "/api/ai/generate", {"type": "video"}, 400, ""),
        ("未登录访问我的", "GET", "/api/my/orders", None, 401, ""),
        ("越权访问后台", "GET", "/api/admin/dashboard", None, 403, ts),
        ("未知路由", "GET", "/api/not-exist", None, 404, ""),
    ]
    for name, method, path, payload, expect, sess in cases:
        _, r = call(method, path, payload, sess)
        check(f"10 {name}", r.get("code") == expect, f"code={r.get('code')}")

    passed = sum(1 for _, ok_, _ in _results if ok_)
    total = len(_results)
    print("\n" + "=" * 68)
    print(f"验收完成：共 {total} 项，通过 {passed} 项，失败 {total - passed} 项")
    if passed != total:
        print("失败项：" + "、".join(n for n, ok_, _ in _results if not ok_))
    print("=" * 68)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
