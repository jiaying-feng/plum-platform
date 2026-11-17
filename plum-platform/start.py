"""一键启动：建库 -> 灌基准数据 -> 起服务 -> 打开浏览器。

用法：
    python start.py              # 正常启动（保留已有数据）
    python start.py --reset      # 重建基准数据后再启动
    python start.py --port 9000  # 换端口
    python start.py --no-browser # 不自动打开浏览器
"""
from __future__ import annotations

import argparse
import threading
import webbrowser

from server import db
from server.app import app

PORTS = {"门户": "", "游客端": "/visitor", "商户工作台": "/merchant", "PC管理后台": "/admin",
         "健康检查": "/health"}


def main() -> None:
    parser = argparse.ArgumentParser(description="青梅产业农商文旅综合平台一键启动")
    parser.add_argument("--reset", action="store_true", help="重建基准数据")
    parser.add_argument("--port", type=int, default=8080, help="服务端口，默认 8080")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    db.init_db(force=args.reset)
    base = f"http://127.0.0.1:{args.port}"
    print("=" * 66)
    print(" 大邑䢺江镇青梅产业农商文旅综合平台")
    print("=" * 66)
    counts = {t: db.one(f"SELECT COUNT(*) n FROM {t}")["n"] for t in
              ("users", "orchards", "orchard_sessions", "products", "research",
               "homestays", "rooms", "festivals", "knowledge")}
    print(" 数据就绪：" + "  ".join(f"{k}={v}" for k, v in counts.items()))
    print("-" * 66)
    for name, path in PORTS.items():
        print(f" {name:<12} {base}{path}")
    print("-" * 66)
    print(" 演示账号：admin/admin123  farmer01/merchant123  tourist01/tourist123")
    print(" 验收脚本：python tests/smoke_test.py")
    print(" 停止服务：Ctrl+C")
    print("=" * 66)

    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(base)).start()
    app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
