from datetime import date, datetime, timedelta

from backend.app.db import SessionLocal
from backend.app.models import (
    REC_IMPORTED,
    PMProject,
    PMProjectMilestone,
    PMProjectRisk,
    ProblemRecord,
    StandardPart,
)
from backend.app.security import authorize_request


def test_quality_query_returns_real_local_problem_records_and_evidence(client):
    db = SessionLocal()
    try:
        row = ProblemRecord(
            batch_id=10,
            excel_row=2,
            row_hash="a" * 64,
            description="AX100 净水器滤芯寿命异常",
            category="可靠性",
            dept="研发质量",
            model="AX100",
            severity="HIGH",
            owner="工程师A",
            due_date=(date.today() + timedelta(days=5)).isoformat(),
            countermeasure="补充耐久验证",
            result="复测中",
            status=REC_IMPORTED,
            created_at=datetime.now(),
        )
        db.add(row)
        db.commit()
        row_id = row.id
    finally:
        db.close()

    response = client.post("/api/assistant/query", json={
        "question": "AX100 这个机型最近有哪些质量问题？",
        "domain": "quality",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    assert body["domain"] == "quality"
    assert body["filters"]["product_model"] == "AX100"
    issue_group = next(group for group in body["groups"] if group["title"] == "问题经验记录")
    assert issue_group["count"] == 1
    assert issue_group["items"][0]["id"] == row_id
    assert issue_group["items"][0]["source_name"] == "门户本地问题台账"
    assert any(item["record_id"] == "problem_records:%s" % row_id for item in body["evidence"])
    assert any("QMS" in caveat for caveat in body["caveats"])


def test_project_query_aggregates_project_gate_and_risk(client):
    db = SessionLocal()
    try:
        project = PMProject(
            code="PRJ-ASK-01",
            name="AX100 新品开发",
            product_line="AX100",
            owner="项目经理",
            stage="验证",
            status="at_risk",
            progress=65,
            planned_start=date.today().isoformat(),
            planned_end=(date.today() + timedelta(days=20)).isoformat(),
            description="AX100 机型开发",
        )
        db.add(project)
        db.flush()
        gate = PMProjectMilestone(
            project_id=project.id,
            gate="DCP3",
            title="可靠性验证评审",
            planned_date=(date.today() + timedelta(days=2)).isoformat(),
            owner="项目经理",
            notes="完成可靠性验证",
            status="pending",
        )
        risk = PMProjectRisk(
            project_id=project.id,
            title="测试样机到位风险",
            level="high",
            owner="项目经理",
            due_date=(date.today() + timedelta(days=1)).isoformat(),
            mitigation="跟踪供应计划",
            status="monitoring",
        )
        db.add_all([gate, risk])
        db.commit()
    finally:
        db.close()

    response = client.post("/api/assistant/query", json={
        "question": "帮我看项目进度、DCP 遗留事项和风险",
        "domain": "projects",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    project_group = next(group for group in body["groups"] if group["title"] == "项目进度")
    assert project_group["count"] == 1
    assert project_group["items"][0]["title"] == "AX100 新品开发"
    gate_group = next(group for group in body["groups"] if group["title"] == "未通过 DCP 关口")
    assert gate_group["items"][0]["title"].startswith("DCP3")
    risk_group = next(group for group in body["groups"] if group["title"] == "未关闭项目风险")
    assert risk_group["items"][0]["title"] == "测试样机到位风险"


def test_standardization_query_returns_preferred_part_from_local_catalog(client):
    db = SessionLocal()
    try:
        db.add(StandardPart(
            part_no="PART-200",
            name="高效滤芯组件",
            specification="PP+活性炭",
            category="滤芯",
            manufacturer="内部供应商",
            lifecycle="active",
            is_preferred=True,
            notes="试点物料",
        ))
        db.commit()
    finally:
        db.close()

    response = client.post("/api/assistant/query", json={
        "question": "有哪些有效优选件？",
        "domain": "standardization",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    part_group = next(group for group in body["groups"] if group["title"] == "物料 / 优选件")
    assert part_group["items"][0]["subtitle"].startswith("PART-200")
    assert part_group["items"][0]["source_name"] == "门户本地物料目录"


def test_unrecognized_question_asks_for_clarification(client):
    response = client.post("/api/assistant/query", json={
        "question": "你好，能帮帮我吗？",
        "domain": "auto",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "needs_clarification"
    assert body["kind"] == "clarify"
    assert {item["key"] for item in body["options"]} == {
        "quality", "projects", "problems", "standardization"
    }


def test_viewer_role_can_use_read_only_assistant_query():
    assert authorize_request("POST", "/api/assistant/query", {"viewer"}) is True
    assert authorize_request("POST", "/api/projects", {"viewer"}) is False
