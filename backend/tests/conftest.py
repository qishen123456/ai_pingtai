# -*- coding: utf-8 -*-
"""测试夹具：独立临时 SQLite 库 + FastAPI TestClient。

必须在导入 app.config 之前设置 DATABASE_URL，故本文件顶部直接设置环境变量。
"""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="workbench_test_")
os.environ["APP_ENV"] = "test"
os.environ["AUTH_MODE"] = "disabled"
os.environ["DATABASE_URL"] = "sqlite:///%s/test.db" % _tmp
os.environ["MAX_UPLOAD_MB"] = "20"
os.environ["RECOGNIZER_ENGINE"] = "rule"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh_database():
    """每个用例独立一套表，避免行指纹跨用例相互干扰。"""
    from backend.app.db import Base, engine
    from backend.app import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
