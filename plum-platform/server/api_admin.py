"""PC 管理后台 API：数据看板、商户/场次/商品审核、活动发布、单据与日志。

所有图表统一返回 {labels: [], series: [{name, data}]}，前端只需一个渲染器。
"""
from __future__ import annotations

from datetime import date, timedelta

from flask import Blueprint, g, request

from server import api_common as C
from server import db, state_machine as SM

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


def _recent_days(n: int = 7) -> list[str]:
    return [(date.today() - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


@bp.get("/dashboard")
@C.require_login("管理员")
def dashboard():
    days = _recent_days(7)
    labels = [d[5:] for d in days]
    res_counts, order_amounts = [], []
    for d in days:
        res_counts.append(db.one("SELECT COUNT(*) n FROM reservations WHERE substr(created_at,1,10)=?",
                                 (d,))["n"])
        order_amounts.append(db.one("SELECT COALESCE(SUM(amount_cent),0) s FROM orders "
                                    "WHERE substr(created_at,1,10)=? AND status IN "
                                    "('已支付','已发货','已完成')", (d,))["s"] / 100)
    cats = db.rows("SELECT c.name, COALESCE(SUM(o.amount_cent),0) s FROM categories c "
                   "LEFT JOIN products p ON p.category_id=c.id "
                   "LEFT JOIN order_items oi ON oi.product_id=p.id "
                   "LEFT JOIN orders o ON o.id=oi.order_id AND o.status IN ('已支付','已发货','已完成') "
                   "GROUP BY c.id ORDER BY c.sort")
    tops = db.rows("SELECT name,sales FROM products WHERE audit_status='已通过' "
                   "ORDER BY sales DESC,name LIMIT 5")
    return C.ok({
        "cards": {
            "today_reservation": db.one("SELECT COUNT(*) n FROM reservations WHERE visit_date=?",
                                        (db.day(0),))["n"],
            "pending_merchant": db.one("SELECT COUNT(*) n FROM merchants WHERE audit_status='待审核'")["n"],
            "pending_session": db.one("SELECT COUNT(*) n FROM orchard_sessions WHERE audit_status='待审核'")["n"],
            "pending_product": db.one("SELECT COUNT(*) n FROM products WHERE audit_status='待审核'")["n"],
            "total_sales": db.money(db.one("SELECT COALESCE(SUM(amount_cent),0) s FROM orders "
                                           "WHERE status IN ('已支付','已发货','已完成')")["s"]),
            "total_orders": db.one("SELECT COUNT(*) n FROM orders")["n"],
        },
        "charts": {
            "trend": {"labels": labels,
                      "series": [{"name": "预约数", "data": res_counts},
                                 {"name": "销售额", "data": [round(x, 2) for x in order_amounts]}]},
            "category_sales": {"labels": [r["name"] for r in cats],
                               "series": [{"name": "销售额", "data": [round(r["s"] / 100, 2)
                                                                  for r in cats]}]},
            "top_products": {"labels": [r["name"] for r in tops],
                             "series": [{"name": "销量", "data": [r["sales"] for r in tops]}]},
        },
    })


def _audit(table: str, item_id: int, body: dict, label: str, extra: str = ""):
    row = db.one(f"SELECT * FROM {table} WHERE id=?", (item_id,))
    if not row:
        return C.fail(404, f"没找到这条{label}记录")
    action = C.text_of(body.get("action"))
    if action not in ("通过", "驳回"):
        return C.fail(400, "action 只能是「通过」或「驳回」")
    note = C.text_of(body.get("note"))
    if action == "驳回" and not note:
        return C.fail(422, "驳回得写一句原因，商户好改")
    if len(note) > 100:
        return C.fail(400, "审核意见请控制在 100 字以内")
    target = "已通过" if action == "通过" else "已驳回"
    try:
        SM.transition(SM.AUDIT, row["audit_status"], target)
    except SM.StateError as e:
        return C.fail(409, str(e))
    db.execute(f"UPDATE {table} SET audit_status=?,audit_note=? WHERE id=?", (target, note, item_id))
    if extra == "product" and target == "已通过":
        db.execute("UPDATE products SET shelf_status='上架' WHERE id=?", (item_id,))
    C.log_action(g.user["id"], f"审核-{label}", str(item_id), f"{target} {note}")
    return C.ok({"id": item_id, "audit_status": target, "note": note})


@bp.get("/merchants")
@C.require_login("管理员")
def merchants():
    return C.ok(db.rows("SELECT * FROM merchants ORDER BY audit_status='待审核' DESC,id"))


@bp.post("/merchants/<int:mid>/audit")
@C.require_login("管理员")
def audit_merchant(mid: int):
    return _audit("merchants", mid, C.get_json(), "商户")


@bp.get("/sessions")
@C.require_login("管理员")
def sessions():
    return C.ok(db.rows("SELECT s.*,o.name AS orchard_name FROM orchard_sessions s "
                        "LEFT JOIN orchards o ON o.id=s.orchard_id "
                        "ORDER BY s.audit_status='待审核' DESC,s.session_date LIMIT 100"))


@bp.post("/sessions/<int:sid>/audit")
@C.require_login("管理员")
def audit_session(sid: int):
    return _audit("orchard_sessions", sid, C.get_json(), "场次")


@bp.get("/products")
@C.require_login("管理员")
def products():
    items = [C.public_amount(dict(r)) for r in
             db.rows("SELECT p.*,c.name AS category_name FROM products p "
                     "LEFT JOIN categories c ON c.id=p.category_id "
                     "ORDER BY p.audit_status='待审核' DESC,p.id")]
    return C.ok(items)


@bp.post("/products/<int:pid>/audit")
@C.require_login("管理员")
def audit_product(pid: int):
    return _audit("products", pid, C.get_json(), "商品", extra="product")


@bp.get("/festivals")
@C.require_login("管理员")
def festivals():
    return C.ok(db.rows("SELECT * FROM festivals ORDER BY id"))


@bp.post("/festivals")
@C.require_login("管理员")
def create_festival():
    body = C.get_json()
    try:
        C.required(body, "title", "festival_date", "place")
        title = C.limited(body["title"], "活动名", 40)
        when = C.limited(body["festival_date"], "时间", 30)
        place = C.limited(body["place"], "地点", 40)
        intro = C.limited(body.get("intro", ""), "介绍", 200, min_len=0)
        image = C.text_of(body.get("image"), "/assets/banner_01.webp")
        fid = db.execute("INSERT INTO festivals(title,festival_date,place,intro,image,status) "
                         "VALUES(?,?,?,?,?,'展示中')", (title, when, place, intro, image))
        C.log_action(g.user["id"], "发布活动", title, "")
        return C.ok({"id": fid, "title": title, "tip": "活动已经放到游客端首页啦"})
    except ValueError as e:
        return C.fail(400, str(e))


@bp.put("/festivals/<int:fid>")
@C.require_login("管理员")
def update_festival(fid: int):
    body = C.get_json()
    if not db.one("SELECT id FROM festivals WHERE id=?", (fid,)):
        return C.fail(404, "没找到这个活动")
    status = C.text_of(body.get("status"), "展示中")
    if status not in ("展示中", "已下线"):
        return C.fail(400, "状态不对")
    db.execute("UPDATE festivals SET status=? WHERE id=?", (status, fid))
    return C.ok({"id": fid, "status": status})


@bp.get("/orders")
@C.require_login("管理员")
def orders():
    body = request.args.to_dict()
    status = C.text_of(body.get("status"))
    sql, args = "SELECT * FROM orders", ()
    if status:
        sql, args = sql + " WHERE status=?", (status,)
    sql += " ORDER BY id DESC"
    return C.ok(C.paginate([C.public_amount(dict(r)) for r in db.rows(sql, args)], body))


@bp.get("/reservations")
@C.require_login("管理员")
def reservations():
    body = request.args.to_dict()
    items = [C.public_amount(dict(r)) for r in
             db.rows("SELECT r.*,o.name AS orchard_name FROM reservations r "
                     "LEFT JOIN orchards o ON o.id=r.orchard_id ORDER BY r.id DESC")]
    return C.ok(C.paginate(items, body))


@bp.get("/users")
@C.require_login("管理员")
def users():
    body = request.args.to_dict()
    kw, role = C.text_of(body.get("keyword")), C.text_of(body.get("role"))
    sql, args = "SELECT id,username,nickname,phone,role,status,created_at FROM users", ()
    conds = []
    if kw:
        conds.append("(username LIKE ? OR nickname LIKE ? OR phone LIKE ?)")
        args = (f"%{kw}%",) * 3
    if role:
        conds.append("role=?")
        args += (role,)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY id"
    return C.ok(C.paginate(db.rows(sql, args), body))


@bp.get("/logs")
@C.require_login("管理员")
def logs():
    return C.ok(db.rows("SELECT l.*,u.nickname FROM operation_logs l "
                        "LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 50"))
