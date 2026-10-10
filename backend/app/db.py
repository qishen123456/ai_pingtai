"""Database engine and startup guardrails.

Development/test may create tables automatically. Production must be migrated with Alembic
before the application starts; the web process never mutates a production schema.
"""
from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import APP_ENV, DATABASE_URL

_connect_args = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=_connect_args,
    pool_pre_ping=not DATABASE_URL.startswith("sqlite"),
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401 - register all models before inspecting metadata

    if APP_ENV == "production":
        inspector = inspect(engine)
        if not inspector.has_table("alembic_version"):
            raise RuntimeError("生产数据库尚未执行迁移；请先运行 alembic upgrade head")
        required = {
            "app_registry", "import_batches", "problem_records", "pm_projects",
            "pm_project_milestones", "pm_project_risks", "standard_parts",
            "standard_bom_runs", "audit_events",
        }
        missing = required - set(inspector.get_table_names())
        if missing:
            raise RuntimeError(
                "生产数据库缺少表 %s；请检查迁移状态并执行 alembic upgrade head"
                % ", ".join(sorted(missing))
            )
        # PostgreSQL schema is managed only by migration jobs; never run create_all at app startup.
        return

    Base.metadata.create_all(bind=engine)
    # Legacy SQLite compatibility for local pilot databases only. Production uses Alembic.
    if DATABASE_URL.startswith("sqlite"):
        inspector = inspect(engine)
        columns = {c["name"] for c in inspector.get_columns("app_registry")} if inspector.has_table("app_registry") else set()
        with engine.begin() as conn:
            if "entry_url" not in columns:
                conn.execute(text("ALTER TABLE app_registry ADD COLUMN entry_url VARCHAR(512)"))
            if "evidence_note" not in columns:
                conn.execute(text("ALTER TABLE app_registry ADD COLUMN evidence_note TEXT"))
