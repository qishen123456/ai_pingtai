# -*- coding: utf-8 -*-
"""平台应用注册：内置模块、输入校验与草稿创建。"""


def test_builtin_apps_are_seeded_idempotently(client):
    first = client.get("/api/apps")
    assert first.status_code == 200
    items = {item["id"]: item for item in first.json()["items"]}
    assert {"problems", "projects", "standardization", "quality-assistant"} <= set(items)
    assert items["projects"]["entry_url"] is None
    assert "独立" in items["projects"]["evidence_note"]

    second = client.get("/api/apps")
    assert len(second.json()["items"]) == len(first.json()["items"])


def test_custom_app_is_validated_and_created_as_draft(client):
    invalid = client.post("/api/apps", json={
        "id": "Bad ID", "name": "x", "description": "x", "category": "x",
    })
    assert invalid.status_code == 422

    created = client.post("/api/apps", json={
        "id": "quality-review", "name": "质量复核试点",
        "description": "用于验证平台应用注册能力的隔离草稿。", "category": "质量与经验",
    })
    assert created.status_code == 201
    assert created.json()["status"] == "draft"

    duplicate = client.post("/api/apps", json={
        "id": "quality-review", "name": "质量复核试点",
        "description": "用于验证平台应用注册能力的隔离草稿。", "category": "质量与经验",
    })
    assert duplicate.status_code == 400
