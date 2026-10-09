"""工作台首页：仅返回已验证的本地数据与应用注册状态。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import REC_IMPORTED, AppRegistry, ImportBatch, ProblemRecord

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "version": "0.2.0", "demo_mode": True}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    """首页数据：不混入项目或物料的模拟业务数据。"""
    pending_batches = db.query(ImportBatch).filter(ImportBatch.status == "draft").count()
    open_records = db.query(ProblemRecord).filter(ProblemRecord.status == REC_IMPORTED).count()
    apps = db.query(AppRegistry).all()
    planned = [app for app in apps if app.status == "planned"]
    stats = [
        {"key": "pending_import", "label": "待确认导入批次", "value": pending_batches, "unit": "批", "view": "problems", "demo": False},
        {"key": "open_problems", "label": "已导入问题记录", "value": open_records, "unit": "条", "view": "problems", "demo": False},
        {"key": "registered_apps", "label": "已登记业务应用", "value": len(apps), "unit": "个", "view": "app_center", "demo": False},
        {"key": "planned_apps", "label": "待启动模块", "value": len(planned), "unit": "个", "view": "app_center", "demo": False},
    ]
    return {
        "stats": stats,
        "todos": [
            {"id": app.id, "module": "app_center", "title": f"{app.name}：{app.evidence_note or '等待启动条件'}", "level": "medium", "action_text": "查看状态"}
            for app in planned
        ],
        "platform": {
            "registered_apps": len(apps),
            "available_apps": sum(1 for app in apps if app.status == "active"),
            "planned_apps": sum(1 for app in apps if app.status == "planned"),
            "model_gateway_configured": False,
        },
    }
