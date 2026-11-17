"""应用入口：组装四组 API、静态托管三端页面与图片、统一错误处理与日志。"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from server import api_common as C
from server import db

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
ASSETS = ROOT / "assets"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("plum")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    app.json.ensure_ascii = False

    from server.api_business import bp as business_bp
    from server.api_merchant import bp as merchant_bp
    from server.api_admin import bp as admin_bp
    from server.api_ai import bp as ai_bp
    app.register_blueprint(business_bp)
    app.register_blueprint(merchant_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(ai_bp)

    @app.before_request
    def _begin():
        g.start_time = time.monotonic()
        # 预检请求直接放行：不注册 OPTIONS 路由，避免它抢占 /api/* 的 404 匹配
        if request.method == "OPTIONS":
            return "", 204

    @app.after_request
    def _end(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Session-Id"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        cost = (time.monotonic() - getattr(g, "start_time", time.monotonic())) * 1000
        if request.path.startswith("/api/"):
            logger.info("%s %s -> %d (%.0fms)", request.method, request.path,
                        resp.status_code, cost)
        return resp

    @app.errorhandler(Exception)
    def _error(e):
        if isinstance(e, HTTPException):
            code, status = e.code or 500, e.code or 500
            msg = "接口不存在，检查一下地址" if code == 404 else (
                "请求方法不对" if code == 405 else (e.description or "出了点小状况"))
        else:
            code, status, msg = 500, 500, "服务开小差了，请稍后再试"
            logger.exception("未处理异常：%s", e)
        return C.fail(code, msg, http_status=status)

    @app.get("/favicon.ico")
    def favicon():
        # 浏览器默认会请求站点图标；返回空响应，避免控制台出现无意义的 404
        return "", 204

    @app.get("/health")
    def health():
        tables = ("users", "orchards", "products", "orders", "reservations", "knowledge")
        return C.ok({
            "service": "青梅产业农商文旅综合平台",
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "status": "running",
            "data": {t: db.one(f"SELECT COUNT(*) n FROM {t}")["n"] for t in tables},
            "modules": ["游客H5/小程序", "商户工作台", "PC管理后台", "本地AI"],
        })

    @app.get("/")
    def portal():
        return send_from_directory(WEB, "index.html")

    @app.get("/visitor")
    def visitor():
        return send_from_directory(WEB, "visitor.html")

    @app.get("/merchant")
    def merchant():
        return send_from_directory(WEB, "merchant.html")

    @app.get("/admin")
    def admin():
        return send_from_directory(WEB, "admin.html")

    @app.get("/consumer")
    def consumer():
        """消费者 PC 站：桌面版浏览与交易，免登录可看，交易需游客账号。"""
        return send_from_directory(WEB, "consumer.html")

    @app.get("/biz")
    def biz():
        """商户 PC 工作台：桌面版场次/房态/商品/订单/核销，需商户或管理员。"""
        return send_from_directory(WEB, "biz.html")

    @app.get("/assets/<path:name>")
    def assets(name):
        return send_from_directory(ASSETS, name)

    @app.get("/web/<path:name>")
    def web_assets(name):
        return send_from_directory(WEB / "assets", name)

    return app


app = create_app()


if __name__ == "__main__":
    db.init_db()
    app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)
