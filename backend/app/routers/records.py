"""问题台账：查看已模拟入库的问题记录。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import REC_IMPORTED, ProblemRecord, record_to_dict

router = APIRouter(prefix="/api/records", tags=["records"])


@router.get("")
def list_records(
    q: str = "",
    severity: str = "",
    batch_id: int = 0,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(ProblemRecord).filter(ProblemRecord.status == REC_IMPORTED)
    if q.strip():
        kw = "%%%s%%" % q.strip()
        query = query.filter(or_(
            ProblemRecord.description.like(kw),
            ProblemRecord.owner.like(kw),
            ProblemRecord.model.like(kw),
            ProblemRecord.category.like(kw),
            ProblemRecord.dept.like(kw),
        ))
    if severity.strip():
        query = query.filter(ProblemRecord.severity == severity.strip().upper())
    if batch_id:
        query = query.filter(ProblemRecord.batch_id == batch_id)

    total = query.count()
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    rows = (
        query.order_by(ProblemRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [record_to_dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "target": "模拟问题库（V0.1）",
    }
