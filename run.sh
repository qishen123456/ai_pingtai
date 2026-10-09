#!/bin/bash
# 一键启动工作台（首次自动建虚拟环境、装依赖）
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[workbench] 首次启动，创建虚拟环境…"
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip -q
  .venv/bin/pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
fi

PORT="${WORKBENCH_PORT:-8088}"
echo "[workbench] 启动中… 打开浏览器访问 http://127.0.0.1:${PORT}"
exec .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT}"
