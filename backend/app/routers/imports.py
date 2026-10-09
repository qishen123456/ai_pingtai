"""Excel 问题数据导入接口：上传 -> 预览 -> 确认模拟入库 -> 批次历史。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import MAX_UPLOAD_MB, UPLOAD_DIR
from ..db import get_db
from ..models import (
    BATCH_CONFIRMED,
    BATCH_DRAFT,
    ImportBatch,
    ProblemRecord,
    batch_to_dict,
    make_row_hash,
)
from ..services.excel_service import (
    ExcelParseError,
    build_preview,
    evaluate_submission,
    summarize_sheets,
)

router = APIRouter(prefix="/api/imports", tags=["imports"])

_FIELD_COLUMNS = [
    "description", "category", "dept", "model", "severity", "owner",
    "submitter", "due_date", "countermeasure", "result", "source", "stage",
]


class ImportRowPayload(BaseModel):
    """单条导入数据；只允许修改当前问题库支持的字段。"""

    model_config = ConfigDict(extra="forbid")

    excel_row: int = Field(ge=1)
    excluded: bool = False
    values: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("values")
    @classmethod
    def validate_values_fields(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(values) - set(_FIELD_COLUMNS)
        if unknown:
            raise ValueError("包含不支持的字段：" + ", ".join(sorted(unknown)))
        return values


class ConfirmImportPayload(BaseModel):
    """确认导入请求，限定行数并防止同一 Excel 行重复提交。"""

    model_config = ConfigDict(extra="forbid")

    rows: List[ImportRowPayload] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_unique_excel_rows(self) -> "ConfirmImportPayload":
        row_numbers = [row.excel_row for row in self.rows]
        if len(row_numbers) != len(set(row_numbers)):
            raise ValueError("Excel 行号不能重复")
        return self


def _get_batch_or_404(db: Session, batch_id: int) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="导入批次不存在")
    return batch


def _stored_path(batch: ImportBatch) -> str:
    # 预览快照中保留存储路径，避免批次与文件命名耦合
    return batch.preview_json.get("_file_path", "")


@router.post("/upload")
async def upload_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上传 Excel：校验类型与大小，解析工作表并生成推荐表的预览。"""
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式的 Excel 文件")

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    buffer = bytearray()
    try:
        while True:
            # 最多读取至上限 + 1 字节，以便发现超限文件而不将其完整载入内存。
            chunk = await file.read(min(1024 * 1024, max_bytes - len(buffer) + 1))
            if not chunk:
                break
            buffer.extend(chunk)
            if len(buffer) > max_bytes:
                size_mb = len(buffer) / (1024 * 1024)
                raise HTTPException(
                    status_code=400,
                    detail="文件超过 %dMB 上限（已检测到约 %.1fMB）" % (MAX_UPLOAD_MB, size_mb),
                )
    finally:
        await file.close()
    content = bytes(buffer)
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")

    try:
        sheets = summarize_sheets(content)
    except ExcelParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    recommended = next((s for s in sheets if s.get("recommended")), None)
    if recommended is None:
        # 没有任何表能识别为问题清单：仍建批次，前端引导用户手动选表
        preview: Dict[str, Any] = {"sheet_name": "", "columns": [], "rows": [],
                                   "stats": {"total": 0, "error_rows": 0, "ok_rows": 0,
                                             "pending_columns": [], "unmapped_columns": [],
                                             "mapped_fields": []},
                                   "field_labels": {}, "data_fields": [], "header_row": None}
    else:
        try:
            preview = build_preview(content, recommended["name"])
        except ExcelParseError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    safe_name = filename.replace("/", "_").replace("\\", "_")
    stored = UPLOAD_DIR / ("%s__%s" % (uuid.uuid4().hex[:12], safe_name))
    stored.write_bytes(content)
    preview["_file_path"] = str(stored)

    batch = ImportBatch(
        filename=filename,
        sheet_name=preview.get("sheet_name", ""),
        status=BATCH_DRAFT,
        total_rows=preview["stats"]["total"],
        preview_json=preview,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {"batch_id": batch.id, "sheets": sheets, "preview": _public_preview(preview)}


@router.post("/{batch_id}/preview")
def refresh_preview(batch_id: int, payload: Dict[str, Any], db: Session = Depends(get_db)):
    """切换工作表或应用手动字段映射后重新生成预览。"""
    batch = _get_batch_or_404(db, batch_id)
    if batch.status != BATCH_DRAFT:
        raise HTTPException(status_code=409, detail="该批次已确认入库，不能重新预览")

    import os
    path = _stored_path(batch)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=410, detail="原始文件已不存在，请重新上传")
    content = open(path, "rb").read()

    sheet_name = payload.get("sheet_name") or batch.sheet_name
    overrides = payload.get("overrides") or None
    try:
        preview = build_preview(content, sheet_name, overrides=overrides)
    except ExcelParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    preview["_file_path"] = path
    batch.sheet_name = sheet_name
    batch.total_rows = preview["stats"]["total"]
    batch.preview_json = preview
    db.commit()
    return {"batch_id": batch.id, "preview": _public_preview(preview)}


