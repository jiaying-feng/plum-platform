#!/usr/bin/env bash
# Linux 开机自启动：一个 systemd unit，不用 Docker / Supervisor / K8s。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3)"

if [ ! -f "$ROOT/ai.env" ]; then
  cp "$ROOT/ai.env.example" "$ROOT/ai.env"
  echo "已生成 $ROOT/ai.env，请先填写密钥与 MySQL 密码，再重新运行本脚本。"
  exit 0
fi

"$PY" -m pip install -r "$ROOT/requirements.txt" -q
if grep -qE '^MYSQL_ENABLED=1' "$ROOT/ai.env"; then
  "$PY" -m pip install -r "$ROOT/requirements-ai.txt" -q
fi

sudo sed -e "s#/opt/plum-platform#$ROOT#g" -e "s#/usr/bin/python3#$PY#g" \
  "$ROOT/deploy/plum.service" | sudo tee /etc/systemd/system/plum.service >/dev/null
sudo touch /var/log/plum-platform.log
sudo systemctl daemon-reload
sudo systemctl enable --now plum.service
sudo systemctl --no-pager status plum.service || true
echo "完成：sudo systemctl {status|restart|stop} plum.service；日志 /var/log/plum-platform.log"
