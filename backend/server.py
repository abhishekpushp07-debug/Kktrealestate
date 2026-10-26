import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from db import client, db, ensure_indexes
from deps import require
from infra import (
    timed_job,
    START_TIME,
    ETagMiddleware,
    IdempotencyMiddleware,
    ObservabilityMiddleware,
    metrics_snapshot,
)
from routers import (
    bootstrap,
    home,
    catalogues,
    crm,
    project_setup,
    visits,
    admin,
    audit,
    auth,
    blocks,
    bookings,
    cms,
    construction,
    masters_plus,
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
from migrate_phase7 import migrate_phase7, seed_phase7
from services.counters import recompute_all
from storage import init_storage_async
from uow import STATE as UOW_STATE
from uow import detect_transaction_support

logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("uvicorn.access").disabled = True
logger = logging.getLogger("kkt")
VERSION = "11.0.0"

STATUS_CODES = {400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 422: "VALIDATION_ERROR", 423: "LOCKED", 429: "RATE_LIMITED"}


STARTUP = {"phase": "booting", "done": False, "essential_done": False, "started_at": None, "finished_at": None, "db": "unknown", "steps": {}}
_BG_TASKS: set = set()


async def _owner_bootstrap():
    from services.owner_bootstrap import ensure_owner, mark_demo_accounts
    STARTUP["owner_bootstrap"] = await ensure_owner()
    await mark_demo_accounts()


async def _system_roles():
    for name, spec in __import__('permissions').SYSTEM_ROLES.items():
        if not await db.roles.find_one({'name': name}):
            c = await db.companies.find_one({}, {'_id': 0, 'id': 1})
            await db.roles.insert_one({**__import__('utils').base_doc(None, c['id']), 'name': name, 'description': spec['description'], 'permissions': spec['permissions'], 'is_system': True})
        else:
            await db.roles.update_one({'name': name, 'is_system': True}, {'$set': {'permissions': spec['permissions']}})
    await db.settings.update_one({'key': 'roles_version'}, {'$inc': {'value': 1}}, upsert=True)
    from services.rbac import migrate_legacy_codes, register_routes
    STARTUP["unregistered_permissions"] = await register_routes(app)
    STARTUP["rbac_migrated"] = await migrate_legacy_codes()


async def _counters_once():
    if not await db.settings.find_one({"key": "counters_v1"}):
        await recompute_all()
        await db.settings.update_one({"key": "counters_v1"}, {"$set": {"value": True}}, upsert=True)


async def _reconcile():
    rec = await reconcile_all()
    if rec["mismatches"]:
        logger.warning("Ledger reconciliation found %d mismatches: %s", len(rec["mismatches"]), rec["mismatches"][:3])


async def _integrity():
    from infra import timed_job
    from services.integrity import integrity_report
    ir = await timed_job("integrity", integrity_report)
    await db.settings.update_one({"key": "integrity_last_report"}, {"$set": {"value": ir}}, upsert=True)
    logging.getLogger("kkt.integrity").info("[phase7] integrity: ok=%s bookings=%s counts=%s", ir["ok"], ir["bookings_checked"], ir["counts"])


async def _step(name, coro_fn):
    t0 = time.perf_counter()
    STARTUP["phase"] = name
    try:
        await coro_fn()
        STARTUP["steps"][name] = round(time.perf_counter() - t0, 2)
        logger.info("[startup] %s ok in %.2fs", name, time.perf_counter() - t0)
    except Exception:
        STARTUP["steps"][name] = "failed"
        logger.exception("[startup] %s failed (continuing)", name)


async def startup_tasks():
    """Heavy, idempotent work moved out of lifespan: runs once per deploy on the lease holder, never blocks serving."""
    from services.leader import try_acquire
    from services.integrity import backfill_demand_installments
    from services.portal_notify import sweep_notifications
    from routers.visits import seed_phase9
    from startup_phase11 import startup_phase11
    from services.validators import apply_validators, backfill_price_paise
    STARTUP["started_at"] = __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat()
    try:
        leader = await try_acquire("startup")
    except Exception:
        leader = False
    if not leader:
        STARTUP.update(phase="follower", done=True, finished_at=STARTUP["started_at"])
        logger.info("[startup] another replica holds the startup lease; skipping migrations here")
        return
    steps = [("seed_if_empty", seed_if_empty), ("seed_phase15", seed_phase15), ("seed_phase2", seed_phase2), ("seed_phase3", seed_phase3), ("system_roles", _system_roles),
             ("seed_marketing_user", seed_marketing_user), ("owner_bootstrap", _owner_bootstrap), ("seed_phase5", seed_phase5), ("migrate_phase7", migrate_phase7), ("seed_phase7", seed_phase7),
             ("backfill_demand_installments", backfill_demand_installments), ("migrate_phase_g", _migrate_phase_g), ("sweep_notifications", sweep_notifications), ("integrity_report", _integrity),
             ("seed_phase9", seed_phase9), ("counters", _counters_once), ("reconcile", _reconcile), ("startup_phase11", startup_phase11), ("schema_validators", apply_validators), ("price_paise_backfill", backfill_price_paise)]
    if await db.settings.find_one({"key": "story_mode", "value": True}):  # demo-data seeds are replaced by the Phase H story (admin/reseed story=true)
        steps = [s for s in steps if s[0] not in ("seed_phase2", "seed_phase5", "seed_phase9")]

    t0 = time.perf_counter()
    for name, fn in steps:
        await _step(name, fn)
        try:
            await try_acquire("startup")  # renew lease between steps
        except Exception:
            pass
    STARTUP.update(phase="done", done=True, finished_at=__import__("datetime").datetime.now(__import__("datetime").UTC).isoformat())
    logger.info("[startup] background tasks complete in %.1fs: %s", time.perf_counter() - t0, STARTUP["steps"])


async def _migrate_phase_g():
    from migrate_phase_g import migrate_phase_g
    if await db.settings.find_one({"key": "migration_phase_g"}, {"_id": 1}):
        return {"skipped": True}
    return await migrate_phase_g(dry_run=False)


def _spawn(coro):
    t = asyncio.create_task(coro)
    _BG_TASKS.add(t)
    t.add_done_callback(_BG_TASKS.discard)
    return t


@asynccontextmanager
async def lifespan(app: FastAPI):
    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(db.command("ping"), timeout=3)
        STARTUP["db"] = "ok"
    except Exception as e:
        STARTUP["db"] = "unreachable"
        logger.error("[startup] MongoDB unreachable at boot (%s); serving health only until it recovers", e)
    if STARTUP["db"] == "ok":
        try:
            await asyncio.wait_for(ensure_indexes(), timeout=3)
            logger.info("[startup] indexes ensured in %.2fs", time.perf_counter() - t0)
        except asyncio.TimeoutError:
            logger.warning("[startup] index budget exceeded; finishing index creation in background")
            _spawn(ensure_indexes())
        except Exception:
            logger.exception("[startup] ensure_indexes failed (continuing)")
        try:
            await asyncio.wait_for(detect_transaction_support(), timeout=2)
        except Exception:
            logger.warning("[startup] transaction detection skipped")
    STARTUP["essential_done"] = True
    if STARTUP["db"] == "ok":
        try:
            from services.owner_bootstrap import ensure_owner, mark_demo_accounts
            STARTUP["owner_bootstrap"] = await asyncio.wait_for(ensure_owner(), timeout=3)
            await asyncio.wait_for(mark_demo_accounts(), timeout=2)
        except Exception:
            logger.exception("[startup] owner bootstrap failed (will retry after seeding)")
    from services.leader import run_as_leader
    from services.read_models import sweep_loop
    from routers.visits import nudge_loop
    _spawn(startup_tasks())
    _spawn(run_as_leader("scheduler", _overdue_loop, _dues_loop, nudge_loop, sweep_loop, _audit_archive_loop))
    _spawn(init_storage_async())
    logger.info("KKT backend serving after %.2fs (uow=%s); background startup tasks running", time.perf_counter() - t0, UOW_STATE["mode"])
    yield
    for t in list(_BG_TASKS):
        t.cancel()
    client.close()


from fastapi.responses import ORJSONResponse
app = FastAPI(default_response_class=ORJSONResponse, title="KKT Real Estate ERP", version=VERSION, openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url="/api/redoc", lifespan=lifespan)


@app.exception_handler(StarletteHTTPException)
@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    code = getattr(exc, "code", None) or STATUS_CODES.get(exc.status_code, "ERROR")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    rid = getattr(request.state, "request_id", None)
    extra = getattr(exc, "extra", None) or {}
    content = {"detail": detail, "code": code, "request_id": rid, **extra, "error": {"code": code, "message": detail, "details": [extra] if extra else [], "request_id": rid}}
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
    rid = getattr(request.state, "request_id", None)
    msg = summary or "Validation error"
    return JSONResponse(status_code=422, content={"detail": msg, "code": "VALIDATION_ERROR", "errors": errors, "request_id": rid, "error": {"code": "VALIDATION_ERROR", "message": msg, "details": errors, "request_id": rid}})


@app.exception_handler(Exception)
async def unhandled_exc_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error")
    rid = getattr(request.state, "request_id", None)
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR", "request_id": rid, "error": {"code": "INTERNAL_ERROR", "message": "Internal server error", "details": [], "request_id": rid}})


api_router = APIRouter(prefix="/api")


async def _dues_loop():
    """Daily at 00:30 IST (+ once on startup): raise time-triggered installments."""
    from datetime import datetime, timedelta, timezone
    from services.dues_engine import run_dues_for_all
    ist = timezone(timedelta(hours=5, minutes=30))
    while True:
        try:
            res = await timed_job("dues_engine", run_dues_for_all)
            if res["demands_raised"]:
                logger.info("Dues engine raised %s demands", res["demands_raised"])
            from services.integrity import integrity_report
            from routers.notifications import notify_roles
            ir = await integrity_report()
            logger.info("[phase7] nightly integrity: ok=%s counts=%s", ir["ok"], ir["counts"])
            if ir["findings"]:
                for cid in {f["booking_id"] for f in ir["findings"]} and {c["id"] for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None)}:
                    await notify_roles(cid, ["Super Admin", "Accounts"], "Dues integrity findings", f"{len(ir['findings'])} finding(s): " + ", ".join(f"{k} {v}" for k, v in ir["counts"].items()), "integrity.findings", "system", "dues", "/settings")
        except Exception as e:
            logger.warning("dues loop error: %s", e)
        now = datetime.now(ist)
        nxt = now.replace(hour=0, minute=30, second=0, microsecond=0)
        if nxt <= now:
            nxt += timedelta(days=1)
        await asyncio.sleep((nxt - now).total_seconds())


