# -*- coding: utf-8 -*-
"""项目管理本地试点：项目、DCP 节点、风险和指标。"""


def test_project_dcp_risk_lifecycle_and_summary(client):
    created = client.post("/api/projects", json={
        "code": "PRJ-1001", "name": "净饮新品开发", "product_line": "净饮机",
        "owner": "项目经理甲", "stage": "开发", "planned_start": "2026-10-01",
        "planned_end": "2027-01-31", "progress": 35, "description": "项目管理 API 回归测试"
    })
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["code"] == "PRJ-1001"
    assert project["milestones"] == []

    duplicate = client.post("/api/projects", json={"code": "prj-1001", "name": "重复项目编号"})
    assert duplicate.status_code == 409

    milestone = client.post(f"/api/projects/{project['id']}/milestones", json={
        "gate": "DCP2", "title": "设计冻结评审", "planned_date": "2026-11-20",
        "owner": "研发负责人", "notes": "完成设计评审与风险清单"
    })
    assert milestone.status_code == 201, milestone.text
    gate = milestone.json()
    assert gate["status"] == "pending"

    passed = client.patch(f"/api/projects/milestones/{gate['id']}", json={"status": "passed"})
    assert passed.status_code == 200
    assert passed.json()["actual_date"]

    risk = client.post(f"/api/projects/{project['id']}/risks", json={
        "title": "关键器件交期存在不确定性", "level": "high", "owner": "采购负责人",
        "due_date": "2026-11-10", "mitigation": "准备第二供方并每周跟进"
    })
    assert risk.status_code == 201
    risk_data = risk.json()
    assert risk_data["status"] == "open"
    assert risk_data["level"] == "high"

    summary = client.get("/api/projects/summary").json()
    assert summary["stats"]["total_projects"] == 1
    assert summary["stats"]["open_risks"] == 1
    assert summary["stats"]["at_risk"] == 0
    assert summary["milestones"][0]["status"] == "passed"

    resolved = client.patch(f"/api/projects/risks/{risk_data['id']}", json={"status": "resolved"})
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
    assert client.get("/api/projects/summary").json()["stats"]["open_risks"] == 0

    update = client.patch(f"/api/projects/{project['id']}", json={"status": "at_risk", "progress": 48})
    assert update.status_code == 200
    assert update.json()["progress"] == 48
    assert client.get("/api/projects/summary").json()["stats"]["at_risk"] == 1


def test_project_date_validation_and_filters(client):
    invalid = client.post("/api/projects", json={
        "code": "PRJ-1002", "name": "日期校验测试", "planned_start": "2026-02-30"
    })
    assert invalid.status_code == 422

    created = client.post("/api/projects", json={
        "code": "PRJ-1003", "name": "条件筛选项目", "stage": "验证", "status": "blocked"
    })
    assert created.status_code == 201
    response = client.get("/api/projects?stage=验证&status_filter=blocked")
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["code"] == "PRJ-1003"
