"""Resource-limit and truncation tests for untrusted xlsx uploads."""
from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from backend.app.services.excel_service import ExcelParseError, _validate_xlsx_archive, build_preview


HEADERS = ["序号", "问题点", "问题分类", "归属部门", "产品型号", "等级", "责任人", "目标解决时间"]


def make_xlsx(row_count: int = 2) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "问题清单"
    ws.append(HEADERS)
    for index in range(row_count):
        ws.append([
            index + 1, "问题描述 %04d" % index, "结构", "研发部", "MODEL-1", "B",
            "责任人甲", "2026-11-01",
        ])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_archive_validator_rejects_non_zip_data():
    with pytest.raises(ExcelParseError):
        _validate_xlsx_archive(b"not an xlsx")


def test_archive_validator_accepts_normal_workbook():
    _validate_xlsx_archive(make_xlsx(3))


def test_preview_marks_rows_above_configured_preview_limit():
    from backend.app.config import MAX_PREVIEW_ROWS
    content = make_xlsx(MAX_PREVIEW_ROWS + 7)
    preview = build_preview(content, "问题清单")
    assert preview["truncated"] is True
    assert preview["preview_row_limit"] == MAX_PREVIEW_ROWS
    assert "禁止确认" in preview["truncation_warning"]
    assert len(preview["rows"]) == MAX_PREVIEW_ROWS