async def _audit_archive_loop():
    from datetime import UTC, datetime, timedelta

    from services.audit_archive import archive_old_rows, ensure_indexes
    await ensure_indexes()
    while True:
        now = datetime.now(UTC)
        nxt = (now.replace(day=1, hour=2, minute=0, second=0, microsecond=0) + timedelta(days=32)).replace(day=1)
        await asyncio.sleep((nxt - now).total_seconds())
        try:
            await timed_job("audit_archive", archive_old_rows)
        except Exception:
            logging.getLogger("kkt").exception("audit archive job failed")


async def _overdue_loop():
    from routers.notifications import overdue_demand_job
    while True:
        try:
            await timed_job("overdue_notifications", overdue_demand_job)
        except Exception:
            logging.getLogger("kkt").exception("overdue job failed")
        await asyncio.sleep(24 * 3600)


async def _db_ping_ms():
    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(db.command("ping"), timeout=1)
        STARTUP["db"] = "ok"
        return round((time.perf_counter() - t0) * 1000, 2)
    except Exception:
        STARTUP["db"] = "unreachable"
        return None


def _health_payload(ping):
    return {"status": "ok" if ping is not None else "degraded", "db": STARTUP["db"], "db_ping_ms": ping, "service": "kkt-erp", "version": VERSION,
            "uptime_s": round(time.time() - START_TIME), "startup": {"phase": STARTUP["phase"], "done": STARTUP["done"], "started_at": STARTUP["started_at"]},
            "transaction_mode": UOW_STATE["mode"], "transactions_supported": UOW_STATE["transactions"], "workers": os.environ.get("WEB_CONCURRENCY", "1"), "pid": os.getpid()}


