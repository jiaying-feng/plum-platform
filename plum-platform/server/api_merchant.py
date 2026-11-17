"""农户 / 民宿商户 H5 工作台 API：场次、房间、商品、订单、统一核销。"""
from __future__ import annotations

from flask import Blueprint, g, request

from server import api_common as C
from server import db, state_machine as SM

bp = Blueprint("merchant", __name__, url_prefix="/api/merchant")


def _merchant_id() -> int | None:
    return g.user.get("merchant_id")


@bp.get("/overview")
@C.require_login("商户", "管理员")
def overview():
    mid = _merchant_id()
    today = db.day(0)
    # orders / reservations 是平台级单据，不挂 merchant_id；商品才按商户归属过滤
    sale_sql = "SELECT COUNT(*) n FROM products WHERE shelf_status='上架' AND audit_status='已通过'"
    sale_args: tuple = ()
    if mid:
        sale_sql += " AND merchant_id=?"
        sale_args = (mid,)
    return C.ok({
        "today_orders": db.one("SELECT COUNT(*) n FROM orders WHERE substr(created_at,1,10)=?",
                               (today,))["n"],
        "pending_checkin": sum(db.one(f"SELECT COUNT(*) n FROM {t} WHERE status='待核销'")["n"]
                               for t, _ in SM.CHECKIN_TABLES.values()),
        "on_sale": db.one(sale_sql, sale_args)["n"],
        "today_bookings": db.one("SELECT COUNT(*) n FROM reservations WHERE visit_date=?",
                                 (today,))["n"],
        "merchant_id": mid,
    })


@bp.get("/sessions")
@C.require_login("商户", "管理员")
def sessions():
    mid = _merchant_id()
    sql = ("SELECT s.*, o.name AS orchard_name FROM orchard_sessions s "
           "LEFT JOIN orchards o ON o.id=s.orchard_id")
    args: tuple = ()
    if mid:
        sql += " WHERE o.merchant_id=?"
        args = (mid,)
    sql += " ORDER BY s.session_date,s.slot LIMIT 100"
    return C.ok(db.rows(sql, args))


@bp.post("/sessions")
@C.require_login("商户", "管理员")
def create_session():
    body = C.get_json()
    try:
        oid = C.int_of(body.get("orchard_id"), minimum=1)
        d = C.limited(body.get("session_date"), "日期", 10)
        slot = C.limited(body.get("slot"), "时段", 30)
        cap = C.int_of(body.get("capacity"), minimum=1, maximum=500)
        if not db.one("SELECT id FROM orchards WHERE id=?", (oid,)):
            return C.fail(404, "没找到这个园子")
        sid = db.execute("INSERT INTO orchard_sessions(orchard_id,session_date,slot,capacity,booked,"
                         "audit_status,status) VALUES(?,?,?,?,0,'待审核','可预约')", (oid, d, slot, cap))
        C.log_action(g.user["id"], "新增场次", str(sid), f"{d} {slot}")
        return C.ok({"id": sid, "audit_status": "待审核", "tip": "场次已提交，等镇上审核通过就能开放预约"})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.put("/sessions/<int:sid>")
@C.require_login("商户", "管理员")
def update_session(sid: int):
    body = C.get_json()
    row = db.one("SELECT * FROM orchard_sessions WHERE id=?", (sid,))
    if not row:
        return C.fail(404, "没找到这场")
    try:
        cap = C.int_of(body.get("capacity", row["capacity"]), minimum=row["booked"], maximum=500)
        status = C.text_of(body.get("status"), row["status"])
        if status not in ("可预约", "已满", "停办"):
            raise ValueError("场次状态不对")
        db.execute("UPDATE orchard_sessions SET capacity=?,status=? WHERE id=?", (cap, status, sid))
        return C.ok({"id": sid, "capacity": cap, "status": status})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.get("/rooms")
