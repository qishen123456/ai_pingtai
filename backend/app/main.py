"""企业 AI 业务工作台入口。生产环境须配置可信认证网关，并先执行数据库迁移。"""
from __future__ import annotations

import contextlib
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import APP_ENV, FRONTEND_DIR, LOG_LEVEL, METRICS_ENABLED
from .db import init_db
from .security import authenticate_request, authorize_request, validate_production_configuration
from .services.audit import record_audit_event
from .routers import dashboard, imports, records, apps, projects, standardization, system

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("workbench")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    validate_production_configuration()
    init_db()
    logger.info("workbench_started env=%s", APP_ENV)
    yield
    logger.info("workbench_stopped")


app = FastAPI(
    title="企业 AI 业务工作台",
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/docs" if APP_ENV != "production" else None,
    redoc_url="/redoc" if APP_ENV != "production" else None,
    openapi_url="/openapi.json" if APP_ENV != "production" else None,
)


@app.middleware("http")
async def request_context_security_audit(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    started = time.perf_counter()
    actor = "unauthenticated"
    roles: set[str] = set()
    status_code = 500
    is_api = request.url.path.startswith("/api/")
    is_mutation = request.method.upper() not in {"GET", "HEAD", "OPTIONS"}
    try:
        identity = authenticate_request(request)
        actor = identity["actor"]
        roles = identity["roles"]
        request.state.actor = actor
        request.state.actor_email = identity.get("email", "")
        request.state.roles = roles

        if not authorize_request(request.method, request.url.path, roles):
            status_code = 403
            response = JSONResponse(
                status_code=403,
                content={"code": "forbidden", "message": "当前账号没有执行此操作的权限", "request_id": request_id},
            )
        else:
            response = await call_next(request)
            status_code = response.status_code
    except PermissionError as exc:
        status_code = 401
        response = JSONResponse(
            status_code=401,
            headers={"WWW-Authenticate": "Session"},
            content={"code": "authentication_required", "message": str(exc), "request_id": request_id},
        )
    except Exception:
        status_code = 500
        logger.exception("request_failed request_id=%s method=%s path=%s actor=%s", request_id, request.method, request.url.path, actor)
        response = JSONResponse(
            status_code=500,
            content={"code": "internal_error", "message": "服务器内部错误，请携带 request_id 联系管理员", "request_id": request_id},
        )
    finally:
        elapsed = time.perf_counter() - started
        # Persist mutations and auth denials. The body is deliberately excluded to avoid recording sensitive data.
        if is_api and (is_mutation or status_code in {401, 403, 500}):
            try:
                record_audit_event(
                    request_id=request_id,
                    actor=actor,
                    roles=sorted(roles),
                    method=request.method,
                    path=request.url.path,
                    status_code=status_code,
                    source_ip=request.client.host if request.client else "",
                    user_agent=request.headers.get("user-agent", "")[:500],
                )
            except Exception:
                logger.exception("audit_write_failed request_id=%s path=%s", request_id, request.url.path)
        if request.url.path not in {"/health/live", "/health/ready"}:
            logger.info(
                "request_complete request_id=%s method=%s path=%s status=%s actor=%s duration_ms=%.1f",
                request_id, request.method, request.url.path, status_code, actor, elapsed * 1000,
            )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


app.include_router(system.router)
app.include_router(dashboard.router)
app.include_router(imports.router)
app.include_router(records.router)
app.include_router(apps.router)
app.include_router(projects.router)
app.include_router(standardization.router)


@app.get("/metrics", include_in_schema=False)
def metrics():
    # Endpoint only exists when explicitly enabled; network policy must restrict access to the scraper.
    if not METRICS_ENABLED:
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    try:
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
    except ImportError:
        return JSONResponse(status_code=503, content={"detail": "Metrics dependency is not installed"})
    return Response(content=generate_latest().decode("utf-8"), media_type=CONTENT_TYPE_LATEST)


# Static frontend is mounted last so it cannot shadow /api and health routes.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
