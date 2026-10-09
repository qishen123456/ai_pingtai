"""企业 AI 业务工作台 V0.2 入口。

启动：uvicorn backend.app.main:app --port 8088
"""
from __future__ import annotations

import contextlib
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR
from .db import init_db
from .routers import dashboard, imports, records, apps


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="企业 AI 业务工作台", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # 业务校验错误（HTTPException）由 FastAPI 默认处理；这里只兜底未知异常
    return JSONResponse(
        status_code=500,
        content={
            "code": "internal_error",
            "message": "服务器内部错误，请携带页面信息联系管理员",
            "request_id": uuid.uuid4().hex[:12],
        },
    )


app.include_router(dashboard.router)
app.include_router(imports.router)
app.include_router(records.router)
app.include_router(apps.router)


# 静态前端挂载在最后，避免拦截 /api
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