@C.require_login("商户", "管理员")
def rooms():
    mid = _merchant_id()
    sql = ("SELECT r.*, h.name AS homestay_name FROM rooms r "
           "LEFT JOIN homestays h ON h.id=r.homestay_id")
    args: tuple = ()
    if mid:
        sql += " WHERE h.merchant_id=?"
        args = (mid,)
    sql += " ORDER BY r.id"
    return C.ok([C.public_amount(r) for r in db.rows(sql, args)])


@bp.put("/rooms/<int:rid>")
@C.require_login("商户", "管理员")
def update_room(rid: int):
    body = C.get_json()
    row = db.one("SELECT * FROM rooms WHERE id=?", (rid,))
    if not row:
        return C.fail(404, "没找到这个房型")
    try:
        price_yuan = C.text_of(body.get("price"))
        cent = int(round(float(price_yuan) * 100)) if price_yuan else row["price_cent"]
        stock = C.int_of(body.get("stock", row["stock"]), minimum=0, maximum=99)
        name = C.limited(body.get("name", row["name"]), "房型名", 30)
        db.execute("UPDATE rooms SET name=?,price_cent=?,stock=? WHERE id=?", (name, cent, stock, rid))
        return C.ok({"id": rid, "name": name, "price": db.money(cent), "stock": stock})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.post("/rooms")
@C.require_login("商户", "管理员")
def create_room():
    body = C.get_json()
    try:
        hid = C.int_of(body.get("homestay_id"), minimum=1)
        name = C.limited(body.get("name"), "房型名", 30)
        price = C.text_of(body.get("price"))
        cent = int(round(float(price) * 100))
        cap = C.int_of(body.get("capacity", 2), minimum=1, maximum=10)
        stock = C.int_of(body.get("stock", 1), minimum=0, maximum=99)
        rid = db.execute("INSERT INTO rooms(homestay_id,name,capacity,price_cent,stock,image) "
                         "VALUES(?,?,?,?,?,?)", (hid, name, cap, cent, stock, "/assets/homestay.webp"))
        return C.ok({"id": rid, "name": name, "price": db.money(cent)})
    except (ValueError, TypeError) as e:
        return C.fail(400, str(e))


@bp.get("/products")
@C.require_login("商户", "管理员")
def products():
    body = request.args.to_dict()
    mid = _merchant_id()
    sql = "SELECT p.*,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id"
    args: tuple = ()
    if mid:
        sql += " WHERE p.merchant_id=?"
        args = (mid,)
    sql += " ORDER BY p.id"
    items = [C.public_amount(dict(r)) for r in db.rows(sql, args)]
    return C.ok(C.paginate(items, body))


@bp.post("/products")
@C.require_login("商户", "管理员")
def create_product():
    body = C.get_json()
    try:
        name = C.limited(body.get("name"), "商品名", 50)
        subtitle = C.limited(body.get("subtitle", "本地手作，量少等下一季"), "副标题", 60)
        cat = C.int_of(body.get("category_id", 1), minimum=1)
        price = C.text_of(body.get("price"))
        cent = int(round(float(price) * 100))
        if cent <= 0:
            raise ValueError("价格要大于 0")
        stock = C.int_of(body.get("stock", 0), minimum=0, maximum=99999)
        pid = db.execute("INSERT INTO products(merchant_id,category_id,name,subtitle,price_cent,stock,sales,"
                         "image,intro,audit_status,shelf_status) VALUES(?,?,?,?,?,?,0,?,?,'待审核','下架')",
                         (_merchant_id() or 1, cat, name, subtitle, cent, stock,
                          f"/assets/product_{(stock % 18) + 1:02d}.png",
                          C.limited(body.get("intro", "自家做的，没有花里胡哨的添加"), "介绍", 200)))
        C.log_action(g.user["id"], "新增商品", name, "待审核")
        return C.ok({"id": pid, "audit_status": "待审核", "tip": "商品已提交，等审核通过后就能上架"})
    except (ValueError, TypeError) as e:
        return C.fail(400, str(e))


