"""Low-sensitivity audit persistence helpers."""
from __future__ import annotations

from ..db import SessionLocal
from ..models import AuditEvent


def record_audit_event(
    *,
    request_id: str,
    actor: str,
    roles: list[str],
    method: str,
    path: str,
    status_code: int,
    source_ip: str = "",
    user_agent: str = "",
) -> None:
    """Record who attempted which operation and its outcome; never store request bodies."""
    with SessionLocal() as db:
        db.add(AuditEvent(
            request_id=request_id[:32],
            actor=(actor or "unknown")[:160],
            roles_json=roles,
            method=method[:12],
            path=path[:512],
            status_code=int(status_code),
            source_ip=(source_ip or "")[:64],
            user_agent=(user_agent or "")[:500],
        ))
        db.commit()
