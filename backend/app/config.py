"""统一配置：全部从环境变量读取，不写死任何密钥。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
FRONTEND_DIR = BASE_DIR / "frontend"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'workbench.db'}")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
# rule=规则词典识别；llm 为后续大模型识别预留，当前会显式报错
RECOGNIZER_ENGINE = os.getenv("RECOGNIZER_ENGINE", "rule")

# 独立业务系统的入口由部署环境决定。未配置时，平台只展示状态，不伪造可用链接。
PROBLEM_HUB_URL = os.getenv("PROBLEM_HUB_URL", "").strip()
PM_PLATFORM_URL = os.getenv("PM_PLATFORM_URL", "").strip()
