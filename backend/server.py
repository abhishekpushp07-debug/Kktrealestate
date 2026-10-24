import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from db import client, db, ensure_indexes
from deps import require
from infra import (
    START_TIME,
    IdempotencyMiddleware,
    ObservabilityMiddleware,
    metrics_snapshot,
)
from routers import (
    admin,
    audit,
    auth,
    blocks,
    bookings,
    cms,
    customers,
    dashboard,
    dashboard_widgets,
    documents,
    flats,
    imports,
    leads,
    master,
    milestones,
    notifications,
    parking,
    payments,
    projects,
    public,
    pdfs,
    portal,
    rate_cards,
    reports,
    roles,
    roznamcha,
    search,
    settings,
    support,
    users,
)
from routers.admin import reconcile_all
from seed import seed_if_empty, seed_phase15
from seed_phase2 import seed_phase2
from seed_phase3 import seed_marketing_user, seed_phase3
from seed_phase5 import seed_phase5
from services.counters import recompute_all
from storage import init_storage_async
from uow import STATE as UOW_STATE
from uow import detect_transaction_support

logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("uvicorn.access").disabled = True
logger = logging.getLogger("kkt")
VERSION = "5.0.0"

STATUS_CODES = {400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 422: "VALIDATION_ERROR", 423: "LOCKED", 429: "RATE_LIMITED"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    await detect_transaction_support()
    await seed_if_empty()
    await seed_phase15()
    await seed_phase2()
    await seed_phase3()
    for name, spec in __import__('permissions').SYSTEM_ROLES.items():
        if not await db.roles.find_one({'name': name}):
            c = await db.companies.find_one({}, {'_id': 0, 'id': 1})
            await db.roles.insert_one({**__import__('utils').base_doc(None, c['id']), 'name': name, 'description': spec['description'], 'permissions': spec['permissions'], 'is_system': True})
        else:
            await db.roles.update_one({'name': name, 'is_system': True}, {'$set': {'permissions': spec['permissions']}})
    await db.settings.update_one({'key': 'roles_version'}, {'$inc': {'value': 1}}, upsert=True)
    await seed_marketing_user()
    await seed_phase5()
    asyncio.create_task(_overdue_loop())
    if not await db.settings.find_one({"key": "counters_v1"}):
        await recompute_all()
        await db.settings.update_one({"key": "counters_v1"}, {"$set": {"value": True}}, upsert=True)
    rec = await reconcile_all()
    if rec["mismatches"]:
        logger.warning("Ledger reconciliation found %d mismatches: %s", len(rec["mismatches"]), rec["mismatches"][:3])
    await init_storage_async()
    logger.info("KKT backend ready (uow=%s)", UOW_STATE["mode"])
    yield
    client.close()


app = FastAPI(title="KKT Real Estate ERP", version=VERSION, openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url="/api/redoc", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    code = getattr(exc, "code", None) or STATUS_CODES.get(exc.status_code, "ERROR")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    content = {"detail": detail, "code": code, "request_id": getattr(request.state, "request_id", None)}
    extra = getattr(exc, "extra", None) or {}
    content.update(extra)
    headers = dict(getattr(exc, "headers", None) or {})
    if exc.status_code == 429 and extra.get("retry_after"):
        headers["Retry-After"] = str(extra["retry_after"])
    return JSONResponse(status_code=exc.status_code, content=content, headers=headers)


@app.exception_handler(RequestValidationError)
async def validation_exc_handler(request: Request, exc: RequestValidationError):
    errors = []
    for e in exc.errors():
        loc = ".".join(str(x) for x in e.get("loc", []) if x not in ("body", "query", "path"))
        errors.append({"field": loc, "message": e.get("msg", "").replace("Value error, ", "")})
    summary = "; ".join(f"{e['field']}: {e['message']}" if e["field"] else e["message"] for e in errors[:5])
    return JSONResponse(status_code=422, content={"detail": summary or "Validation error", "code": "VALIDATION_ERROR", "errors": errors, "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(Exception)
async def unhandled_exc_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR", "request_id": getattr(request.state, "request_id", None)})


api_router = APIRouter(prefix="/api")


async def _overdue_loop():
    from routers.notifications import overdue_demand_job
    while True:
        try:
            await overdue_demand_job()
        except Exception:
            logging.getLogger("kkt").exception("overdue job failed")
        await asyncio.sleep(24 * 3600)


@api_router.get("/health", tags=["system"])
async def health():
    t0 = time.perf_counter()
    await db.command("ping")
    return {"status": "ok", "db_ping_ms": round((time.perf_counter() - t0) * 1000, 2), "service": "kkt-erp", "version": VERSION,
            "uptime_s": round(time.time() - START_TIME), "transaction_mode": UOW_STATE["mode"], "transactions_supported": UOW_STATE["transactions"], "workers": __import__("os").environ.get("WEB_CONCURRENCY", "1"), "pid": __import__("os").getpid()}


@api_router.get("/ready", tags=["system"])
async def ready():
    import os
    await db.command("ping")
    return {"ready": True, "workers_hint": os.environ.get("WEB_CONCURRENCY", "1"), "transaction_mode": UOW_STATE["mode"]}


@api_router.get("/metrics", tags=["system"])
async def metrics(user: dict = Depends(require("settings.manage"))):
    return metrics_snapshot()


for r in (auth.router, users.router, roles.router, master.router, projects.router, rate_cards.router, blocks.router, flats.router, parking.router,
          settings.router, audit.router, dashboard.router, search.router, imports.router,
          customers.router, leads.router, documents.router, bookings.router, milestones.router, payments.router, roznamcha.router, admin.router, cms.router, public.router, reports.router, notifications.router, pdfs.router, dashboard_widgets.router, portal.router, portal.mgmt, support.router):
    api_router.include_router(r)

app.include_router(api_router)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID", "X-Response-Time", "ETag", "Idempotent-Replayed", "Retry-After"])
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(IdempotencyMiddleware)
app.add_middleware(ObservabilityMiddleware)