@router.post("/{batch_id}/confirm")
def confirm_import(batch_id: int, payload: ConfirmImportPayload, db: Session = Depends(get_db)):
    """用户确认后模拟写入问题库：服务端复核批次行集合与字段，再执行归一校验。"""
    batch = _get_batch_or_404(db, batch_id)
    if batch.status == BATCH_CONFIRMED:
        raise HTTPException(status_code=409, detail="该批次已提交，重复提交不会产生重复数据")

    submitted: List[Dict[str, Any]] = [row.model_dump() for row in payload.rows]

    # 行号必须与服务器保存的预览完全一致：允许编辑现有行字段，但不能额外伪造/遗漏整行。
    preview_rows = (batch.preview_json or {}).get("rows", [])
    expected_row_numbers = {int(row["excel_row"]) for row in preview_rows}
    submitted_row_numbers = {row["excel_row"] for row in submitted}
    if submitted_row_numbers != expected_row_numbers:
        raise HTTPException(
            status_code=422,
            detail="提交的数据行与当前批次预览不一致，请重新预览后再提交",
        )

    imported, failed, excluded = evaluate_submission(batch.sheet_name, submitted)

    duplicates = 0
    for item in imported:
        values = item["values"]
        row_hash = make_row_hash(batch.sheet_name, item["excel_row"], values)
        rec = ProblemRecord(
            batch_id=batch.id,
            excel_row=item["excel_row"],
            row_hash=row_hash,
            **{k: values.get(k) for k in _FIELD_COLUMNS},
        )
        try:
            # 保存点把唯一约束冲突限制在当前记录，不能回滚同批次之前已成功写入的记录。
            with db.begin_nested():
                db.add(rec)
                db.flush()
        except IntegrityError:
            duplicates += 1
            continue

    imported_count = len(imported) - duplicates
    batch.status = BATCH_CONFIRMED
    batch.total_rows = len(submitted)
    batch.imported_rows = imported_count
    batch.failed_rows = len(failed)
    batch.excluded_rows = excluded
    batch.confirmed_at = datetime.now()
    db.commit()

    return {
        "batch_id": batch.id,
        "imported": imported_count,
        "failed": len(failed),
        "excluded": excluded,
        "duplicates": duplicates,
        "failed_details": failed,
        "target": "模拟问题库（V0.1 本地数据表 problem_records，尚未对接真实 QMS）",
    }


@router.get("")
def list_batches(db: Session = Depends(get_db)):
    rows = db.query(ImportBatch).order_by(ImportBatch.id.desc()).all()
    return {"items": [batch_to_dict(b) for b in rows]}


@router.get("/{batch_id}")
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    data = batch_to_dict(batch)
    data["preview"] = _public_preview(batch.preview_json or {})
    return data


def _public_preview(preview: Dict[str, Any]) -> Dict[str, Any]:
    """剥离内部字段（如服务器文件路径）后再返回前端。"""
    return {k: v for k, v in preview.items() if not k.startswith("_")}