@api_router.get("/health", tags=["system"])
async def health():
    return _health_payload(await _db_ping_ms())


@api_router.get("/ready", tags=["system"])
async def ready():
    ping = await _db_ping_ms()
    body = {"ready": ping is not None and STARTUP["essential_done"], "db": STARTUP["db"], "startup": {"phase": STARTUP["phase"], "done": STARTUP["done"]}, "workers_hint": os.environ.get("WEB_CONCURRENCY", "1"), "transaction_mode": UOW_STATE["mode"]}
    return body if body["ready"] else JSONResponse(body, status_code=503)


@app.get("/health", include_in_schema=False)
async def root_health():
    return _health_payload(await _db_ping_ms())


@api_router.get("/metrics", tags=["system"])
async def metrics(user: dict = Depends(require("admin.system_health.view"))):
    return metrics_snapshot()


from routers import ops as _ops
from routers import reports_i as _reports_i
from routers import propagation
from routers import access as _access
for r in (_ops.router, _access.router, auth.router, users.router, roles.router, master.router, projects.router, rate_cards.router, blocks.router, masters_plus.router, flats.router, parking.router,
          settings.router, audit.router, dashboard.router, search.router, imports.router,
          customers.router, leads.router, documents.router, bookings.router, milestones.router, payments.router, roznamcha.router, admin.router, cms.router, public.router, reports.router, notifications.router, pdfs.router, dashboard_widgets.router, portal.router, portal.mgmt, support.router, construction.router, visits.pub, visits.router,
          catalogues.router, project_setup.router, crm.router, bootstrap.router, home.router, propagation.router, _reports_i.router):
    api_router.include_router(r)

app.include_router(api_router)

_cors_list = [o.strip() for o in (os.environ.get("CORS_ORIGINS") or "").split(",") if o.strip() and o.strip() != "*"]
# ERP is same-origin (served at `/`): default DENY. Explicit origins only via CORS_ORIGINS; "*" is ignored (never wildcard + credentials).
if _cors_list:
    app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=_cors_list, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID", "X-Response-Time", "ETag", "Idempotent-Replayed", "Content-Disposition"])
app.add_middleware(ETagMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(IdempotencyMiddleware)
app.add_middleware(ObservabilityMiddleware)
