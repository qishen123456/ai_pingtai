"""数据库：SQLAlchemy 2.0，SQLite 本地试点可平滑迁移至 PostgreSQL。"""
from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
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
    from . import models  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)
    # V0.2 对本地 SQLite 老库做最小、幂等的兼容升级；生产库应使用正式迁移。
    if DATABASE_URL.startswith("sqlite"):
        columns = {c["name"] for c in inspect(engine).get_columns("app_registry")} if "app_registry" in inspect(engine).get_table_names() else set()
        with engine.begin() as conn:
            if "entry_url" not in columns:
                conn.execute(text("ALTER TABLE app_registry ADD COLUMN entry_url VARCHAR(512)"))
            if "evidence_note" not in columns:
                conn.execute(text("ALTER TABLE app_registry ADD COLUMN evidence_note TEXT"))
