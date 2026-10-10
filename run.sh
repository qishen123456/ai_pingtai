#!/bin/bash
# Local development launcher. Production deployments use Docker/Compose templates instead.
set -Eeuo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[workbench] 首次启动，创建虚拟环境…"
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip -q
.venv/bin/pip install -q -r requirements.txt

HOST="${WORKBENCH_HOST:-127.0.0.1}"
PORT="${WORKBENCH_PORT:-8088}"
echo "[workbench] 环境：开发模式；未启用企业身份认证，不要直接暴露到公网。"
echo "[workbench] 打开浏览器访问 http://${HOST}:${PORT}"
exec .venv/bin/uvicorn backend.app.main:app --host "${HOST}" --port "${PORT}"
