"""Trusted reverse-proxy identity mapping and endpoint authorization.

This app deliberately does not parse an enterprise OIDC/SAML flow itself. In production,
an approved identity gateway must authenticate the user, strip user-supplied auth headers,
then inject the configured X-Auth-Request-* headers over a private network.
"""
from __future__ import annotations

from fastapi import Request

from . import config


ROLE_GROUPS = {
    "admin": config.AUTH_ADMIN_GROUPS,
    "quality": config.AUTH_QUALITY_GROUPS,
    "pm": config.AUTH_PM_GROUPS,
    "engineering": config.AUTH_ENGINEERING_GROUPS,
    "viewer": config.AUTH_VIEWER_GROUPS,
}
KNOWN_ROLES = set(ROLE_GROUPS)


def _csv(value: str) -> set[str]:
    return {item.strip().casefold() for item in value.replace(";", ",").split(",") if item.strip()}


def validate_production_configuration() -> None:
    """Fail closed when production auth, database or role mappings are not configured."""
    if config.APP_ENV != "production":
        return
    errors = []
    if config.AUTH_MODE != "proxy":
        errors.append("AUTH_MODE must be proxy")
    if not config.AUTH_PROXY_TRUSTED:
        errors.append("AUTH_PROXY_TRUSTED=true is required only behind a private trusted gateway")
    if config.DATABASE_URL.startswith("sqlite"):
        errors.append("DATABASE_URL must point to PostgreSQL in production")
    if any(token in config.DATABASE_URL.upper() for token in ("__SET_ME__", "PLACEHOLDER", "CHANGE_ME")):
        errors.append("DATABASE_URL contains a placeholder credential")
    for role, groups in ROLE_GROUPS.items():
        parsed = _csv(groups)
        if not parsed or any("placeholder" in g or "set-me" in g or "__" in g for g in parsed):
            errors.append("AUTH_%s_GROUPS must contain actual IdP group names" % role.upper())
    if config.RECOGNIZER_ENGINE != "rule":
        errors.append("Only the implemented rule recognizer may be enabled until the real model adapter is approved")
    if config.DCP_GATE_POLICY not in {"sequential", "independent"}:
        errors.append("DCP_GATE_POLICY must be explicitly approved as sequential or independent")
    if not config.BOM_POLICY_VERSION or config.BOM_POLICY_VERSION.strip().lower() in {"unconfigured", "placeholder", "__set_me__"}:
        errors.append("BOM_POLICY_VERSION must identify a business-approved, versioned engineering rule set")
    if not config.AUTH_USER_HEADER or not config.AUTH_GROUPS_HEADER:
        errors.append("identity and groups header names must be configured")
    if errors:
        raise RuntimeError("生产配置不完整，服务拒绝启动：\n- " + "\n- ".join(errors))


def authenticate_request(request: Request) -> dict:
    """Return actor/email/roles or raise PermissionError for unauthenticated requests."""
    if request.url.path in {"/health/live", "/health/ready"}:
        return {"actor": "health-probe", "email": "", "roles": set()}

    if config.AUTH_MODE == "disabled":
        if config.APP_ENV == "production":
            raise PermissionError("生产环境未启用企业认证")
        return {
            "actor": "local-development",
            "email": "",
            "roles": set(KNOWN_ROLES),
        }

    if config.AUTH_MODE != "proxy" or not config.AUTH_PROXY_TRUSTED:
        raise PermissionError("身份认证网关未正确配置")

    actor = (request.headers.get(config.AUTH_USER_HEADER) or "").strip()
    if not actor or len(actor) > 160:
        raise PermissionError("缺少企业认证身份，请重新登录")
    email = (request.headers.get(config.AUTH_EMAIL_HEADER) or "").strip()[:254]
    groups = _csv(request.headers.get(config.AUTH_GROUPS_HEADER) or "")
    roles = {
        role for role, configured_groups in ROLE_GROUPS.items()
        if groups.intersection(_csv(configured_groups))
    }
    if "admin" in roles:
        roles.update({"quality", "pm", "engineering", "viewer"})
    return {"actor": actor, "email": email, "roles": roles}


def authorize_request(method: str, path: str, roles: set[str]) -> bool:
    """Route-family RBAC guard. Data-level/project-level scopes are a later integration step."""
    if path in {"/health/live", "/health/ready"}:
        return True
    if not roles:
        return False

    verb = method.upper()
    is_read = verb in {"GET", "HEAD", "OPTIONS"}
    if not path.startswith("/api/"):
        return True  # static app shell is accessible only after authenticate_request succeeds

    if path.startswith("/api/system/audit"):
        return "admin" in roles
    if path.startswith("/api/imports"):
        allowed = {"viewer", "quality", "admin"} if is_read else {"quality", "admin"}
    elif path.startswith("/api/projects"):
        allowed = {"viewer", "pm", "admin"} if is_read else {"pm", "admin"}
    elif path.startswith("/api/standardization"):
        allowed = {"viewer", "engineering", "admin"} if is_read else {"engineering", "admin"}
    elif path.startswith("/api/apps"):
        allowed = {"viewer", "admin"} if is_read else {"admin"}
    else:
        allowed = {"viewer", "admin"} if is_read else {"admin"}
    return bool(roles.intersection(allowed))
