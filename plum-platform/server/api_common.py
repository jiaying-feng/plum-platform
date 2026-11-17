"""公共层：统一响应、输入校验、会话、分页、幂等、操作日志。"""
from __future__ import annotations

import functools
import time
from typing import Callable
from uuid import uuid4

from flask import g, jsonify, request

from server import db

# 内存会话与幂等表：本地演示无需任何外部组件，重启自动清空
_SESSIONS: dict[str, dict] = {}
_IDEMPOTENCY: dict[str, tuple[float, dict]] = {}
_IDEMPOTENCY_TTL = 300

ERROR_STATUS = {404: 404, 405: 405, 500: 500}


def ok(data=None) -> tuple:
    return jsonify({"code": 200, "msg": "success", "data": data if data is not None else {}}), 200


def fail(code: int, msg: str, http_status: int = 200) -> tuple:
    return jsonify({"code": code, "msg": msg, "data": None}), http_status or ERROR_STATUS.get(code, 200)


def get_json() -> dict:
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def text_of(value, default: str = "") -> str:
    if value is None:
        return default
    return (value if isinstance(value, str) else str(value)).strip() or default


def int_of(value, default: int | None = None, minimum: int | None = None,
           maximum: int | None = None) -> int:
    """严格整数解析：拒绝布尔、拒绝 1.9 这类非整值。"""
    if isinstance(value, bool):
        raise ValueError("需要填一个整数")
    if isinstance(value, int):
        n = value
    elif isinstance(value, str) and value.strip().lstrip("-").isdigit():
        n = int(value.strip())
    else:
        if default is not None:
            return default
        raise ValueError("需要填一个整数")
    if minimum is not None and n < minimum:
        raise ValueError(f"不能小于 {minimum}")
    if maximum is not None and n > maximum:
        raise ValueError(f"不能大于 {maximum}")
    return n


def required(body: dict, *fields: str) -> None:
    missing = [f for f in fields if f not in body or text_of(body.get(f)) == ""]
    if missing:
        raise ValueError("请填写：" + "、".join(missing))


def limited(value: str, field: str, max_len: int, min_len: int = 1) -> str:
    value = text_of(value)
    if len(value) < min_len:
        raise ValueError(f"{field}不能为空")
    if len(value) > max_len:
        raise ValueError(f"{field}请控制在 {max_len} 字以内")
    return value


def create_session(user: dict) -> str:
    sid = uuid4().hex
    _SESSIONS[sid] = {k: user[k] for k in ("id", "username", "nickname", "role")}
    _SESSIONS[sid]["merchant_id"] = None
    m = db.one("SELECT id FROM merchants WHERE user_id=? AND audit_status='已通过'", (user["id"],))
    if m:
        _SESSIONS[sid]["merchant_id"] = m["id"]
    return sid


def current_user() -> dict | None:
    sid = request.headers.get("X-Session-Id", "")
    return _SESSIONS.get(sid)


def require_login(*roles: str) -> Callable:
    """登录校验；roles 为空表示任意已登录用户，否则要求指定角色。"""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return fail(401, "请先登录，再接着办")
            if roles and user["role"] not in roles:
                return fail(403, "这个页面需要对应身份才能进")
            g.user = user
            return fn(*args, **kwargs)
        return wrapper
    return deco


def idem(key: str) -> dict | None:
    """幂等：同一个 requestId 在 5 分钟内只生效一次。"""
    now = time.time()
    for k, (ts, _) in list(_IDEMPOTENCY.items()):
        if now - ts > _IDEMPOTENCY_TTL:
            _IDEMPOTENCY.pop(k, None)
    hit = _IDEMPOTENCY.get(key)
    return hit[1] if hit else None


def idem_save(key: str, data: dict) -> None:
    _IDEMPOTENCY[key] = (time.time(), data)


def paginate(items: list, body: dict) -> dict:
    try:
        page_num = max(1, int_of(body.get("pageNum"), 1, 1))
        page_size = max(1, min(100, int_of(body.get("pageSize"), 20, 1)))
    except ValueError as e:
        raise ValueError(str(e))
    total = len(items)
    start = (page_num - 1) * page_size
    return {"records": items[start:start + page_size], "total": total,
            "current": page_num, "size": page_size}


def log_action(user_id: int | None, action: str, target: str, detail: str = "") -> None:
    db.execute("INSERT INTO operation_logs(user_id,action,target,detail,created_at) VALUES(?,?,?,?,?)",
               (user_id, action, target, detail, db.now()))


def public_amount(row: dict, field: str = "amount_cent") -> dict:
    """对外统一把「分」转成两位小数字符串，避免浮点误差。"""
    row = dict(row)
    if field in row and row[field] is not None:
        row["amount"] = db.money(row.pop(field))
    else:
        row.pop(field, None)
    for key in list(row):
        if key.endswith("_cent") and isinstance(row[key], int):
            row[key[:-5]] = db.money(row.pop(key))
    return row
