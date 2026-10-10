"""环境配置：本地允许轻量启动，生产配置缺项时必须拒绝启动。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env", override=False)
except ImportError:  # 容错：生产镜像应安装 requirements.txt 中的 python-dotenv
    pass

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data"))).expanduser().resolve()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(DATA_DIR / "uploads"))).expanduser().resolve()
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'workbench.db'}").strip()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
MAX_PREVIEW_ROWS = int(os.getenv("MAX_PREVIEW_ROWS", "500"))
MAX_XLSX_SHEETS = int(os.getenv("MAX_XLSX_SHEETS", "40"))
MAX_XLSX_COLUMNS = int(os.getenv("MAX_XLSX_COLUMNS", "200"))
MAX_XLSX_ZIP_ENTRIES = int(os.getenv("MAX_XLSX_ZIP_ENTRIES", "2000"))
MAX_XLSX_UNCOMPRESSED_MB = int(os.getenv("MAX_XLSX_UNCOMPRESSED_MB", "100"))
MAX_XLSX_COMPRESSION_RATIO = float(os.getenv("MAX_XLSX_COMPRESSION_RATIO", "250"))
UPLOAD_RETENTION_DAYS = int(os.getenv("UPLOAD_RETENTION_DAYS", "30"))
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "15"))

# Auth proxy only: terminate OIDC/SAML at a trusted gateway; never trust these headers from the public internet.
AUTH_MODE = os.getenv("AUTH_MODE", "disabled").strip().lower()
AUTH_PROXY_TRUSTED = os.getenv("AUTH_PROXY_TRUSTED", "false").strip().lower() == "true"
AUTH_USER_HEADER = os.getenv("AUTH_USER_HEADER", "X-Auth-Request-User").strip()
AUTH_EMAIL_HEADER = os.getenv("AUTH_EMAIL_HEADER", "X-Auth-Request-Email").strip()
AUTH_GROUPS_HEADER = os.getenv("AUTH_GROUPS_HEADER", "X-Auth-Request-Groups").strip()
AUTH_ADMIN_GROUPS = os.getenv("AUTH_ADMIN_GROUPS", "").strip()
AUTH_QUALITY_GROUPS = os.getenv("AUTH_QUALITY_GROUPS", "").strip()
AUTH_PM_GROUPS = os.getenv("AUTH_PM_GROUPS", "").strip()
AUTH_ENGINEERING_GROUPS = os.getenv("AUTH_ENGINEERING_GROUPS", "").strip()
AUTH_VIEWER_GROUPS = os.getenv("AUTH_VIEWER_GROUPS", "").strip()

# External system and model endpoints intentionally remain blank until owners provide real values.
PROBLEM_HUB_URL = os.getenv("PROBLEM_HUB_URL", "").strip()
PM_PLATFORM_URL = os.getenv("PM_PLATFORM_URL", "").strip()
QMS_API_BASE_URL = os.getenv("QMS_API_BASE_URL", "").strip()
PLM_API_BASE_URL = os.getenv("PLM_API_BASE_URL", "").strip()
MODEL_GATEWAY_URL = os.getenv("MODEL_GATEWAY_URL", "").strip()
MODEL_NAME = os.getenv("MODEL_NAME", "").strip()
MODEL_API_KEY = os.getenv("MODEL_API_KEY", "").strip()
RECOGNIZER_ENGINE = os.getenv("RECOGNIZER_ENGINE", "rule").strip().lower()
# Business-owned policy: remain explicitly unconfigured until the DCP process owner signs off.
DCP_GATE_POLICY = os.getenv("DCP_GATE_POLICY", "unconfigured").strip().lower()
BOM_POLICY_VERSION = os.getenv("BOM_POLICY_VERSION", "unconfigured").strip()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()
METRICS_ENABLED = os.getenv("METRICS_ENABLED", "false").strip().lower() == "true"

if not 1 <= MAX_UPLOAD_MB <= 100:
    raise RuntimeError("MAX_UPLOAD_MB must be between 1 and 100")
if MAX_PREVIEW_ROWS < 1 or MAX_PREVIEW_ROWS > 5000:
    raise RuntimeError("MAX_PREVIEW_ROWS must be between 1 and 5000")
if MAX_XLSX_SHEETS < 1 or MAX_XLSX_COLUMNS < 1 or MAX_XLSX_ZIP_ENTRIES < 1:
    raise RuntimeError("Excel resource limits must be positive")
if MAX_XLSX_UNCOMPRESSED_MB < 1 or MAX_XLSX_COMPRESSION_RATIO < 1:
    raise RuntimeError("Excel decompression limits must be positive")
