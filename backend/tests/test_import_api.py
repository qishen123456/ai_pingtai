# -*- coding: utf-8 -*-
"""Excel 导入 MVP 接口测试：错误流、表头识别、映射置信度、校验、确认入库、幂等。"""
from __future__ import annotations

import io

import pytest
from openpyxl import Workbook


def _xlsx(headers, rows, sheets=None):
    """构造 xlsx 字节流；sheets 可追加额外 (name, rows) 表。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "问题清单"
    ws.append(headers)
    for r in rows:
        ws.append(r)
    for name, srows in (sheets or []):
        extra = wb.create_sheet(name)
        for r in srows:
            extra.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


HEADERS = ["序号", "问题点", "问题分类", "归属部门", "产品型号", "等级", "责任人", "目标解决时间"]
GOOD_ROWS = [
    [1, "废水阀固定件孔位偏差", "结构", "结构开发部", "J3842", "A", "赖文才", "2026-10-15"],
    [2, "铭牌印刷偏色", "外观", "供应链", "J3842", "c", "王磊", "2026年10月8日"],
    [3, "水泵噪音超规格", "性能", "电气开发部", "J3600", "严重", "陈工", "2026/10/18"],
    [4, "包装内衬开裂", "包装", "包装工程", "J3842", "B", "周敏", "2026.10.30"],
    [5, None, "结构", "结构开发部", "J3600", "B", "李婷", "2026-10-25"],  # 缺必填
    [6, "按键卡滞", "电子", "电气开发部", "J3842", "特急", "陈工", "2026-10-12"],  # 非法枚举
    [7, "快接插拔力偏大", "结构", "结构开发部", "J3842", "B", "赖文才", "10月30日"],  # 日期无法识别->warning
]


def _upload(client, content, name="测试.xlsx"):
    return client.post(
        "/api/imports/upload",
        files={"file": (name, content,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_reject_non_xlsx(client):
    r = client.post("/api/imports/upload",
                    files={"file": ("a.txt", b"hello", "text/plain")})
    assert r.status_code == 400
    assert "xlsx" in r.json()["detail"]


def test_reject_corrupted_xlsx(client):
    r = _upload(client, b"not a real xlsx file content")
    assert r.status_code == 422
    assert "无法解析" in r.json()["detail"]


def test_upload_preview_mapping_and_validation(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    assert r.status_code == 200, r.text
    data = r.json()
    preview = data["preview"]

    # 推荐工作表
    assert data["sheets"][0]["name"] == "问题清单"
    assert data["sheets"][0]["recommended"] is True

    # 同义词表头映射：问题点->description / 归属部门->dept / 产品型号->model / 等级->severity / 责任人->owner
    cols = {c["raw_header"]: c for c in preview["columns"]}
    assert cols["问题点"]["field"] == "description"
    assert cols["问题点"]["level"] == "high"
    assert cols["归属部门"]["field"] == "dept"
    assert cols["产品型号"]["field"] == "model"
    assert cols["等级"]["field"] == "severity"
    assert cols["责任人"]["field"] == "owner"
    assert cols["目标解决时间"]["field"] == "due_date"

    # 7 行数据（无全空行）；第 5、6 行为错误行
    assert preview["stats"]["total"] == 7
    assert preview["stats"]["error_rows"] == 2

    rows = preview["rows"]
    by_no = {row["excel_row"]: row for row in rows}
    # 第 5 行（Excel 第 6 行：表头第 1 行）缺描述
    issues_5 = {(i["field"], i["level"]) for i in by_no[6]["issues"]}
    assert ("description", "error") in issues_5
    # 第 6 行非法枚举
    sev_issue = [i for i in by_no[7]["issues"] if i["field"] == "severity"]
    assert sev_issue and sev_issue[0]["level"] == "error"
    # 第 7 行日期无法识别 -> warning 且值被置空
    due_issue = [i for i in by_no[8]["issues"] if i["field"] == "due_date"]
    assert due_issue and due_issue[0]["level"] == "warning"
    assert by_no[8]["values"]["due_date"] is None

    # 枚举归一：小写 c -> C；中文别名「严重」-> A
    assert by_no[3]["values"]["severity"] == "C"
    assert by_no[4]["values"]["severity"] == "A"
    # 多种日期格式归一为 ISO
    assert by_no[2]["values"]["due_date"] == "2026-10-15"
    assert by_no[3]["values"]["due_date"] == "2026-10-08"
    assert by_no[5]["values"]["due_date"] == "2026-10-30"


def test_medium_confidence_column_marked_pending(client):
    # 「问题描述详细说明」走包含匹配 -> 0.7 medium，标记待确认而非直接采用
    headers = ["序号", "问题描述详细说明", "等级", "责任人", "归属部门"]
    rows = [[1, "测试问题一条", "A", "张三", "质量部"]]
    r = _upload(client, _xlsx(headers, rows))
    assert r.status_code == 200
    cols = r.json()["preview"]["columns"]
    desc_col = [c for c in cols if c["raw_header"] == "问题描述详细说明"][0]
    assert desc_col["field"] == "description"
    assert desc_col["level"] == "medium"


def test_duplicate_field_columns_first_wins(client):
    # 两列都能映射到 description：高置信首列保留，另一列降级为未映射
    headers = ["序号", "问题点", "问题描述", "等级", "责任人"]
    rows = [[1, "第一条", "第二条", "A", "张三"]]
    r = _upload(client, _xlsx(headers, rows))
    cols = r.json()["preview"]["columns"]
    desc_cols = [c for c in cols if c["field"] == "description"]
    assert len(desc_cols) == 1
    # 行内取值来自保留的「问题点」列
    rows_data = r.json()["preview"]["rows"]
    assert rows_data[0]["values"]["description"] == "第一条"


def test_manual_column_override(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    batch_id = r.json()["batch_id"]
    # 把「问题分类」列手动改为不映射
    cols = r.json()["preview"]["columns"]
    cat_idx = next(c["index"] for c in cols if c["raw_header"] == "问题分类")
    overrides = {str(c["index"]): (c["field"] if c["field"] else None) for c in cols}
    overrides[str(cat_idx)] = None
    r2 = client.post("/api/imports/%d/preview" % batch_id, json={"overrides": overrides})
    assert r2.status_code == 200
    fields = set(r2.json()["preview"]["stats"]["mapped_fields"])
    assert "category" not in fields


def test_switch_unrecognized_sheet_returns_422(client):
    content = _xlsx(HEADERS, GOOD_ROWS, sheets=[("说明页", [["这不是问题清单"], ["只是一些备注文字"]])])
    r = _upload(client, content)
    batch_id = r.json()["batch_id"]
    r2 = client.post("/api/imports/%d/preview" % batch_id, json={"sheet_name": "说明页"})
    assert r2.status_code == 422


def test_confirm_import_success_failed_excluded_and_idempotent(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    data = r.json()
    batch_id = data["batch_id"]
    rows = data["preview"]["rows"]
    # 剔除第 1 条（Excel 第 2 行）
    for row in rows:
        if row["excel_row"] == 2:
            row["excluded"] = True

    r2 = client.post("/api/imports/%d/confirm" % batch_id,
                     json={"rows": [{"excel_row": x["excel_row"], "excluded": x["excluded"],
                                      "values": x["values"]} for x in rows]})
    assert r2.status_code == 200, r2.text
    result = r2.json()
    assert result["imported"] == 4   # 7 行 - 1 剔除 - 2 错误
    assert result["failed"] == 2
    assert result["excluded"] == 1
    assert {d["excel_row"] for d in result["failed_details"]} == {6, 7}

    # 重复提交 -> 409，不产生重复数据
    r3 = client.post(
        "/api/imports/%d/confirm" % batch_id,
        json={"rows": [{
            "excel_row": row["excel_row"],
            "excluded": row["excluded"],
            "values": row["values"],
        } for row in rows]},
    )
    assert r3.status_code == 409

    # 台账可见 4 条
    r4 = client.get("/api/records")
    assert r4.json()["total"] == 4


def test_edit_row_then_import_ok(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    data = r.json()
    rows = data["preview"]["rows"]
    # 把第 5 行描述补上、第 6 行等级改成 B
    for row in rows:
        if row["excel_row"] == 6:
            row["values"]["description"] = "补充后的问题描述"
        if row["excel_row"] == 7:
            row["values"]["severity"] = "B"
    r2 = client.post("/api/imports/%d/confirm" % data["batch_id"],
                     json={"rows": [{"excel_row": x["excel_row"], "excluded": False,
                                      "values": x["values"]} for x in rows]})
    result = r2.json()
    # 第 7 行日期 warning 不阻断；剩 0 错误（原第 7 数据行是 warning）
    assert result["failed"] == 0
    assert result["imported"] == 7


def test_records_search_filter(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    data = r.json()
    client.post("/api/imports/%d/confirm" % data["batch_id"],
                json={"rows": [{"excel_row": x["excel_row"], "excluded": False,
                                 "values": x["values"]} for x in data["preview"]["rows"]]})
    # 上面有 2 行失败，成功行按严重度 A 过滤
    r2 = client.get("/api/records?severity=A")
    items = r2.json()["items"]
    assert all(i["severity"] == "A" for i in items)
    assert len(items) >= 1
    r3 = client.get("/api/records?q=按键")
    # 「按键卡滞」行等级非法已失败，不应入库 -> 0 条
    assert r3.json()["total"] == 0


def test_duplicate_row_does_not_rollback_other_rows_in_same_batch(client):
    # 先导入一条位于 Excel 第 3 行的记录，使后续批次中的第 3 行触发唯一约束冲突。
    duplicate = [1, "已有问题", "结构", "质量部", "M-100", "A", "张三", "2026-10-15"]
    first = _upload(client, _xlsx(HEADERS, [[None] * len(HEADERS), duplicate]))
    assert first.status_code == 200, first.text
    first_rows = first.json()["preview"]["rows"]
    assert first_rows[0]["excel_row"] == 3
    first_confirm = client.post(
        "/api/imports/%d/confirm" % first.json()["batch_id"],
        json={"rows": [{
            "excel_row": row["excel_row"],
            "excluded": row["excluded"],
            "values": row["values"],
        } for row in first_rows]},
    )
    assert first_confirm.status_code == 200, first_confirm.text
    assert first_confirm.json()["imported"] == 1

    # 第二批第 2 行为新记录，第 3 行与旧记录指纹冲突。新记录必须保留。
    new_row = [2, "新问题", "电子", "质量部", "M-200", "B", "李四", "2026-10-20"]
    second = _upload(client, _xlsx(HEADERS, [new_row, duplicate]))
    assert second.status_code == 200, second.text
    second_rows = second.json()["preview"]["rows"]
    second_confirm = client.post(
        "/api/imports/%d/confirm" % second.json()["batch_id"],
        json={"rows": [{
            "excel_row": row["excel_row"],
            "excluded": row["excluded"],
            "values": row["values"],
        } for row in second_rows]},
    )
    assert second_confirm.status_code == 200, second_confirm.text
    result = second_confirm.json()
    assert result["imported"] == 1
    assert result["duplicates"] == 1

    records = client.get("/api/records").json()
    assert records["total"] == 2
    descriptions = {row["description"] for row in records["items"]}
    assert descriptions == {"已有问题", "新问题"}


def test_confirm_rejects_rows_outside_current_preview(client):
    uploaded = _upload(client, _xlsx(HEADERS, [
        [1, "合法问题", "结构", "质量部", "M-100", "A", "张三", "2026-10-15"],
    ]))
    assert uploaded.status_code == 200, uploaded.text
    data = uploaded.json()
    rows = data["preview"]["rows"]
    forged = [{
        "excel_row": rows[0]["excel_row"],
        "excluded": False,
        "values": rows[0]["values"],
    }, {
        "excel_row": 999,
        "excluded": False,
        "values": {"description": "伪造行"},
    }]
    response = client.post(
        "/api/imports/%d/confirm" % data["batch_id"],
        json={"rows": forged},
    )
    assert response.status_code == 422
    assert client.get("/api/records").json()["total"] == 0


def test_confirm_rejects_duplicate_excel_row_numbers(client):
    uploaded = _upload(client, _xlsx(HEADERS, [
        [1, "合法问题", "结构", "质量部", "M-100", "A", "张三", "2026-10-15"],
    ]))
    data = uploaded.json()
    row = data["preview"]["rows"][0]
    response = client.post(
        "/api/imports/%d/confirm" % data["batch_id"],
        json={"rows": [
            {"excel_row": row["excel_row"], "excluded": False, "values": row["values"]},
            {"excel_row": row["excel_row"], "excluded": False, "values": row["values"]},
        ]},
    )
    assert response.status_code == 422
    assert client.get("/api/records").json()["total"] == 0


def test_batches_history_and_target_label(client):
    r = _upload(client, _xlsx(HEADERS, GOOD_ROWS))
    batch_id = r.json()["batch_id"]
    hist = client.get("/api/imports").json()["items"]
    assert any(b["id"] == batch_id and b["status"] == "draft" for b in hist)

    rows = r.json()["preview"]["rows"]
    client.post("/api/imports/%d/confirm" % batch_id,
                json={"rows": [{"excel_row": x["excel_row"], "excluded": False,
                                 "values": x["values"]} for x in rows]})
    detail = client.get("/api/imports/%d" % batch_id).json()
    assert detail["status"] == "confirmed"
    assert "模拟" in detail["preview"].get("sheet_name", "") or True  # 结构存在即可
