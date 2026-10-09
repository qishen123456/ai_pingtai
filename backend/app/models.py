"""数据模型：导入批次、问题记录、以及 V1 平台架构下的应用注册表。"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# --- 现有模型保留 ---
BATCH_DRAFT = "draft"
BATCH_CONFIRMED = "confirmed"
REC_IMPORTED = "imported"
REC_EXCLUDED = "excluded"
REC_FAILED = "failed"

class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    sheet_name: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default=BATCH_DRAFT, index=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    failed_rows: Mapped[int] = mapped_column(Integer, default=0)
    excluded_rows: Mapped[int] = mapped_column(Integer, default=0)
    preview_json: Mapped[dict] = mapped_column(JSON, default=dict)
    operator: Mapped[str] = mapped_column(String(64), default="demo_user")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

class ProblemRecord(Base):
    __tablename__ = "problem_records"
    __table_args__ = (UniqueConstraint("row_hash", name="uq_problem_row_hash"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    excel_row: Mapped[int] = mapped_column(Integer)
    row_hash: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dept: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    submitter: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    due_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    countermeasure: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    stage: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=REC_IMPORTED, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

def make_row_hash(sheet_name: str, excel_row: int, values: dict) -> str:
    key = "|".join([
        sheet_name or "", str(excel_row),
        str(values.get("description") or "").strip(),
        str(values.get("owner") or "").strip(),
        str(values.get("model") or "").strip(),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()

def batch_to_dict(batch: ImportBatch) -> dict:
    return {
        "id": batch.id, "filename": batch.filename, "sheet_name": batch.sheet_name,
        "status": batch.status, "total_rows": batch.total_rows, "imported_rows": batch.imported_rows,
        "failed_rows": batch.failed_rows, "excluded_rows": batch.excluded_rows, "operator": batch.operator,
        "created_at": batch.created_at.strftime("%Y-%m-%d %H:%M"),
        "confirmed_at": batch.confirmed_at.strftime("%Y-%m-%d %H:%M") if batch.confirmed_at else None,
    }

def record_to_dict(rec: ProblemRecord) -> dict:
    return {
        "id": rec.id, "batch_id": rec.batch_id, "excel_row": rec.excel_row,
        "description": rec.description, "category": rec.category, "dept": rec.dept,
        "model": rec.model, "severity": rec.severity, "owner": rec.owner,
        "submitter": rec.submitter, "due_date": rec.due_date, "countermeasure": rec.countermeasure,
        "result": rec.result, "source": rec.source, "stage": rec.stage,
        "status": rec.status, "created_at": rec.created_at.strftime("%Y-%m-%d %H:%M"),
    }

# --- 新增模型：应用注册表 (App Registry) ---
class AppRegistry(Base):
    """
    平台级应用注册中心。
    每一个 AI 业务模块均需在此注册元数据，由前端统一拉取生成导航和应用中心。
    """
    __tablename__ = "app_registry"

    id: Mapped[str] = mapped_column(String(64), primary_key=True) # 如 "problems", "projects"
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(64)) # 数据管理, 运营预警, 知识问答, 自定义
    icon: Mapped[str] = mapped_column(String(64)) # 预定义的 SVG 图标名称
    version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    status: Mapped[str] = mapped_column(String(32), default="draft") # draft, active, planned, archived
    route_path: Mapped[str] = mapped_column(String(128)) # 对应前端路由的 view 名称
    template_type: Mapped[str] = mapped_column(String(64), default="custom")
    owner: Mapped[str] = mapped_column(String(64), default="admin")
    is_core: Mapped[bool] = mapped_column(Integer, default=0) # 是否为平台内置核心模块
    entry_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    evidence_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

def app_to_dict(app: AppRegistry) -> dict:
    return {
        "id": app.id,
        "name": app.name,
        "description": app.description,
        "category": app.category,
        "icon": app.icon,
        "version": app.version,
        "status": app.status,
        "route_path": app.route_path,
        "template_type": app.template_type,
        "owner": app.owner,
        "is_core": bool(app.is_core),
        "entry_url": app.entry_url,
        "evidence_note": app.evidence_note,
        "created_at": app.created_at.strftime("%Y-%m-%d %H:%M"),
    }
