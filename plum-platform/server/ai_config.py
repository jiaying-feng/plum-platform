"""AI 扩展域配置中心：环境变量 > 项目根目录 ai.env > 内置默认值。

职责边界：只负责「读配置」和「对外脱敏」，不含任何业务判断、网络调用或写库动作。
密钥只在本模块内部流转，public() 永远不会返回完整密钥。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = Path(os.getenv("PLUM_AI_ENV_FILE", str(ROOT / "ai.env")))

_TRUE = {"1", "true", "yes", "on", "y"}


def _read_env_file() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV_FILE.is_file():
        return out
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


_FILE = _read_env_file()


def reload_env() -> None:
    """改完 ai.env 后可在进程内重载；生产上更推荐直接重启服务。"""
    global _FILE
    _FILE = _read_env_file()


def get(key: str, default: str = "") -> str:
    """环境变量优先，其次 ai.env，最后默认值。显式设置为空串也会生效。"""
    if key in os.environ:
        return os.environ[key]
    return _FILE.get(key, default)


def flag(key: str, default: bool = False) -> bool:
    raw = get(key).strip().lower()
    return default if raw == "" else raw in _TRUE


def number(key: str, default: float, low: float, high: float) -> float:
    try:
        value = float(get(key, str(default)))
    except (TypeError, ValueError):
        return default
    return min(high, max(low, value))


def integer(key: str, default: int, low: int, high: int) -> int:
    return int(number(key, default, low, high))


def _extra_body() -> dict:
    """供厂商私有请求参数使用，例如 {\"top_p\":0.9}；解析失败一律忽略。"""
    raw = get("LLM_EXTRA_BODY", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def llm() -> dict:
    """外部大模型（OpenAI 兼容 /chat/completions）的全部调用参数。"""
    base = get("LLM_API_BASE", "https://api.openai.com/v1").rstrip("/")
    path = get("LLM_CHAT_PATH", "/chat/completions").strip() or "/chat/completions"
    path = path if path.startswith("/") else "/" + path
    url = base if base.endswith(path) else base + path
    return {
        "enabled": flag("LLM_ENABLED"),
        "url": url,
        "api_base": base,
        "api_key": get("LLM_API_KEY").strip(),
        "key_header": get("LLM_API_KEY_HEADER", "Authorization").strip() or "Authorization",
        "key_prefix": get("LLM_API_KEY_PREFIX", "Bearer").strip(),
        "model": get("LLM_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        "temperature": number("LLM_TEMPERATURE", 0.3, 0.0, 2.0),
        "max_tokens": integer("LLM_MAX_TOKENS", 400, 64, 4096),
        "timeout": number("LLM_TIMEOUT", 12, 2, 60),
        "retry": integer("LLM_RETRY", 0, 0, 2),
        "max_history": integer("LLM_MAX_HISTORY", 6, 0, 20),
        "max_answer_chars": integer("LLM_MAX_ANSWER_CHARS", 600, 100, 4000),
        "system_extra": get("LLM_SYSTEM_PROMPT", "").strip(),
        "extra_body": _extra_body(),
    }


def mysql() -> dict:
    """MySQL 连接参数：只服务 AI 问答域的会话、消息与调用日志。"""
    return {
        "enabled": flag("MYSQL_ENABLED"),
        "host": get("MYSQL_HOST", "127.0.0.1").strip() or "127.0.0.1",
        "port": integer("MYSQL_PORT", 3306, 1, 65535),
        "user": get("MYSQL_USER", "root").strip() or "root",
        "password": get("MYSQL_PASSWORD"),
        "database": get("MYSQL_DB", "plum_ai").strip() or "plum_ai",
        "charset": get("MYSQL_CHARSET", "utf8mb4").strip() or "utf8mb4",
        "connect_timeout": integer("MYSQL_TIMEOUT", 5, 1, 30),
    }


def mask(value: str) -> str:
    """密钥脱敏：只留前后各 4 位，短密钥全部打码。"""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:4] + "***" + value[-4:]


def public() -> dict:
    """给 /api/ai/config 用的只读视图：绝不包含完整密钥或密码。"""
    l, m = llm(), mysql()
    return {
        "env_file": str(ENV_FILE),
        "env_file_exists": ENV_FILE.is_file(),
        "llm": {
            "enabled": l["enabled"], "api_base": l["api_base"], "chat_url": l["url"],
            "model": l["model"], "api_key": "已配置" if l["api_key"] else "未配置",
            "api_key_hint": mask(l["api_key"]), "key_header": l["key_header"],
            "temperature": l["temperature"], "max_tokens": l["max_tokens"],
            "timeout": l["timeout"], "retry": l["retry"], "max_history": l["max_history"],
        },
        "mysql": {
            "enabled": m["enabled"], "host": m["host"], "port": m["port"],
            "database": m["database"], "user": m["user"],
            "password": "已配置" if m["password"] else "未配置",
        },
    }
