"""项目管理试点 API：项目组合、DCP 里程碑与风险闭环。
本地数据只属于门户试点；未配置 PM_PLATFORM_URL 时，不表示已连接独立 PM 系统。
"""
from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import PMProject, PMProjectMilestone, PMProjectRisk

router = APIRouter(prefix="/api/projects", tags=["projects"])
ProjectStage = Literal["预研", "立项", "开发", "验证", "试产", "量产"]
ProjectStatus = Literal["normal", "at_risk", "blocked", "completed"]
GateCode = Literal["DCP0", "DCP1", "DCP2", "DCP3", "DCP4", "DCP5"]
MilestoneStatus = Literal["pending", "passed", "blocked"]
RiskLevel = Literal["high", "medium", "low"]
RiskStatus = Literal["open", "monitoring", "resolved"]


def _validate_date(value: Optional[str]) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError("日期必须使用 YYYY-MM-DD 格式且为有效日期")
    return value


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    name: str = Field(min_length=2, max_length=160)
    product_line: str = Field(default="", max_length=100)
    owner: str = Field(default="待指定", max_length=80)
    stage: ProjectStage = "预研"
    status: ProjectStatus = "normal"
    progress: int = Field(default=0, ge=0, le=100)
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: str = Field(default="", max_length=2000)

    @field_validator("planned_start", "planned_end")
    @classmethod
    def valid_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_date(value)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    product_line: Optional[str] = Field(default=None, max_length=100)
    owner: Optional[str] = Field(default=None, max_length=80)
    stage: Optional[ProjectStage] = None
    status: Optional[ProjectStatus] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("planned_start", "planned_end")
    @classmethod
    def valid_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_date(value)


class MilestoneCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gate: GateCode
    title: str = Field(min_length=2, max_length=160)
    planned_date: str
    owner: str = Field(default="待指定", max_length=80)
    notes: str = Field(default="", max_length=2000)

    @field_validator("planned_date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        return _validate_date(value) or value


class MilestoneUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gate: Optional[GateCode] = None
    title: Optional[str] = Field(default=None, min_length=2, max_length=160)
    planned_date: Optional[str] = None
    actual_date: Optional[str] = None
    owner: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[MilestoneStatus] = None

    @field_validator("planned_date", "actual_date")
    @classmethod
    def valid_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_date(value)


class RiskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=2, max_length=240)
    level: RiskLevel = "medium"
    owner: str = Field(default="待指定", max_length=80)
    due_date: Optional[str] = None
    mitigation: str = Field(default="", max_length=3000)

    @field_validator("due_date")
    @classmethod
    def valid_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_date(value)


class RiskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, min_length=2, max_length=240)
    level: Optional[RiskLevel] = None
    owner: Optional[str] = Field(default=None, max_length=80)
    due_date: Optional[str] = None
    mitigation: Optional[str] = Field(default=None, max_length=3000)
    status: Optional[RiskStatus] = None

    @field_validator("due_date")
    @classmethod
    def valid_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_date(value)


def _milestone_dict(item: PMProjectMilestone) -> dict:
    return {"id": item.id, "project_id": item.project_id, "gate": item.gate,
            "title": item.title, "planned_date": item.planned_date,
            "actual_date": item.actual_date, "owner": item.owner,
            "notes": item.notes, "status": item.status,
            "created_at": item.created_at.strftime("%Y-%m-%d %H:%M")}


def _risk_dict(item: PMProjectRisk) -> dict:
    today = date.today().isoformat()
    overdue = bool(item.due_date and item.due_date < today and item.status != "resolved")
    return {"id": item.id, "project_id": item.project_id, "title": item.title,
            "level": item.level, "owner": item.owner, "due_date": item.due_date,
            "mitigation": item.mitigation, "status": item.status, "overdue": overdue,
            "created_at": item.created_at.strftime("%Y-%m-%d %H:%M")}


def _project_dict(db: Session, item: PMProject) -> dict:
    milestones = db.query(PMProjectMilestone).filter(
        PMProjectMilestone.project_id == item.id
    ).order_by(PMProjectMilestone.planned_date.asc(), PMProjectMilestone.id.asc()).all()
    risks = db.query(PMProjectRisk).filter(
        PMProjectRisk.project_id == item.id
    ).order_by(PMProjectRisk.id.desc()).all()
    return {"id": item.id, "code": item.code, "name": item.name,
            "product_line": item.product_line, "owner": item.owner,
            "stage": item.stage, "status": item.status, "progress": item.progress,
            "planned_start": item.planned_start, "planned_end": item.planned_end,
            "description": item.description,
            "created_at": item.created_at.strftime("%Y-%m-%d %H:%M"),
            "updated_at": item.updated_at.strftime("%Y-%m-%d %H:%M"),
            "milestones": [_milestone_dict(m) for m in milestones],
            "risks": [_risk_dict(r) for r in risks]}


