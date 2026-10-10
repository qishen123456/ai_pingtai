"""标准化与优选件试点 API：本地目录、相似件检索、BOM 规则校验和历史。
规则以可解释、可复核为优先，不宣称已连接 PLM 或使用大模型。
"""
from __future__ import annotations
import re
from datetime import datetime
from difflib import SequenceMatcher
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from ..config import BOM_POLICY_VERSION
from ..db import get_db
from ..models import StandardBomRun, StandardPart

router = APIRouter(prefix="/api/standardization", tags=["standardization"])


class PartCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    part_no: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=200)
    specification: str = Field(default="", max_length=300)
    category: str = Field(default="未分类", max_length=100)
    manufacturer: str = Field(default="", max_length=160)
    lifecycle: Literal["active", "pending", "deprecated"] = "active"
    is_preferred: bool = False
    replacement_part_no: Optional[str] = Field(default=None, max_length=80)
    notes: str = Field(default="", max_length=2000)


class PartUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    specification: Optional[str] = Field(default=None, max_length=300)
    category: Optional[str] = Field(default=None, max_length=100)
    manufacturer: Optional[str] = Field(default=None, max_length=160)
    lifecycle: Optional[Literal["active", "pending", "deprecated"]] = None
    is_preferred: Optional[bool] = None
    replacement_part_no: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=2000)


class SimilarityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=2, max_length=240)
    specification: str = Field(default="", max_length=300)
    category: str = Field(default="", max_length=100)
    limit: int = Field(default=20, ge=1, le=50)


class BomItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    part_no: str = Field(min_length=1, max_length=80)
    name: str = Field(default="", max_length=200)
    category: str = Field(default="", max_length=100)
    quantity: float = Field(default=1, gt=0, le=100000000)


class BomCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bom_name: str = Field(min_length=2, max_length=160)
    items: list[BomItemInput] = Field(min_length=1, max_length=500)


def _part_dict(item: StandardPart) -> dict:
    return {"id": item.id, "part_no": item.part_no, "name": item.name,
            "specification": item.specification, "category": item.category,
            "manufacturer": item.manufacturer, "lifecycle": item.lifecycle,
            "is_preferred": bool(item.is_preferred),
            "replacement_part_no": item.replacement_part_no, "notes": item.notes,
            "created_at": item.created_at.strftime("%Y-%m-%d %H:%M"),
            "updated_at": item.updated_at.strftime("%Y-%m-%d %H:%M")}


def _run_dict(item: StandardBomRun, include_result: bool = False) -> dict:
    result = {"id": item.id, "bom_name": item.bom_name, "total_items": item.total_items,
              "compliant_items": item.compliant_items, "review_items": item.review_items,
              "blocked_items": item.blocked_items, "created_at": item.created_at.strftime("%Y-%m-%d %H:%M")}
    if include_result:
        result["results"] = item.result_json or []
    return result


def _normal(value: str) -> str:
    return re.sub(r"[\W_]+", "", (value or "").strip().lower(), flags=re.UNICODE)


def _similarity(query: str, candidate: str) -> float:
    left, right = _normal(query), _normal(candidate)
    if not left or not right:
        return 0.0
    if left in right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def _get_part(db: Session, part_id: int) -> StandardPart:
    item = db.get(StandardPart, part_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物料档案不存在")
    return item


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    parts = db.query(StandardPart).all()
    runs = db.query(StandardBomRun).order_by(StandardBomRun.id.desc()).limit(5).all()
    return {"source": "local_pilot",
            "stats": {"total_parts": len(parts),
                      "preferred_parts": sum(1 for p in parts if p.is_preferred and p.lifecycle == "active"),
                      "pending_parts": sum(1 for p in parts if p.lifecycle == "pending"),
                      "deprecated_parts": sum(1 for p in parts if p.lifecycle == "deprecated"),
                      "bom_checks": db.query(StandardBomRun).count()},
            "recent_runs": [_run_dict(run) for run in runs]}


@router.get("/parts")
def list_parts(q: str = "", category: str = "", lifecycle: str = "",
               preferred: Optional[bool] = None, page: int = 1, page_size: int = 100,
               db: Session = Depends(get_db)):
    query = db.query(StandardPart)
    if q.strip():
        pattern = "%" + q.strip() + "%"
        query = query.filter(StandardPart.part_no.like(pattern) | StandardPart.name.like(pattern)
                             | StandardPart.specification.like(pattern) | StandardPart.manufacturer.like(pattern))
    if category.strip():
        query = query.filter(StandardPart.category == category.strip())
    if lifecycle.strip():
        query = query.filter(StandardPart.lifecycle == lifecycle.strip())
    if preferred is not None:
        query = query.filter(StandardPart.is_preferred == preferred)
    total, page = query.count(), max(1, page)
    page_size = min(max(1, page_size), 200)
    items = query.order_by(StandardPart.part_no.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_part_dict(item) for item in items], "total": total,
            "page": page, "page_size": page_size, "source": "local_pilot"}


@router.post("/parts", status_code=status.HTTP_201_CREATED)
def create_part(payload: PartCreate, db: Session = Depends(get_db)):
    part_no = payload.part_no.strip().upper()
    if db.query(StandardPart).filter(StandardPart.part_no == part_no).first():
        raise HTTPException(status_code=409, detail="物料编码已存在")
    item = StandardPart(**{**payload.model_dump(), "part_no": part_no, "name": payload.name.strip()})
    db.add(item)
    db.commit()
    db.refresh(item)
    return _part_dict(item)


