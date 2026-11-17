"""AI 问答域的 MySQL 存储层：会话、消息、调用日志。

职责边界：
- 只存「问答域」数据，不碰 21 张业务表；业务事实始终由 server/db.py 实时查询；
- PyMySQL 是唯一可选依赖，未安装 / 未配置 / 连不上时自动降级为进程内内存历史，
  主流程照常返回答案，绝不因为记日志失败而让问答不可用；
- 不用 ORM、不用连接池、不用迁移框架，每次操作一条短连接。
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from server import ai_config

try:
    import pymysql
    from pymysql.cursors import DictCursor
except ImportError:  # 未装可选依赖时，整个模块仍然可导入、可调用
    pymysql = None
    DictCursor = None

log = logging.getLogger("plum.ai_store")
ROOT = Path(__file__).resolve().parent.parent
SQL_FILE = ROOT / "sql" / "ai_qa.sql"

# MySQL 关闭时的兜底：只保留最近 40 条，重启即清空，不落盘、不依赖任何服务
_MEM: dict[str, list[dict]] = {}

_DDL_SESSION = ("INSERT IGNORE INTO ai_sessions(id,channel,created_at,updated_at) "
                "VALUES(%s,%s,%s,%s)")


def driver_installed() -> bool:
    return pymysql is not None


def available() -> bool:
    cfg = ai_config.mysql()
    return bool(cfg["enabled"] and pymysql is not None and cfg["host"] and cfg["user"])


def status() -> dict:
    cfg = ai_config.mysql()
    return {
        "enabled": cfg["enabled"],
        "driver_installed": driver_installed(),
        "available": available(),
        "mode": "mysql" if available() else "memory",
        "host": cfg["host"], "port": cfg["port"], "database": cfg["database"],
        "hint": "" if available() else (
            "未安装 PyMySQL，执行 python -m pip install -r requirements-ai.txt" if not driver_installed()
            else "MYSQL_ENABLED=0 或连接信息不完整，当前使用内存历史"),
    }


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect(database: bool = True):
    cfg = ai_config.mysql()
    kwargs = dict(
        host=cfg["host"], port=cfg["port"], user=cfg["user"], password=cfg["password"],
        charset=cfg["charset"], connect_timeout=cfg["connect_timeout"],
        cursorclass=DictCursor, autocommit=True,
    )
    if database:
        kwargs["database"] = cfg["database"]
    return pymysql.connect(**kwargs)


def init_schema() -> dict:
    """按 sql/ai_qa.sql 建库建表；由 tools/init_ai_db.py 调用。"""
    if not driver_installed():
        return {"ok": False, "msg": "缺少 PyMySQL，请先执行 python -m pip install -r requirements-ai.txt"}
    if not SQL_FILE.is_file():
        return {"ok": False, "msg": f"找不到建表脚本：{SQL_FILE}"}
    cfg = ai_config.mysql()
    text = SQL_FILE.read_text(encoding="utf-8").replace("plum_ai", cfg["database"])
    lines = [ln for ln in text.splitlines() if not ln.strip().startswith("--")]
    statements = [s.strip() for s in "\n".join(lines).split(";") if s.strip()
                  and not s.strip().upper().startswith("USE ")]
    conn = None
    try:
        conn = connect(database=False)
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION() AS v")
            version = cur.fetchone()["v"]
            for sql in statements:
                cur.execute(sql)
        return {"ok": True, "msg": f"MySQL {version}：已执行 {len(statements)} 条 DDL",
                "database": cfg["database"], "statements": len(statements)}
    except Exception as e:  # 连接失败 / 权限不足，统一给出可操作提示
        return {"ok": False, "msg": f"初始化失败：{type(e).__name__}: {e}"}
    finally:
        if conn is not None:
            conn.close()


def new_session_id() -> str:
    return uuid4().hex


def touch_session(session_id: str, channel: str = "web") -> None:
    if not available() or not session_id:
        return
    now = _now()
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(_DDL_SESSION, (session_id, channel[:24], now, now))
            cur.execute("UPDATE ai_sessions SET updated_at=%s WHERE id=%s", (now, session_id))
    except Exception as e:
        log.warning("写 ai_sessions 失败，已忽略：%s", e)


def append(session_id: str, role: str, content: str, source: str = "",
           engine: str = "", model: str = "") -> None:
    """记一条消息；内存兜底始终写入，MySQL 失败只告警。"""
    if not session_id or role not in ("user", "assistant"):
        return
    item = {"role": role, "content": str(content or "")[:2000]}
    buf = _MEM.setdefault(session_id, [])
    buf.append(item)
    if len(buf) > 40:
        del buf[:-40]
    if not available():
        return
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(_DDL_SESSION, (session_id, "api", _now(), _now()))
            cur.execute("INSERT INTO ai_messages(session_id,role,content,source,engine,model,created_at) "
                        "VALUES(%s,%s,%s,%s,%s,%s,%s)",
                        (session_id, role, item["content"], source[:32], engine[:16], model[:64], _now()))
            cur.execute("UPDATE ai_sessions SET updated_at=%s WHERE id=%s", (_now(), session_id))
    except Exception as e:
        log.warning("写 ai_messages 失败，已忽略：%s", e)


def recent(session_id: str, limit: int = 6) -> list[dict]:
    """取最近若干轮，按时间正序返回 [{role, content}]，供多轮对话使用。"""
    try:
        limit = max(0, min(20, int(limit)))
    except (TypeError, ValueError):
        limit = 0
    if not session_id or limit == 0:
        return []
    if available():
        try:
            with connect() as conn, conn.cursor() as cur:
                cur.execute("SELECT role,content FROM ai_messages WHERE session_id=%s "
                            "ORDER BY id DESC LIMIT %s", (session_id, limit))
                found = cur.fetchall()
            return [{"role": r["role"], "content": r["content"]} for r in reversed(found)]
        except Exception as e:
            log.warning("读 ai_messages 失败，已回退内存历史：%s", e)
    return [dict(x) for x in _MEM.get(session_id, [])[-limit:]]


def log_call(session_id: str, question: str, ok: bool, engine: str, model: str,
             latency_ms: int, error: str = "") -> None:
    """外部模型调用审计：成功/失败都记，便于排查配额、超时与回退率。"""
    if not available():
        return
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO ai_call_logs(session_id,question,ok,engine,model,latency_ms,error,created_at) "
                        "VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                        (session_id[:36], str(question)[:300], 1 if ok else 0, engine[:16],
                         model[:64], int(latency_ms or 0), str(error)[:500], _now()))
    except Exception as e:
        log.warning("写 ai_call_logs 失败，已忽略：%s", e)
