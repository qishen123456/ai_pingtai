"""Excel 解析与导入编排：读表 -> 表头识别 -> 字段映射 -> 归一校验 -> 预览/入库。

V0.1 边界：
- 仅支持 .xlsx；不处理图片/合并单元格等高级场景（problem-hub 已有增强实现，后续迁移）；
- 单表最多预览 500 行；
- 写入目标为本地 ProblemRecord 表（模拟问题库），接真实 QMS 时替换 writer 即可。
"""
from __future__ import annotations

import io
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook

from .mapping import (
    DATA_FIELDS,
    FIELD_LABELS,
    confidence_level,
    detect_header_row,
    match_header,
)
from .normalizer import is_blank, normalize_row
from .recognizer import HeaderRecognizer, get_recognizer

MAX_PREVIEW_ROWS = 500


class ExcelParseError(Exception):
    """可直接展示给用户的解析错误。"""


def _read_grids(file_bytes: bytes) -> List[Dict[str, Any]]:
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as exc:  # openpyxl 对损坏文件抛多种异常，统一转中文可读错误
        raise ExcelParseError("文件无法解析（可能已损坏或不是有效的 .xlsx 文件）") from exc

    sheets: List[Dict[str, Any]] = []
    for ws in wb.worksheets:
        grid: List[List[Any]] = []
        for row in ws.iter_rows(max_row=MAX_PREVIEW_ROWS + 5, values_only=True):
            grid.append(list(row))
        sheets.append({"name": ws.title, "grid": grid})
    wb.close()
    return sheets


def summarize_sheets(file_bytes: bytes, recognizer: Optional[HeaderRecognizer] = None) -> List[Dict[str, Any]]:
    """读取工作簿，返回每个工作表的识别摘要，并推荐最像问题清单的表。"""
    recognizer = recognizer or get_recognizer()
    result = []
    for sheet in _read_grids(file_bytes):
        grid = sheet["grid"]
        header_idx = detect_header_row(grid)
        matched = set()
        data_rows = 0
        if header_idx is not None:
            for field, conf in recognizer.recognize(grid[header_idx]):
                if field and conf >= 0.9:
                    matched.add(field)
            data_rows = sum(
                1 for row in grid[header_idx + 1:]
                if any(c is not None and str(c).strip() for c in row)
            )
        result.append({
            "name": sheet["name"],
            "header_row": (header_idx + 1) if header_idx is not None else None,
            "matched_fields": sorted(matched),
            "matched_count": len(matched),
            "data_rows": data_rows,
            "score": len(matched) + (1 if "description" in matched else 0),
        })
    if result:
        recommended = max(result, key=lambda s: s["score"])
        for s in result:
            s["recommended"] = s is recommended and s["matched_count"] >= 3
    return result


def _resolve_columns(
    headers: List[Any],
    recognizer: HeaderRecognizer,
    overrides: Optional[Dict[str, Optional[str]]] = None,
) -> List[Dict[str, Any]]:
    """生成列映射；同字段多列命中时首个保留、其余降级（防止后列覆盖前列）。"""
    overrides = overrides or {}
    recognized = recognizer.recognize(headers)
    claimed: Dict[str, int] = {}
    columns: List[Dict[str, Any]] = []

    for idx, raw in enumerate(headers):
        key = str(idx)
        if key in overrides:
            field = overrides[key]  # 用户手动改选（None 表示显式"不映射"）
            conf = 1.0 if field else 0.0
            source = "manual"
        else:
            field, conf = recognized[idx]
            source = "auto"
        columns.append({
            "index": idx,
            "raw_header": "" if raw is None else str(raw),
            "field": field,
            "confidence": conf,
            "level": confidence_level(conf) if field else "none",
            "source": source,
        })

    # 同字段去重：自动映射中只保留置信度最高的首列
    best: Dict[str, int] = {}
    for col in columns:
        f = col["field"]
        if f and col["source"] == "auto":
            if f not in best or col["confidence"] > columns[best[f]]["confidence"]:
                best[f] = col["index"]
    for col in columns:
        if col["field"] and col["source"] == "auto" and best.get(col["field"]) != col["index"]:
            col["field"] = None
            col["level"] = "none"
            col["downgraded"] = True

    # 手动指定的同字段冲突也处理：后者挤掉前者
    manual_fields = {}
    for col in columns:
        if col["field"] and col["source"] == "manual":
            if col["field"] in manual_fields:
                prev = columns[manual_fields[col["field"]]]
                prev["field"] = None
                prev["level"] = "none"
            manual_fields[col["field"]] = col["index"]

    return columns


