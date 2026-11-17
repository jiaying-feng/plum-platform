"""一键初始化 AI 问答域 MySQL：核对 ai.env -> 建库建表 -> 打印结果。

用法：python tools/init_ai_db.py
不会改动任何业务表，也不会打印密码。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import ai_config, ai_store  # noqa: E402


def main() -> int:
    cfg = ai_config.mysql()
    print("=" * 58)
    print(" AI 问答域 MySQL 初始化")
    print("=" * 58)
    print(f" 配置文件：{ai_config.ENV_FILE}"
          f"（{'已找到' if ai_config.ENV_FILE.is_file() else '不存在'}）")
    print(f" 驱动状态：{'PyMySQL 已安装' if ai_store.driver_installed() else 'PyMySQL 未安装'}")
    if not cfg["enabled"]:
        print("\n 请先复制 ai.env.example 为 ai.env，把 MYSQL_ENABLED 改为 1，")
        print(" 填好 MYSQL_USER / MYSQL_PASSWORD，再重新运行本脚本。")
        print(" 只想用默认零依赖模式的话，不需要执行本脚本。")
        return 1
    print(f" 目标库　：{cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}（密码不打印）")
    result = ai_store.init_schema()
    print("\n " + ("成功：" if result["ok"] else "失败：") + result["msg"])
    if result["ok"]:
        print("\n 下一步：deploy\\setup_ai.bat（Windows）或 deploy/install_service.sh（Linux）")
        print(" 配置自检：启动服务后访问 /api/ai/config")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
