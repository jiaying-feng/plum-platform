"""游客端 / 公共业务 API：首页、地图点位、采摘预约、研学报名、民宿预订、
商城与订单、文化节、季节提示、打卡集章、我的。"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from flask import Blueprint, g, request

from server import api_common as C
from server import db, state_machine as SM

bp = Blueprint("business", __name__, url_prefix="/api")


@bp.post("/auth/login")
def login():
    body = C.get_json()
    username = C.text_of(body.get("username"))
    password = C.text_of(body.get("password"))
    if not username or not password:
        return C.fail(400, "账号和口令都要填一下")
    user = db.one("SELECT * FROM users WHERE username=? AND status='启用'", (username,))
    if not user or user["password_hash"] != db.password_hash(password):
        return C.fail(401, "账号或口令不对，再看看")
    wanted = C.text_of(body.get("role"))
    if wanted and wanted != user["role"]:
        return C.fail(403, f"这个账号是「{user['role']}」，请从对应入口进")
    return C.ok({"sessionId": C.create_session(user), "userId": user["id"],
                 "nickname": user["nickname"], "role": user["role"]})


@bp.post("/auth/logout")
def logout():
    sid = request.headers.get("X-Session-Id", "")
    from server.api_common import _SESSIONS
    _SESSIONS.pop(sid, None)
    return C.ok({"bye": True})


@bp.get("/home")
def home():
    """首页一个请求拿齐：轮播、当季提示、文化节、地图点位、热门研学、好物。"""
    month = date.today().month
    tips = db.rows("SELECT * FROM season_tips")
    tip = next((t for t in tips if _month_in_range(month, t["month_range"])), tips[0] if tips else {})
    # 列表统一走 public_amount：把「分」变成前端可直接展示的字符串，三端口径一致
    return C.ok({
        "banners": [f"/assets/banner_{i:02d}.webp" for i in range(1, 5)],
        "season_tip": tip,
        "festivals": db.rows("SELECT * FROM festivals WHERE status='展示中' ORDER BY id"),
        "orchards": [C.public_amount(dict(r)) for r in db.rows(
            "SELECT id,name,town,address,lng,lat,image,adult_price_cent,child_price_cent "
            "FROM orchards WHERE audit_status='已通过' ORDER BY id")],
        "research": [C.public_amount(dict(r)) for r in db.rows(
            "SELECT id,title,start_date,price_cent,capacity,signed,image FROM research "
            "WHERE audit_status='已通过' ORDER BY id LIMIT 3")],
        "products": [C.public_amount(dict(r)) for r in db.rows(
            "SELECT id,name,subtitle,price_cent,image,sales FROM products "
            "WHERE audit_status='已通过' AND shelf_status='上架' ORDER BY sales DESC LIMIT 4")],
    })


def _month_in_range(month: int, text: str) -> bool:
    import re
    nums = [int(x) for x in re.findall(r"(\d+)月", text or "")]
    if len(nums) == 2:
        a, b = nums
        return a <= month <= b if a <= b else month >= a or month <= b
    return False


@bp.get("/orchards")
def orchards():
    body = request.args.to_dict()
    kw, town = C.text_of(body.get("keyword")), C.text_of(body.get("town"))
    sql = ("SELECT o.*, m.name AS merchant_name FROM orchards o "
           "LEFT JOIN merchants m ON m.id=o.merchant_id WHERE o.audit_status='已通过'")
    args: list = []
    if kw:
        sql += " AND (o.name LIKE ? OR o.address LIKE ? OR o.intro LIKE ?)"
        args += [f"%{kw}%"] * 3
    if town and town != "全部":
        sql += " AND o.town=?"
        args.append(town)
    sql += " ORDER BY o.id"
    items = [C.public_amount(dict(r)) for r in db.rows(sql, tuple(args))]
    return C.ok(C.paginate(items, body))


@bp.get("/orchards/<int:oid>")
def orchard_detail(oid: int):
    item = db.one("SELECT o.*, m.name AS merchant_name FROM orchards o "
                  "LEFT JOIN merchants m ON m.id=o.merchant_id WHERE o.id=?", (oid,))
    if not item:
        return C.fail(404, "没找到这个园子")
    sessions = db.rows("SELECT * FROM orchard_sessions WHERE orchard_id=? AND audit_status='已通过' "
                       "AND session_date>=? ORDER BY session_date,slot LIMIT 12", (oid, db.day(0)))
    item = C.public_amount(dict(item))
    item["sessions"] = [{"id": s["id"], "date": s["session_date"], "slot": s["slot"],
                         "left": max(0, s["capacity"] - s["booked"])} for s in sessions]
    return C.ok(item)


@bp.post("/reservations")
@C.require_login()
def create_reservation():
    body = C.get_json()
    try:
        C.required(body, "contact", "phone", "requestId")
        sid = C.int_of(body.get("session_id"), minimum=1)
        people = C.int_of(body.get("people"), minimum=1, maximum=20)
        contact = C.limited(body["contact"], "联系人", 20)
        phone = C.limited(body["phone"], "手机号", 11)
        if not phone.isdigit() or len(phone) != 11:
            raise ValueError("手机号请填 11 位数字")
        key = C.text_of(body["requestId"])
        cached = C.idem(key)
        if cached:
            return C.ok(cached)
        session = db.one("SELECT * FROM orchard_sessions WHERE id=?", (sid,))
        if not session:
            return C.fail(404, "没找到这场采摘")
        SM.bookable(session, people)
        orchard = db.one("SELECT * FROM orchards WHERE id=?", (session["orchard_id"],))
        code = SM.business_no("YY", db.one("SELECT COUNT(*) n FROM reservations")["n"] + 1)
        ck = SM.checkin_code()
        amount = people * orchard["adult_price_cent"]
        with db.connect() as c:
            c.execute("UPDATE orchard_sessions SET booked=booked+? WHERE id=?", (people, sid))
            cur = c.execute(
                "INSERT INTO reservations(code,user_id,session_id,orchard_id,visit_date,slot,people,contact,"
                "phone,amount_cent,status,checkin_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (code, g.user["id"], sid, session["orchard_id"], session["session_date"], session["slot"],
                 people, contact, phone, amount, "待核销", ck, db.now()))
            rid = cur.lastrowid
            c.commit()
        result = {"id": rid, "code": code, "checkin_code": ck, "status": "待核销",
                  "amount": db.money(amount), "orchard": orchard["name"],
                  "date": session["session_date"], "slot": session["slot"], "people": people,
                  "tip": "到场把核销码给园主看一下就能进园啦"}
        C.idem_save(key, result)
        C.log_action(g.user["id"], "采摘预约", code, f"{orchard['name']} {people}人")
        return C.ok(result)
    except (ValueError, SM.StateError) as e:
        return C.fail(422, str(e))


@bp.get("/my/reservations")
@C.require_login()
def my_reservations():
    items = db.rows("SELECT r.*, o.name AS orchard_name FROM reservations r "
                    "LEFT JOIN orchards o ON o.id=r.orchard_id WHERE r.user_id=? ORDER BY r.id DESC",
                    (g.user["id"],))
    return C.ok([C.public_amount(i) for i in items])


@bp.post("/my/reservations/<int:rid>/cancel")
@C.require_login()
def cancel_reservation(rid: int):
    row = db.one("SELECT * FROM reservations WHERE id=? AND user_id=?", (rid, g.user["id"]))
    if not row:
        return C.fail(404, "没找到这条预约")
    try:
        SM.transition(SM.BOOKING, row["status"], "已取消")
    except SM.StateError as e:
        return C.fail(409, str(e))
    with db.connect() as c:
        c.execute("UPDATE reservations SET status='已取消' WHERE id=?", (rid,))
        c.execute("UPDATE orchard_sessions SET booked=MAX(0,booked-?) WHERE id=?",
                  (row["people"], row["session_id"]))
        c.commit()
    return C.ok({"id": rid, "status": "已取消"})


@bp.get("/research")
def research_list():
    items = db.rows("SELECT * FROM research WHERE audit_status='已通过' ORDER BY id")
    return C.ok([C.public_amount(i) for i in items])


@bp.get("/research/<int:rid>")
def research_detail(rid: int):
    item = db.one("SELECT * FROM research WHERE id=? AND audit_status='已通过'", (rid,))
    return C.ok(C.public_amount(dict(item))) if item else C.fail(404, "没找到这门课")


@bp.post("/research/signup")
@C.require_login()
def research_signup():
    body = C.get_json()
    try:
        C.required(body, "contact", "phone", "requestId")
        rid = C.int_of(body.get("research_id"), minimum=1)
        people = C.int_of(body.get("people"), minimum=1, maximum=10)
        contact = C.limited(body["contact"], "联系人", 20)
        phone = C.limited(body["phone"], "手机号", 11)
        if not phone.isdigit() or len(phone) != 11:
            raise ValueError("手机号请填 11 位数字")
        key = C.text_of(body["requestId"])
        cached = C.idem(key)
        if cached:
            return C.ok(cached)
        item = db.one("SELECT * FROM research WHERE id=? AND audit_status='已通过'", (rid,))
        if not item:
            return C.fail(404, "没找到这门课")
        left = item["capacity"] - item["signed"]
        if left < people:
            raise SM.StateError(f"只剩 {max(left, 0)} 个位置了，换个日子看看")
        if db.one("SELECT id FROM research_signups WHERE user_id=? AND research_id=? AND status!='已取消'",
                  (g.user["id"], rid)):
            raise SM.StateError("这门课你已经报过名啦")
        code = SM.business_no("YJ", db.one("SELECT COUNT(*) n FROM research_signups")["n"] + 1)
        ck, amount = SM.checkin_code(), people * item["price_cent"]
        with db.connect() as c:
            c.execute("UPDATE research SET signed=signed+? WHERE id=?", (people, rid))
            cur = c.execute("INSERT INTO research_signups(code,user_id,research_id,people,contact,phone,"
                            "amount_cent,status,checkin_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                            (code, g.user["id"], rid, people, contact, phone, amount, "待核销", ck, db.now()))
            new_id = cur.lastrowid
            c.commit()
        result = {"id": new_id, "code": code, "checkin_code": ck, "status": "待核销",
                  "amount": db.money(amount), "title": item["title"], "people": people}
        C.idem_save(key, result)
        C.log_action(g.user["id"], "研学报名", code, item["title"])
        return C.ok(result)
    except (ValueError, SM.StateError) as e:
        return C.fail(422, str(e))


@bp.get("/homestays")
def homestay_list():
    items = db.rows("SELECT * FROM homestays WHERE audit_status='已通过' ORDER BY id")
    return C.ok([C.public_amount(i) for i in items])


@bp.get("/homestays/<int:hid>")
def homestay_detail(hid: int):
    item = db.one("SELECT * FROM homestays WHERE id=? AND audit_status='已通过'", (hid,))
    if not item:
        return C.fail(404, "没找到这家民宿")
    out = C.public_amount(dict(item))
    out["rooms"] = [C.public_amount(r) for r in
                    db.rows("SELECT * FROM rooms WHERE homestay_id=? ORDER BY id", (hid,))]
    return C.ok(out)


@bp.post("/homestay-bookings")
@C.require_login()
def homestay_booking():
    body = C.get_json()
    try:
        C.required(body, "contact", "phone", "check_in", "check_out", "requestId")
        hid = C.int_of(body.get("homestay_id"), minimum=1)
        room_id = C.int_of(body.get("room_id"), minimum=1)
        guests = C.int_of(body.get("guests"), minimum=1, maximum=10)
        contact = C.limited(body["contact"], "联系人", 20)
        phone = C.limited(body["phone"], "手机号", 11)
        ci, co = C.text_of(body["check_in"]), C.text_of(body["check_out"])
        d_in, d_out = date.fromisoformat(ci), date.fromisoformat(co)
        if d_in < date.today() or d_out <= d_in or (d_out - d_in).days > 30:
            raise ValueError("入住日期得从今天起，退房要晚于入住，一次最多订 30 天")
        key = C.text_of(body["requestId"])
        cached = C.idem(key)
        if cached:
            return C.ok(cached)
        room = db.one("SELECT * FROM rooms WHERE id=? AND homestay_id=?", (room_id, hid))
        if not room:
            return C.fail(404, "没找到这个房型")
        if room["stock"] < 1:
            raise SM.StateError("这几晚房间订满啦，换个日子看看")
        if guests > room["capacity"]:
            raise SM.StateError(f"这间房最多住 {room['capacity']} 人")
        nights = (d_out - d_in).days
        amount = nights * room["price_cent"]
        code = SM.business_no("MS", db.one("SELECT COUNT(*) n FROM homestay_bookings")["n"] + 1)
        ck = SM.checkin_code()
        cur = db.execute("INSERT INTO homestay_bookings(code,user_id,homestay_id,room_id,check_in,check_out,"
                         "guests,contact,phone,amount_cent,status,checkin_code,created_at) "
                         "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (code, g.user["id"], hid, room_id, ci, co, guests, contact, phone,
                          amount, "待核销", ck, db.now()))
        result = {"id": cur, "code": code, "checkin_code": ck, "status": "待核销",
                  "amount": db.money(amount), "nights": nights}
        C.idem_save(key, result)
        C.log_action(g.user["id"], "民宿预订", code, ci)
        return C.ok(result)
    except (ValueError, SM.StateError) as e:
        return C.fail(422, str(e))


@bp.get("/products")
def products():
    body = request.args.to_dict()
    kw, cat = C.text_of(body.get("keyword")), C.text_of(body.get("category_id"))
    sql = ("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id "
           "WHERE p.audit_status='已通过' AND p.shelf_status='上架'")
    args: list = []
    if kw:
        sql += " AND (p.name LIKE ? OR p.subtitle LIKE ?)"
        args += [f"%{kw}%"] * 2
    if cat and cat.isdigit():
        sql += " AND p.category_id=?"
        args.append(int(cat))
    sql += " ORDER BY p.sales DESC, p.id"
    items = [C.public_amount(dict(r)) for r in db.rows(sql, tuple(args))]
    return C.ok(C.paginate(items, body))


@bp.get("/products/<int:pid>")
def product_detail(pid: int):
    item = db.one("SELECT p.*, c.name AS category_name FROM products p "
                  "LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", (pid,))
    return C.ok(C.public_amount(dict(item))) if item else C.fail(404, "没找到这件商品")


@bp.get("/categories")
def categories():
    return C.ok(db.rows("SELECT * FROM categories WHERE status='启用' ORDER BY sort"))


@bp.get("/cart")
@C.require_login()
def cart():
    items = db.rows("SELECT c.id,c.quantity,p.id AS product_id,p.name,p.subtitle,p.price_cent,p.image,p.stock "
                    "FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY c.id",
                    (g.user["id"],))
    out = [C.public_amount(i) for i in items]
    total = sum(int(round(float(i["price"]) * 100)) * i["quantity"] for i in out)
    return C.ok({"items": out, "total": db.money(total)})


@bp.post("/cart")
@C.require_login()
def cart_add():
    body = C.get_json()
    try:
        pid = C.int_of(body.get("product_id"), minimum=1)
        qty = C.int_of(body.get("quantity", 1), minimum=1, maximum=99)
        p = db.one("SELECT * FROM products WHERE id=? AND audit_status='已通过' AND shelf_status='上架'", (pid,))
        if not p:
            return C.fail(404, "这件商品暂时买不了")
        if p["stock"] < qty:
            raise ValueError(f"库存只剩 {p['stock']} 件啦")
        old = db.one("SELECT quantity FROM cart WHERE user_id=? AND product_id=?", (g.user["id"], pid))
        if old:
            db.execute("UPDATE cart SET quantity=? WHERE user_id=? AND product_id=?",
                       (min(99, old["quantity"] + qty), g.user["id"], pid))
        else:
            db.execute("INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?)",
                       (g.user["id"], pid, qty))
        return C.ok({"product_id": pid, "quantity": qty})
    except ValueError as e:
        return C.fail(422, str(e))


@bp.put("/cart/<int:cid>")
@C.require_login()
def cart_update(cid: int):
    try:
        qty = C.int_of(C.get_json().get("quantity"), minimum=1, maximum=99)
        db.execute("UPDATE cart SET quantity=? WHERE id=? AND user_id=?", (qty, cid, g.user["id"]))
        return C.ok({"id": cid, "quantity": qty})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.delete("/cart/<int:cid>")
@C.require_login()
def cart_delete(cid: int):
    db.execute("DELETE FROM cart WHERE id=? AND user_id=?", (cid, g.user["id"]))
    return C.ok({"id": cid})


@bp.post("/orders")
@C.require_login()
def create_order():
    body = C.get_json()
    try:
        C.required(body, "receiver", "phone", "address", "requestId")
        receiver = C.limited(body["receiver"], "收货人", 20)
        phone = C.limited(body["phone"], "手机号", 11)
        address = C.limited(body["address"], "收货地址", 100)
        if not phone.isdigit() or len(phone) != 11:
            raise ValueError("手机号请填 11 位数字")
        key = C.text_of(body["requestId"])
        cached = C.idem(key)
        if cached:
            return C.ok(cached)
        direct = body.get("items")
        if isinstance(direct, list) and direct:
            items = []
            for it in direct:
                pid = C.int_of(it.get("product_id"), minimum=1)
                qty = C.int_of(it.get("quantity", 1), minimum=1, maximum=99)
                p = db.one("SELECT * FROM products WHERE id=? AND shelf_status='上架'", (pid,))
                if not p:
                    raise ValueError("有件商品已经下架了，回购物车看看")
                if p["stock"] < qty:
                    raise ValueError(f"「{p['name']}」库存只剩 {p['stock']} 件")
                items.append((p, qty))
        else:
            cart_rows = db.rows("SELECT c.quantity,p.* FROM cart c JOIN products p ON p.id=c.product_id "
                                "WHERE c.user_id=?", (g.user["id"],))
            if not cart_rows:
                raise ValueError("购物车还是空的，先挑点东西吧")
            items = [(r, r["quantity"]) for r in cart_rows]
        total = sum(p["price_cent"] * q for p, q in items)
        no = SM.business_no("PM", db.one("SELECT COUNT(*) n FROM orders")["n"] + 1)
        with db.connect() as c:
            cur = c.execute("INSERT INTO orders(order_no,user_id,amount_cent,receiver,phone,address,status,"
                            "request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                            (no, g.user["id"], total, receiver, phone, address, "待支付", key, db.now()))
            oid = cur.lastrowid
            for p, q in items:
                c.execute("INSERT INTO order_items(order_id,product_id,name,price_cent,quantity) "
                          "VALUES(?,?,?,?,?)", (oid, p["id"], p["name"], p["price_cent"], q))
                c.execute("UPDATE products SET stock=stock-?,sales=sales+? WHERE id=?", (q, q, p["id"]))
            c.execute("DELETE FROM cart WHERE user_id=?", (g.user["id"],))
            c.commit()
        result = {"id": oid, "order_no": no, "status": "待支付", "amount": db.money(total),
                  "items": [{"name": p["name"], "quantity": q} for p, q in items]}
        C.idem_save(key, result)
        C.log_action(g.user["id"], "下单", no, db.money(total))
        return C.ok(result)
    except (ValueError, SM.StateError) as e:
        return C.fail(422, str(e))


@bp.get("/my/orders")
@C.require_login()
def my_orders():
    items = db.rows("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC", (g.user["id"],))
    out = []
    for i in items:
        row = C.public_amount(dict(i))
        row["items"] = [C.public_amount(x) for x in
                        db.rows("SELECT name,price_cent,quantity FROM order_items WHERE order_id=?", (i["id"],))]
        out.append(row)
    return C.ok(out)


@bp.post("/orders/<int:oid>/pay")
@C.require_login()
def pay_order(oid: int):
    row = db.one("SELECT * FROM orders WHERE id=? AND user_id=?", (oid, g.user["id"]))
    if not row:
        return C.fail(404, "没找到这笔订单")
    try:
        SM.transition(SM.ORDER, row["status"], "已支付")
    except SM.StateError as e:
        return C.fail(409, str(e))
    db.execute("UPDATE orders SET status='已支付' WHERE id=?", (oid,))
    C.log_action(g.user["id"], "支付", row["order_no"], "")
    return C.ok({"id": oid, "status": "已支付", "tip": "付好啦，农户这就给您备货"})


@bp.post("/orders/<int:oid>/cancel")
@C.require_login()
def cancel_order(oid: int):
    row = db.one("SELECT * FROM orders WHERE id=? AND user_id=?", (oid, g.user["id"]))
    if not row:
        return C.fail(404, "没找到这笔订单")
    try:
        SM.transition(SM.ORDER, row["status"], "已取消")
    except SM.StateError as e:
        return C.fail(409, str(e))
    with db.connect() as c:
        c.execute("UPDATE orders SET status='已取消' WHERE id=?", (oid,))
        for it in c.execute("SELECT product_id,quantity FROM order_items WHERE order_id=?", (oid,)):
            c.execute("UPDATE products SET stock=stock+?,sales=MAX(0,sales-?) WHERE id=?",
                      (it["quantity"], it["quantity"], it["product_id"]))
        c.commit()
    return C.ok({"id": oid, "status": "已取消"})


@bp.get("/festivals")
def festivals():
    return C.ok(db.rows("SELECT * FROM festivals WHERE status='展示中' ORDER BY id"))


@bp.get("/season-tips")
def season_tips():
    return C.ok(db.rows("SELECT * FROM season_tips ORDER BY id"))


@bp.get("/checkin-spots")
def checkin_spots():
    spots = db.rows("SELECT * FROM checkin_spots ORDER BY id")
    user = C.current_user()
    done = set()
    if user:
        done = {r["spot_id"] for r in
                db.rows("SELECT spot_id FROM checkin_records WHERE user_id=?", (user["id"],))}
    for s in spots:
        s["stamped"] = s["id"] in done
    return C.ok({"spots": spots, "stamped": len(done), "total": len(spots)})


@bp.post("/checkin")
@C.require_login()
def checkin():
    body = C.get_json()
    try:
        sid = C.int_of(body.get("spot_id"), minimum=1)
        if not db.one("SELECT id FROM checkin_spots WHERE id=?", (sid,)):
            return C.fail(404, "没找到这个打卡点")
        today = db.day(0)
        if db.one("SELECT id FROM checkin_records WHERE user_id=? AND spot_id=? AND stamp_date=?",
                  (g.user["id"], sid, today)):
            return C.fail(409, "今天这枚章已经盖过啦")
        db.execute("INSERT INTO checkin_records(user_id,spot_id,stamp_date,created_at) VALUES(?,?,?,?)",
                   (g.user["id"], sid, today, db.now()))
        n = db.one("SELECT COUNT(DISTINCT spot_id) n FROM checkin_records WHERE user_id=?",
                   (g.user["id"],))["n"]
        total = db.one("SELECT COUNT(*) n FROM checkin_spots")["n"]
        return C.ok({"stamped": n, "total": total,
                     "tip": "六枚章集齐啦，到游客中心换一份青梅伴手礼！" if n >= total
                            else f"又盖上一枚，已经集了 {n}/{total} 枚，接着逛～"})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.get("/my/overview")
@C.require_login()
def my_overview():
    uid = g.user["id"]
    counts = {
        "orders": db.one("SELECT COUNT(*) n FROM orders WHERE user_id=?", (uid,))["n"],
        "reservations": db.one("SELECT COUNT(*) n FROM reservations WHERE user_id=?", (uid,))["n"],
        "research": db.one("SELECT COUNT(*) n FROM research_signups WHERE user_id=?", (uid,))["n"],
        "homestays": db.one("SELECT COUNT(*) n FROM homestay_bookings WHERE user_id=?", (uid,))["n"],
        "stamps": db.one("SELECT COUNT(DISTINCT spot_id) n FROM checkin_records WHERE user_id=?", (uid,))["n"],
    }
    return C.ok({"nickname": g.user["nickname"], "role": g.user["role"], "counts": counts,
                 "bookings": db.rows("SELECT 'reservation' AS type,code,status,checkin_code,visit_date AS date "
                                     "FROM reservations WHERE user_id=? UNION ALL "
                                     "SELECT 'research',code,status,checkin_code,created_at FROM research_signups "
                                     "WHERE user_id=? UNION ALL "
                                     "SELECT 'homestay',code,status,checkin_code,check_in FROM homestay_bookings "
                                     "WHERE user_id=? ORDER BY date DESC", (uid, uid, uid))})
