"""Security policy tests for trusted-proxy authentication and route-family RBAC."""
from __future__ import annotations

from backend.app import security


def _enable_proxy(monkeypatch, groups=None):
    monkeypatch.setattr(security.config, "AUTH_MODE", "proxy")
    monkeypatch.setattr(security.config, "AUTH_PROXY_TRUSTED", True)
    monkeypatch.setattr(security.config, "AUTH_USER_HEADER", "X-Auth-Request-User")
    monkeypatch.setattr(security.config, "AUTH_EMAIL_HEADER", "X-Auth-Request-Email")
    monkeypatch.setattr(security.config, "AUTH_GROUPS_HEADER", "X-Auth-Request-Groups")
    monkeypatch.setattr(security, "ROLE_GROUPS", groups or {
        "admin": "workbench-admins",
        "quality": "quality-team",
        "pm": "project-managers",
        "engineering": "engineering-team",
        "viewer": "read-only",
    })


def test_proxy_auth_rejects_missing_identity_header(client, monkeypatch):
    _enable_proxy(monkeypatch)
    response = client.get("/api/system/session")
    assert response.status_code == 401
    assert response.json()["code"] == "authentication_required"


def test_rbac_blocks_viewer_from_mutating_project_data(client, monkeypatch):
    _enable_proxy(monkeypatch)
    headers = {
        "X-Auth-Request-User": "qa-reader@example.com",
        "X-Auth-Request-Email": "qa-reader@example.com",
        "X-Auth-Request-Groups": "read-only",
    }
    session = client.get("/api/system/session", headers=headers)
    assert session.status_code == 200
    assert session.json()["actor"] == "qa-reader@example.com"
    assert session.json()["roles"] == ["viewer"]

    response = client.post("/api/projects", headers=headers, json={
        "code": "PRJ-SEC-01", "name": "RBAC permission test"
    })
    assert response.status_code == 403


def test_project_manager_can_create_project(client, monkeypatch):
    _enable_proxy(monkeypatch)
    headers = {
        "X-Auth-Request-User": "pm@example.com",
        "X-Auth-Request-Email": "pm@example.com",
        "X-Auth-Request-Groups": "project-managers",
    }
    response = client.post("/api/projects", headers=headers, json={
        "code": "PRJ-SEC-02", "name": "PM role access test"
    })
    assert response.status_code == 201, response.text


def test_production_guard_requires_business_owned_policy(monkeypatch):
    monkeypatch.setattr(security.config, "APP_ENV", "production")
    monkeypatch.setattr(security.config, "AUTH_MODE", "proxy")
    monkeypatch.setattr(security.config, "AUTH_PROXY_TRUSTED", True)
    monkeypatch.setattr(security.config, "DATABASE_URL", "postgresql+psycopg://user:pass@db/workbench")
    monkeypatch.setattr(security.config, "RECOGNIZER_ENGINE", "rule")
    monkeypatch.setattr(security.config, "AUTH_USER_HEADER", "X-Auth-Request-User")
    monkeypatch.setattr(security.config, "AUTH_GROUPS_HEADER", "X-Auth-Request-Groups")
    monkeypatch.setattr(security.config, "DCP_GATE_POLICY", "unconfigured")
    monkeypatch.setattr(security.config, "BOM_POLICY_VERSION", "unconfigured")
    monkeypatch.setattr(security, "ROLE_GROUPS", {
        "admin": "workbench-admins", "quality": "quality-team", "pm": "project-managers",
        "engineering": "engineering-team", "viewer": "read-only",
    })
    try:
        security.validate_production_configuration()
    except RuntimeError as exc:
        assert "DCP_GATE_POLICY" in str(exc)
        assert "BOM_POLICY_VERSION" in str(exc)
    else:
        raise AssertionError("Production must fail closed until business rules are approved")
