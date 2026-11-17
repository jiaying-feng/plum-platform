#!/usr/bin/env bash
# 取消 Linux 开机自启动：只停服务、删 unit，不动项目文件与数据库。
set -euo pipefail
sudo systemctl disable --now plum.service || true
sudo rm -f /etc/systemd/system/plum.service
sudo systemctl daemon-reload
echo "已取消开机自启动（项目文件与 MySQL 数据保留）。"
