"""统一状态机：三端、所有接口共用同一份流转规则，避免各写一套导致状态错乱。"""
from __future__ import annotations

from datetime import date
from uuid import uuid4

ORDER = "order"
BOOKING = "booking"
AUDIT = "audit"
SHELF = "shelf"

TRANSITIONS: dict[str, dict[str, set[str]]] = {
    ORDER: {
        "待支付": {"已支付", "已取消"},
        "已支付": {"已发货", "已退款"},
        "已发货": {"已完成"},
        "已完成": set(),
        "已取消": set(),
        "已退款": set(),
    },
    BOOKING: {
        "待核销": {"已核销", "已取消", "已过期"},
        "已核销": set(),
        "已取消": set(),
        "已过期": set(),
    },
    AUDIT: {
        "待审核": {"已通过", "已驳回"},
        "已通过": set(),
        "已驳回": {"待审核"},
    },
    SHELF: {
        "下架": {"上架"},
        "上架": {"下架"},
    },
}

# 需要核销码的业务表，商户工作台与后台共用
CHECKIN_TABLES = {
    "reservation": ("reservations", "预约"),
    "research": ("research_signups", "研学报名"),
    "homestay": ("homestay_bookings", "民宿预订"),
}


class StateError(ValueError):
    """非法状态迁移，统一转成 409 / 422 业务错误。"""


def can_transition(kind: str, old: str, new: str) -> bool:
    return new in TRANSITIONS.get(kind, {}).get(old, set())


def transition(kind: str, old: str, new: str) -> str:
    if old == new:
        raise StateError(f"状态已经是「{old}」，不用重复操作")
    if not can_transition(kind, old, new):
        allowed = "、".join(sorted(TRANSITIONS[kind].get(old, set()))) or "不可再变更"
        raise StateError(f"「{old}」不能直接变成「{new}」，当前只允许：{allowed}")
    return new


def business_no(prefix: str, seq: int) -> str:
    return f"{prefix}{date.today().strftime('%Y%m%d')}{seq:04d}"


def checkin_code() -> str:
    return "CK" + uuid4().hex[:10].upper()


def bookable(session: dict, people: int) -> None:
    """场次名额校验：预约、报名共用。"""
    if session["audit_status"] != "已通过":
        raise StateError("这场还没通过审核，暂时约不了")
    left = session["capacity"] - session["booked"]
    if left < people:
        raise StateError(f"这场只剩 {max(left, 0)} 个位置了，换个场次看看")