@router.patch("/parts/{part_id}")
def update_part(part_id: int, payload: PartUpdate, db: Session = Depends(get_db)):
    item = _get_part(db, part_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is None and key != "replacement_part_no":
            continue
        if key == "name" and value is not None:
            value = value.strip()
        setattr(item, key, value)
    item.updated_at = datetime.now()
    db.commit()
    db.refresh(item)
    return _part_dict(item)


@router.post("/similarity")
def search_similar(payload: SimilarityRequest, db: Session = Depends(get_db)):
    scored = []
    q_name, q_spec = payload.query.strip(), payload.specification.strip()
    for item in db.query(StandardPart).all():
        name_score = _similarity(q_name, item.name)
        spec_score = _similarity(q_spec, item.specification) if q_spec else 0.0
        full_text = " ".join((item.part_no, item.name, item.specification, item.category, item.manufacturer))
        score = max(name_score, 0.78 * spec_score, 0.78 * _similarity(q_name, full_text))
        if payload.category and item.category == payload.category:
            score = min(1.0, score + 0.08)
        if score < 0.16:
            continue
        reasons = []
        if _normal(q_name) and _normal(q_name) in _normal(item.name):
            reasons.append("名称包含查询词")
        elif name_score >= 0.42:
            reasons.append("名称文本相似")
        if q_spec and _similarity(q_spec, item.specification) >= 0.55:
            reasons.append("规格文本相似")
        if payload.category and item.category == payload.category:
            reasons.append("分类一致")
        scored.append({**_part_dict(item), "similarity": round(score, 4),
                       "reasons": reasons or ["编码、名称、规格和分类的综合文本相似度"]})
    scored.sort(key=lambda item: (item["similarity"], item["is_preferred"], item["part_no"]), reverse=True)
    return {"query": payload.query, "items": scored[:payload.limit],
            "method": "deterministic_text_similarity",
            "policy_version": BOM_POLICY_VERSION,
            "policy_status": "unapproved_local_candidate_rules",
            "release_ready": False,
            "notice": "结果由本地文本相似度规则生成，不是大模型结论；替代物料只是排查候选，不能自动替换或放行，须按已批准工程规则复核。"}


@router.post("/bom/check", status_code=status.HTTP_201_CREATED)
def check_bom(payload: BomCheckRequest, db: Session = Depends(get_db)):
    parts = db.query(StandardPart).all()
    by_number = {item.part_no.upper(): item for item in parts}
    results, compliant, review, blocked = [], 0, 0, 0
    for row_number, raw in enumerate(payload.items, start=1):
        request_item = raw.model_dump()
        part = by_number.get(raw.part_no.strip().upper())
        alternatives = []
        if part is None:
            state, message = "not_found", "物料编码未在本地档案中登记"
            blocked += 1
            category, query_name = raw.category, raw.name
        else:
            category, query_name = part.category, part.name
            if part.lifecycle == "deprecated":
                state, message = "deprecated", "物料已标记为停用，必须确认替代料"
                blocked += 1
            elif part.lifecycle == "pending":
                state, message = "pending", "物料仍待审核，暂不可判定为合规"
                review += 1
            elif part.is_preferred:
                state, message = "compliant", "物料有效且属于优选件"
                compliant += 1
            else:
                state, message = "non_preferred", "物料有效，但尚未列入优选件"
                review += 1
        if state != "compliant":
            candidates = [item for item in parts
                if item.lifecycle == "active" and item.is_preferred
                and (item.id != part.id if part else True)
                and ((category and item.category == category)
                     or (query_name and _similarity(query_name, item.name) >= 0.32))]
            candidates.sort(key=lambda item: (1 if category and item.category == category else 0,
                                               _similarity(query_name, item.name) if query_name else 0), reverse=True)
            alternatives = [{"part_no": item.part_no, "name": item.name, "specification": item.specification,
                "category": item.category, "reason": "有效优选件" + ("，相同分类" if category and item.category == category else "，名称相似")}
                for item in candidates[:3]]
        results.append({"row_number": row_number, "input": request_item,
                        "matched_part": _part_dict(part) if part else None,
                        "status": state, "message": message, "alternatives": alternatives})
    run = StandardBomRun(bom_name=payload.bom_name.strip(), total_items=len(results),
        compliant_items=compliant, review_items=review, blocked_items=blocked,
        input_json=[row.model_dump() for row in payload.items], result_json=results)
    db.add(run)
    db.commit()
    db.refresh(run)
    return {**_run_dict(run), "results": results, "source": "local_pilot",
            "notice": "本次校验仅使用当前门户的本地物料档案；未连接 PLM，不能作为正式量产放行结论。",
            "policy_version": BOM_POLICY_VERSION, "policy_status": "unapproved_local_candidate_rules", "release_ready": False}


@router.get("/bom/runs")
def list_bom_runs(db: Session = Depends(get_db)):
    items = db.query(StandardBomRun).order_by(StandardBomRun.id.desc()).limit(100).all()
    return {"items": [_run_dict(item) for item in items], "source": "local_pilot"}


@router.get("/bom/runs/{run_id}")
def get_bom_run(run_id: int, db: Session = Depends(get_db)):
    item = db.get(StandardBomRun, run_id)
    if item is None:
        raise HTTPException(status_code=404, detail="BOM 校验记录不存在")
    return {**_run_dict(item, include_result=True), "source": "local_pilot"}
