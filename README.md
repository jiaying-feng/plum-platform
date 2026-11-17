# 大邑䢺江镇青梅产业农商文旅综合平台

一颗梅子，从山上到桌上。摘梅、酿酒、住店、赶集，都在这一个平台里。

本项目是一份开箱即跑的完整交付：一个 Python（Flask + SQLite）服务同时提供数据接口、游客 H5、商户 H5 工作台、PC 管理后台，并附带可直接导入微信开发者工具的游客小程序工程。默认零外部依赖、断网可演示。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `plum-platform/` | 主项目：后端 `server/`、页面 `web/`、小程序 `mp-weixin/`、素材 `assets/`、文档 `docs/`、测试 `tests/`、部署脚本 `deploy/` 等 |
| `ui-showcase/` | 界面总览截图与预览页 |
| `PACKING_MANIFEST.txt` | 交付包清单 |
| `requirements-optional.txt` | 答辩材料生成与界面巡检的可选依赖 |

出于隐私与安全考虑，本仓库**不包含**毕业设计答辩材料，也不包含 `ai.env`（真实 API Key / 数据库口令）。如需启用外部大模型与 MySQL，请复制 `plum-platform/ai.env.example` 为 `ai.env` 后自行填写；该文件已被 `.gitignore` 排除。

## 快速开始

环境要求：Python 3.10+，默认仅需 `Flask==3.0.3`；前端与小程序无需 Node 构建。

```bash
cd plum-platform
python start.py
```

Windows 也可直接双击 `plum-platform/start.bat`。服务默认监听 `http://127.0.0.1:8080/`，`Ctrl+C` 停止。

演示账号（首次启动自动写入）：管理员 `admin/admin123`，合作社 `farmer01/merchant123`，民宿 `stay01/merchant123`，游客 `tourist01/tourist123`。

完整说明（目录结构、演示流程、AI 扩展、部署与排错）见 [plum-platform/README.md](plum-platform/README.md)。