def build_preview(
    file_bytes: bytes,
    sheet_name: str,
    overrides: Optional[Dict[str, Optional[str]]] = None,
    recognizer: Optional[HeaderRecognizer] = None,
) -> Dict[str, Any]:
    """解析指定工作表，返回列映射 + 行预览（含归一值与问题标记）。"""
    recognizer = recognizer or get_recognizer()
    sheets = {s["name"]: s["grid"] for s in _read_grids(file_bytes)}
    if sheet_name not in sheets:
        raise ExcelParseError("工作表不存在：%s" % sheet_name)
    grid = sheets[sheet_name]

    header_idx = detect_header_row(grid)
    if header_idx is None:
        raise ExcelParseError("未能在前 5 行识别出有效表头（至少需命中 3 个问题库字段）")

    headers = grid[header_idx]
    columns = _resolve_columns(headers, recognizer, overrides)
    col_by_field: Dict[str, int] = {c["field"]: c["index"] for c in columns if c["field"]}

    rows: List[Dict[str, Any]] = []
    for offset, raw_row in enumerate(grid[header_idx + 1: header_idx + 1 + MAX_PREVIEW_ROWS]):
        if not any(c is not None and str(c).strip() for c in raw_row):
            continue  # 全空行跳过
        raw_values: Dict[str, Any] = {}
        for field, col_idx in col_by_field.items():
            raw_values[field] = raw_row[col_idx] if col_idx < len(raw_row) else None
        values, issues = normalize_row(raw_values)
        rows.append({
            "excel_row": header_idx + 2 + offset,
            "excluded": False,
            "values": {f: values.get(f) for f in DATA_FIELDS if f in values},
            "issues": issues,
        })

    error_rows = sum(1 for r in rows if any(i["level"] == "error" for i in r["issues"]))
    pending_cols = [c["index"] for c in columns if c["level"] == "medium"]
    unmapped_cols = [c["index"] for c in columns if not c["field"] and c["raw_header"].strip()]
    return {
        "sheet_name": sheet_name,
        "header_row": header_idx + 1,
        "columns": columns,
        "field_labels": FIELD_LABELS,
        "data_fields": DATA_FIELDS,
        "rows": rows,
        "stats": {
            "total": len(rows),
            "error_rows": error_rows,
            "ok_rows": len(rows) - error_rows,
            "pending_columns": pending_cols,
            "unmapped_columns": unmapped_cols,
            "mapped_fields": sorted(col_by_field.keys()),
        },
    }


def evaluate_submission(
    sheet_name: str,
    submitted_rows: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    """对用户确认提交的行重新归一校验，拆分为 (可入库, 失败, 剔除数)。"""
    imported: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    excluded = 0

    for row in submitted_rows:
        if row.get("excluded"):
            excluded += 1
            continue
        raw_values = {k: v for k, v in (row.get("values") or {}).items() if k in DATA_FIELDS}
        values, issues = normalize_row(raw_values)
        row_no = row.get("excel_row")
        errors = [i for i in issues if i["level"] == "error"]
        if errors:
            failed.append({"excel_row": row_no, "values": values, "issues": issues})
        else:
            imported.append({"excel_row": row_no, "values": values, "issues": issues})
    return imported, failed, excluded
