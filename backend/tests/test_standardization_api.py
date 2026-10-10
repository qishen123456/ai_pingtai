# -*- coding: utf-8 -*-
"""标准化与优选件本地试点：物料目录、相似件和 BOM 校验。"""


def _create_part(client, **overrides):
    payload = {
        "part_no": "PMP-100", "name": "智能净水泵组件",
        "specification": "24V 低噪音 12L/min", "category": "水泵",
        "manufacturer": "供应商甲", "lifecycle": "active", "is_preferred": True,
        "notes": "试点物料"
    }
    payload.update(overrides)
    response = client.post("/api/standardization/parts", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_part_catalog_similarity_and_preferred_filter(client):
    preferred = _create_part(client)
    _create_part(client, part_no="PMP-200", name="净水泵组件", is_preferred=False)
    duplicate = client.post("/api/standardization/parts", json={"part_no": "PMP-100", "name": "重复编码物料"})
    assert duplicate.status_code == 409

    found = client.get("/api/standardization/parts?preferred=true")
    assert found.status_code == 200
    assert found.json()["total"] == 1
    assert found.json()["items"][0]["part_no"] == preferred["part_no"]

    similar = client.post("/api/standardization/similarity", json={
        "query": "智能净水泵", "specification": "24V 低噪音", "category": "水泵"
    })
    assert similar.status_code == 200
    assert similar.json()["items"]
    assert similar.json()["items"][0]["part_no"] == "PMP-100"
    assert similar.json()["items"][0]["similarity"] > 0
    assert "不是大模型结论" in similar.json()["notice"]

    updated = client.patch(f"/api/standardization/parts/{preferred['id']}", json={
        "is_preferred": False, "lifecycle": "deprecated", "replacement_part_no": "PMP-200"
    })
    assert updated.status_code == 200
    assert updated.json()["lifecycle"] == "deprecated"
    assert updated.json()["replacement_part_no"] == "PMP-200"


def test_bom_check_persists_explainable_results(client):
    _create_part(client)
    _create_part(client, part_no="PMP-200", name="智能净水泵组件二代", is_preferred=True)
    _create_part(client, part_no="PMP-300", name="旧款水泵", lifecycle="deprecated")

    checked = client.post("/api/standardization/bom/check", json={
        "bom_name": "净水器试制 BOM",
        "items": [
            {"part_no": "PMP-100", "quantity": 2},
            {"part_no": "PMP-200", "quantity": 1},
            {"part_no": "MISSING", "name": "智能净水泵", "category": "水泵", "quantity": 1},
            {"part_no": "PMP-300", "quantity": 1}
        ]
    })
    assert checked.status_code == 201, checked.text
    result = checked.json()
    assert result["total_items"] == 4
    assert result["compliant_items"] == 2
    assert result["blocked_items"] == 2
    assert result["results"][0]["status"] == "compliant"
    assert result["results"][2]["status"] == "not_found"
    assert result["results"][2]["alternatives"]
    assert result["results"][3]["status"] == "deprecated"
    assert "未连接 PLM" in result["notice"]

    history = client.get("/api/standardization/bom/runs")
    assert history.status_code == 200
    assert history.json()["items"][0]["bom_name"] == "净水器试制 BOM"

    detail = client.get(f"/api/standardization/bom/runs/{result['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["results"]) == 4
