"""Bootstrap tables and safely add the original local app registry columns.

This is the pre-production baseline. Once released to a production database, never edit this
revision; all later schema changes must use immutable, reviewed Alembic revisions.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

from backend.app.db import Base
from backend.app import models  # noqa: F401 - register metadata

revision = "20261010_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Creates missing tables but intentionally does not alter tables that already exist.
    Base.metadata.create_all(bind=bind)
    inspector = inspect(bind)
    if inspector.has_table("app_registry"):
        existing = {column["name"] for column in inspector.get_columns("app_registry")}
        if "entry_url" not in existing:
            op.add_column("app_registry", sa.Column("entry_url", sa.String(length=512), nullable=True))
        if "evidence_note" not in existing:
            op.add_column("app_registry", sa.Column("evidence_note", sa.Text(), nullable=True))


def downgrade() -> None:
    raise RuntimeError(
        "Bootstrap downgrade is disabled to prevent accidental production data loss. "
        "Restore a verified backup or apply a reviewed forward migration."
    )
