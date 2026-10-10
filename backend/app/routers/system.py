"""Operational endpoints: health, non-secret integration status, and audit query."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .. import config
from ..config import (
    APP_ENV, DATABASE_URL, MODEL_API_KEY, MODEL_GATEWAY_URL, MODEL_NAME,
    PLM_API_BASE_URL, PM_PLATFORM_URL, PROBLEM_HUB_URL, QMS_API_BASE_URL,
)
from ..db import engine, get_db
from ..models import AuditEvent

router = APIRouter(tags=["system"])


@router.get("/health/live", include_in_schema=False)
def liveness():
    """Liveness probe: process is serving requests; no dependency check."""
    return {"status": "ok"}


@router.get("/health/ready", include_in_schema=False)
def readiness():
    """Readiness probe: database reachable and required schema exists."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        inspector = inspect(engine)
        if APP_ENV == "production":
            if not inspector.has_table("alembic_version"):
                raise RuntimeError("database_migration_missing")
            required = {"app_registry", "import_batches", "problem_records", "audit_events"}
            missing = required - set(inspector.get_table_names())
            if missing:
                raise RuntimeError("database_schema_missing:" + ",".join(sorted(missing)))
        return {"status": "ready", "database": "connected", "environment": APP_ENV}
    except Exception:
        # Do not leak database host, credentials, SQL, or schema details from a public probe.
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})


@router.get("/api/system/session")
def current_session(request: Request):
    """Used by UI to display the authenticated user instead of a hard-coded demo identity."""
    return {
        "actor": getattr(request.state, "actor", "unknown"),
        "email": getattr(request.state, "actor_email", ""),
        "roles": sorted(getattr(request.state, "roles", set())),
        "auth_mode": "trusted_proxy" if APP_ENV == "production" else "local_development",
        "production": APP_ENV == "production",
    }


@router.get("/api/system/integrations")
def integration_status():
    """Report configured placeholders separately from adapters that are genuinely implemented."""
    return {
        "environment": APP_ENV,
        "database": {
            "type": "postgresql" if DATABASE_URL.startswith(("postgresql:", "postgresql+")) else "sqlite",
            "production_ready": DATABASE_URL.startswith(("postgresql:", "postgresql+")),
        },
        "business_rules": {
            "dcp_gate_policy": config.DCP_GATE_POLICY,
            "dcp_policy_approved": config.DCP_GATE_POLICY in {"sequential", "independent"},
            "bom_policy_version": config.BOM_POLICY_VERSION,
            "bom_policy_approved": bool(config.BOM_POLICY_VERSION and config.BOM_POLICY_VERSION.lower() not in {"unconfigured", "placeholder", "__set_me__"}),
            "note": "状态仅表示配置字段是否填入；业务负责人签字和规则验收仍需单独留档。",
        },
        "integrations": [
            {"id": "problem_hub", "name": "问题经验 / problem-hub", "endpoint_configured": bool(PROBLEM_HUB_URL),
             "adapter_implemented": False, "status": "configured_placeholder" if PROBLEM_HUB_URL else "waiting_for_endpoint",
             "next_step": "补充 API 契约、服务账号、字段映射、幂等键与回写验收样本"},
            {"id": "pm_platform", "name": "项目管理 / pm-platform", "endpoint_configured": bool(PM_PLATFORM_URL),
             "adapter_implemented": False, "status": "configured_placeholder" if PM_PLATFORM_URL else "waiting_for_endpoint",
             "next_step": "明确主数据归属、读写接口、DCP 状态机、冲突处理与回滚策略"},
            {"id": "qms", "name": "QMS", "endpoint_configured": bool(QMS_API_BASE_URL),
             "adapter_implemented": False, "status": "configured_placeholder" if QMS_API_BASE_URL else "waiting_for_endpoint",
             "next_step": "提供测试环境、API 文档、权限范围与验收数据"},
            {"id": "plm", "name": "PLM", "endpoint_configured": bool(PLM_API_BASE_URL),
             "adapter_implemented": False, "status": "configured_placeholder" if PLM_API_BASE_URL else "waiting_for_endpoint",
             "next_step": "提供 BOM/物料查询和生命周期接口、版本规则及工程替代审批流程"},
            {"id": "model_gateway", "name": "企业模型网关", "endpoint_configured": bool(MODEL_GATEWAY_URL),
             "credentials_configured": bool(MODEL_API_KEY), "model_configured": bool(MODEL_NAME),
             "adapter_implemented": False, "status": "configuration_only" if MODEL_GATEWAY_URL else "waiting_for_endpoint",
             "next_step": "未接入真实模型适配器；提供网关协议、模型名、限流和脱敏要求后再实现"},
        ],
    }


@router.get("/api/system/audit")
def list_audit_events(
    actor: str = "",
    path: str = "",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Admin-only endpoint (enforced centrally by RBAC middleware)."""
    query = db.query(AuditEvent)
    if actor.strip():
        query = query.filter(AuditEvent.actor == actor.strip())
    if path.strip():
        query = query.filter(AuditEvent.path.like("%" + path.strip()[:200] + "%"))
    total = query.count()
    rows = query.order_by(AuditEvent.id.desc()).offset(offset).limit(limit).all()
    return {"items": [row.to_dict() for row in rows], "total": total, "limit": limit, "offset": offset}