def _get_project(db: Session, project_id: int) -> PMProject:
    item = db.get(PMProject, project_id)
    if item is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return item


@router.get("/summary")
def project_summary(db: Session = Depends(get_db)):
    today = date.today().isoformat()
    items = db.query(PMProject).order_by(PMProject.updated_at.desc(), PMProject.id.desc()).all()
    milestones = db.query(PMProjectMilestone).order_by(
        PMProjectMilestone.planned_date.asc(), PMProjectMilestone.id.asc()).all()
    risks = db.query(PMProjectRisk).order_by(PMProjectRisk.id.desc()).all()
    open_risks = [r for r in risks if r.status != "resolved"]
    overdue_risks = [r for r in open_risks if r.due_date and r.due_date < today]
    future_date = (date.today() + timedelta(days=14)).isoformat()
    upcoming = [m for m in milestones if m.status == "pending" and today <= m.planned_date <= future_date]
    return {
        "source": "local_pilot",
        "stats": {"total_projects": len(items),
                  "in_progress": sum(1 for p in items if p.status != "completed"),
                  "at_risk": sum(1 for p in items if p.status in ("at_risk", "blocked")),
                  "open_risks": len(open_risks), "overdue_risks": len(overdue_risks),
                  "upcoming_gates": len(upcoming)},
        "projects": [_project_dict(db, item) for item in items],
        "milestones": [_milestone_dict(m) for m in milestones],
        "risks": [_risk_dict(r) for r in risks]}


@router.get("")
def list_projects(q: str = "", stage: str = "", status_filter: str = "", db: Session = Depends(get_db)):
    query = db.query(PMProject)
    if q.strip():
        pattern = "%" + q.strip() + "%"
        query = query.filter(PMProject.name.like(pattern) | PMProject.code.like(pattern)
                             | PMProject.owner.like(pattern) | PMProject.product_line.like(pattern))
    if stage.strip():
        query = query.filter(PMProject.stage == stage.strip())
    if status_filter.strip():
        query = query.filter(PMProject.status == status_filter.strip())
    items = query.order_by(PMProject.updated_at.desc(), PMProject.id.desc()).all()
    return {"items": [_project_dict(db, item) for item in items], "total": len(items), "source": "local_pilot"}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    if db.query(PMProject).filter(PMProject.code == code).first():
        raise HTTPException(status_code=409, detail="项目编号已存在")
    if payload.planned_start and payload.planned_end and payload.planned_end < payload.planned_start:
        raise HTTPException(status_code=422, detail="计划结束日期不能早于开始日期")
    item = PMProject(**{**payload.model_dump(), "code": code, "name": payload.name.strip()})
    db.add(item)
    db.commit()
    db.refresh(item)
    return _project_dict(db, item)


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    return _project_dict(db, _get_project(db, project_id))


@router.patch("/{project_id}")
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)):
    item = _get_project(db, project_id)
    data = payload.model_dump(exclude_unset=True)
    start, end = data.get("planned_start", item.planned_start), data.get("planned_end", item.planned_end)
    if start and end and end < start:
        raise HTTPException(status_code=422, detail="计划结束日期不能早于开始日期")
    for key, value in data.items():
        if key == "name" and value is not None:
            value = value.strip()
        setattr(item, key, value)
    item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return _project_dict(db, item)


@router.post("/{project_id}/milestones", status_code=status.HTTP_201_CREATED)
def create_milestone(project_id: int, payload: MilestoneCreate, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    item = PMProjectMilestone(project_id=project_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return _milestone_dict(item)


@router.patch("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, payload: MilestoneUpdate, db: Session = Depends(get_db)):
    item = db.get(PMProjectMilestone, milestone_id)
    if item is None:
        raise HTTPException(status_code=404, detail="DCP 里程碑不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    if item.status == "passed" and not item.actual_date:
        item.actual_date = date.today().isoformat()
    _get_project(db, item.project_id).updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return _milestone_dict(item)


@router.post("/{project_id}/risks", status_code=status.HTTP_201_CREATED)
def create_risk(project_id: int, payload: RiskCreate, db: Session = Depends(get_db)):
    _get_project(db, project_id)
    item = PMProjectRisk(project_id=project_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return _risk_dict(item)


@router.patch("/risks/{risk_id}")
def update_risk(risk_id: int, payload: RiskUpdate, db: Session = Depends(get_db)):
    item = db.get(PMProjectRisk, risk_id)
    if item is None:
        raise HTTPException(status_code=404, detail="项目风险不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    _get_project(db, item.project_id).updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return _risk_dict(item)
