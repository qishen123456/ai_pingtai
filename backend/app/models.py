"""数据模型：导入批次、问题记录、以及 V1 平台架构下的应用注册表。"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, JSON, DateTime, Integer, String, Text, UniqueConstraint
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

def make_row_hash(
    sheet_name: str,
    excel_row: int,
    values: dict,
    *,
    batch_id: Optional[int] = None,
    mode: Optional[str] = None,
) -> str:
    """Build an approved-policy fingerprint.

    content mode deduplicates identical full business payloads across sheets/batches.
    row_instance mode preserves identical incidents by including batch and Excel row identity.
    """
    from .config import IMPORT_DEDUPE_POLICY

    policy = (mode or IMPORT_DEDUPE_POLICY or "content").strip().lower()
    if policy not in {"content", "row_instance"}:
        # Local pilot fallback only. Production startup rejects an unapproved policy.
        policy = "content"
    normalized = {
        str(key): (str(value).strip() if value is not None else "")
        for key, value in (values or {}).items()
    }
    payload = {"values": normalized}
    if policy == "row_instance":
        payload.update({"batch_id": batch_id, "sheet_name": sheet_name or "", "excel_row": int(excel_row)})
    key = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
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


# --- 新增业务模块：项目管理与标准化优选件（本地试点模型） ---
class PMProject(Base):
    __tablename__ = "pm_projects"
    __table_args__ = (UniqueConstraint("code", name="uq_pm_project_code"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(160))
    product_line: Mapped[str] = mapped_column(String(100), default="")
    owner: Mapped[str] = mapped_column(String(80), default="待指定")
    stage: Mapped[str] = mapped_column(String(20), default="预研", index=True)
    status: Mapped[str] = mapped_column(String(20), default="normal", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    planned_start: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    planned_end: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class PMProjectMilestone(Base):
    __tablename__ = "pm_project_milestones"
    __table_args__ = (UniqueConstraint("project_id", "gate", name="uq_pm_project_gate"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), index=True)
    gate: Mapped[str] = mapped_column(String(12), index=True)
    title: Mapped[str] = mapped_column(String(160))
    planned_date: Mapped[str] = mapped_column(String(10), index=True)
    actual_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    owner: Mapped[str] = mapped_column(String(80), default="待指定")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class PMProjectRisk(Base):
    __tablename__ = "pm_project_risks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    level: Mapped[str] = mapped_column(String(12), default="medium", index=True)
    owner: Mapped[str] = mapped_column(String(80), default="待指定")
    due_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    mitigation: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class StandardPart(Base):
    __tablename__ = "standard_parts"
    __table_args__ = (UniqueConstraint("part_no", name="uq_standard_part_no"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_no: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    specification: Mapped[str] = mapped_column(String(300), default="")
    category: Mapped[str] = mapped_column(String(100), default="未分类", index=True)
    manufacturer: Mapped[str] = mapped_column(String(160), default="")
    lifecycle: Mapped[str] = mapped_column(String(20), default="active", index=True)
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    replacement_part_no: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class StandardBomRun(Base):
    __tablename__ = "standard_bom_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bom_name: Mapped[str] = mapped_column(String(160))
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    compliant_items: Mapped[int] = mapped_column(Integer, default=0)
    review_items: Mapped[int] = mapped_column(Integer, default=0)
    blocked_items: Mapped[int] = mapped_column(Integer, default=0)
    input_json: Mapped[list] = mapped_column(JSON, default=list)
    result_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class AuditEvent(Base):
    """Security and change audit trail; payload values are intentionally not stored."""
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), index=True)
    actor: Mapped[str] = mapped_column(String(160), index=True)
    roles_json: Mapped[list] = mapped_column(JSON, default=list)
    method: Mapped[str] = mapped_column(String(12))
    path: Mapped[str] = mapped_column(String(512), index=True)
    status_code: Mapped[int] = mapped_column(Integer)
    source_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(500), default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "request_id": self.request_id, "actor": self.actor,
            "roles": self.roles_json or [], "method": self.method, "path": self.path,
            "status_code": self.status_code, "source_ip": self.source_ip,
            "user_agent": self.user_agent,
            "occurred_at": self.occurred_at.strftime("%Y-%m-%d %H:%M:%S"),
        }