@bp.put("/products/<int:pid>")
@C.require_login("商户", "管理员")
def update_product(pid: int):
    body = C.get_json()
    row = db.one("SELECT * FROM products WHERE id=?", (pid,))
    if not row:
        return C.fail(404, "没找到这件商品")
    try:
        action = C.text_of(body.get("action"))
        if action == "shelf":
            if row["audit_status"] != "已通过":
                return C.fail(422, "还没审核通过，先等镇上审一批")
            target = "上架" if row["shelf_status"] == "下架" else "下架"
            SM.transition(SM.SHELF, row["shelf_status"], target)
            db.execute("UPDATE products SET shelf_status=? WHERE id=?", (target, pid))
            return C.ok({"id": pid, "shelf_status": target})
        price = C.text_of(body.get("price"))
        cent = int(round(float(price) * 100)) if price else row["price_cent"]
        stock = C.int_of(body.get("stock", row["stock"]), minimum=0, maximum=99999)
        name = C.limited(body.get("name", row["name"]), "商品名", 50)
        db.execute("UPDATE products SET name=?,price_cent=?,stock=? WHERE id=?", (name, cent, stock, pid))
        return C.ok({"id": pid, "name": name, "price": db.money(cent), "stock": stock})
    except (ValueError, SM.StateError) as e:
        return C.fail(422, str(e))


@bp.get("/orders")
@C.require_login("商户", "管理员")
def orders():
    body = request.args.to_dict()
    status = C.text_of(body.get("status"))
    sql = "SELECT * FROM orders"
    args: tuple = ()
    if status:
        sql += " WHERE status=?"
        args = (status,)
    sql += " ORDER BY id DESC"
    items = [C.public_amount(dict(r)) for r in db.rows(sql, args)]
    for i in items:
        i["items"] = [C.public_amount(x) for x in
                      db.rows("SELECT name,price_cent,quantity FROM order_items WHERE order_id=?", (i["id"],))]
    return C.ok(C.paginate(items, body))


@bp.post("/orders/<int:oid>/ship")
@C.require_login("商户", "管理员")
def ship_order(oid: int):
    row = db.one("SELECT * FROM orders WHERE id=?", (oid,))
    if not row:
        return C.fail(404, "没找到这笔订单")
    try:
        SM.transition(SM.ORDER, row["status"], "已发货")
    except SM.StateError as e:
        return C.fail(409, str(e))
    db.execute("UPDATE orders SET status='已发货' WHERE id=?", (oid,))
    C.log_action(g.user["id"], "发货", row["order_no"], "")
    return C.ok({"id": oid, "status": "已发货"})


@bp.get("/bookings")
@C.require_login("商户", "管理员")
def bookings():
    """三张业务表汇总成一张「待办核销」列表，商户不用记哪种码属于哪张表。"""
    out = []
    for kind, (table, label) in SM.CHECKIN_TABLES.items():
        for r in db.rows(f"SELECT code,status,checkin_code,created_at FROM {table} "
                         f"WHERE status='待核销' ORDER BY id DESC LIMIT 30"):
            out.append({"type": kind, "type_label": label, "code": r["code"],
                        "checkin_code": r["checkin_code"], "status": r["status"],
                        "created_at": r["created_at"]})
    return C.ok(out)


@bp.post("/checkin")
@C.require_login("商户", "管理员")
def checkin():
    """统一核销：预约 / 研学报名 / 民宿预订走同一套状态流转。"""
    body = C.get_json()
    code = C.text_of(body.get("checkin_code")).upper()
    if not code:
        return C.fail(400, "请输入或扫描核销码")
    for kind, (table, label) in SM.CHECKIN_TABLES.items():
        row = db.one(f"SELECT * FROM {table} WHERE checkin_code=?", (code,))
        if not row:
            continue
        try:
            SM.transition(SM.BOOKING, row["status"], "已核销")
        except SM.StateError as e:
            return C.fail(409, str(e))
        db.execute(f"UPDATE {table} SET status='已核销' WHERE id=?", (row["id"],))
        C.log_action(g.user["id"], f"核销-{label}", row["code"], code)
        return C.ok({"type": kind, "type_label": label, "code": row["code"],
                     "status": "已核销", "tip": f"{label}核销好啦，玩得开心！"})
    return C.fail(404, "没找到这个核销码，再核对一下")
