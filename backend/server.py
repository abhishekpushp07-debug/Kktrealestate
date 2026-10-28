import asyncio
import ctypes as _ct

try:  # Phase J.2: cap glibc malloc arenas (motor thread pool → one arena per thread → RSS grows with data size); must run before any thread starts
    _ct.CDLL("libc.so.6").mallopt(-8, 2)  # M_ARENA_MAX = 2
except Exception:  # noqa: BLE001
    pass
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


ONE_TIME_STEPS = {"sweep_notifications", "seed_if_empty", "seed_phase15", "seed_phase2", "seed_phase3", "seed_marketing_user", "seed_phase5", "migrate_phase7", "seed_phase8", "backfill_demand_installments",
                  "migrate_phase_g", "seed_phase9", "counters", "startup_phase11", "backfill_price_paise"}
DAILY_STEPS = {"integrity", "reconcile"}  # O(all rows): at startup only when the last completed run is older than 24 h (nightly jobs own them)


async def _watermark_skip(name: str) -> bool:
    """Phase J.2: never rescan completed migrations. `migrations` holds (step, version) → done_at; daily steps skip within 24 h."""
    from datetime import UTC, datetime, timedelta
    if os.environ.get("KKT_FORCE_STARTUP"):
        return False
    if name in ONE_TIME_STEPS:
        return await db.migrations.find_one({"step": name, "version": VERSION}, {"_id": 1}) is not None
    if name in DAILY_STEPS:
        m = await db.migrations.find_one({"step": name}, {"_id": 0, "done_at": 1})
        return bool(m and m["done_at"] > (datetime.now(UTC) - timedelta(hours=24)).isoformat())
    return False


async def _step(name, coro_fn):
    t0 = time.perf_counter()
    STARTUP["phase"] = name
    try:
        if await _watermark_skip(name):
            STARTUP["steps"][name] = "skipped (watermark)"
            return
        await coro_fn()
        STARTUP["steps"][name] = round(time.perf_counter() - t0, 2)
        if name in ONE_TIME_STEPS or name in DAILY_STEPS:
            from datetime import UTC, datetime
            await db.migrations.update_one({"step": name}, {"$set": {"version": VERSION, "done_at": datetime.now(UTC).isoformat(), "took_s": round(time.perf_counter() - t0, 2)}}, upsert=True)
        logger.info("[startup] %s ok in %.2fs", name, time.perf_counter() - t0)
    except Exception:
        STARTUP["steps"][name] = "failed"
        logger.exception("[startup] %s failed (continuing)", name)
    finally:
        _trim_memory()


def _trim_memory():
    """Return freed arenas to the OS after a heavy step (glibc keeps them otherwise → RSS never falls)."""
    import ctypes
    import gc
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001
        pass


async def _inventory_masters():
    """Phase N: allocation categories + hold reasons seeded per company; flats backfilled to Builder saleable."""
    from services import inventory as inv
    async for c in db.companies.find({}, {"_id": 0, "id": 1}):
        await inv.ensure_masters(c["id"])
        await inv.backfill(c["id"])


async def _hold_expiry_loop():
    from services import inventory as inv
    while True:
        try:
            await inv.expire_holds()
        except Exception:  # noqa: BLE001
            logger.exception("[hold-expiry] sweep failed")
        await asyncio.sleep(900)


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
             ("seed_phase9", seed_phase9), ("inventory_masters", _inventory_masters), ("counters", _counters_once), ("reconcile", _reconcile), ("startup_phase11", startup_phase11), ("schema_validators", apply_validators), ("price_paise_backfill", backfill_price_paise)]
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
            await asyncio.wait_for(ensure_indexes(), timeout=float(os.environ.get("INDEX_BUDGET_S", "30")))
            logger.info("[startup] indexes ensured in %.2fs", time.perf_counter() - t0)
        except asyncio.TimeoutError:
            logger.warning("[startup] index budget exceeded; finishing index creation in background")
            _spawn(ensure_indexes())
        except Exception:
            logger.exception("[startup] ensure_indexes failed (continuing)")
        _spawn(__import__("services.invariants", fromlist=["ensure_invariants"]).ensure_invariants())  # Phase K: unique partial indexes + validators (idempotent, background)
        _spawn(__import__("services.loadshed", fromlist=["lag_probe"]).lag_probe())  # Phase K.7: event-loop lag probe
        _spawn(__import__("services.alerts", fromlist=["loop"]).loop())  # Phase K.13: alert rules every minute
        _spawn(_trim_loop())
        if os.environ.get("KKT_TRACEMALLOC"):
            _spawn(_tracemalloc_loop())
        _spawn(_memory_loop())
        _spawn(_hold_expiry_loop())  # Phase N: HOLD_EXPIRY_SWEEP every 15 min
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
    _spawn(run_as_leader("scheduler", _overdue_loop, _dues_loop, nudge_loop, sweep_loop, _audit_archive_loop, _reminders_loop, _message_send_loop))
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
    rid = getattr(request.state, "request_id", None)
    from pymongo.errors import AutoReconnect, ConnectionFailure, ExecutionTimeout, NetworkTimeout, OperationFailure, ServerSelectionTimeoutError, WaitQueueTimeoutError, WriteConcernError
    if isinstance(exc, ExecutionTimeout):  # Phase K.8/K.11: retryable DB envelopes
        return _retryable(rid, 503, "QUERY_TIMEOUT", "Query exceeded its time budget; narrow the filters or retry", "5")
    if isinstance(exc, (AutoReconnect, NetworkTimeout, ServerSelectionTimeoutError, WriteConcernError, WaitQueueTimeoutError, ConnectionFailure)):  # J6: pool wait-queue timeouts are retryable DB_TIMEOUT
        logger.warning("transient db error: %s", exc)
        return _retryable(rid, 503, "DB_TIMEOUT", "Database temporarily unavailable; retry shortly", "2")
    if isinstance(exc, OperationFailure) and (exc.code in (112, 251, 246) or exc.has_error_label("TransientTransactionError")):
        return _retryable(rid, 409, "CONFLICT_RETRY", "Write conflict; retry the request", "1")
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR", "request_id": rid, "error": {"code": "INTERNAL_ERROR", "message": "Internal server error", "details": [], "request_id": rid}})


def _retryable(rid, status, code, msg, retry_after):
    return JSONResponse(status_code=status, headers={"Retry-After": retry_after}, content={"detail": msg, "code": code, "request_id": rid, "error": {"code": code, "message": msg, "details": [], "request_id": rid}})


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
            from services import job_runs as _jr
            _run = await _jr.start("NIGHTLY_INTEGRITY")
            try:
                ir = await integrity_report()
                await _jr.finish(_run, {"ok": ir["ok"], "counts": ir["counts"]})
            except Exception as e:  # noqa: BLE001
                await _jr.item_failed(_run, "integrity_report", e)
                await _jr.finish(_run)
                raise
            await _jr.sweep()
            await _jr.notify_stale_if_needed()
            if os.environ.get("BACKUP_ENABLED", "1") == "1":
                from tools.backup import backup_job
                await backup_job()
            from services.alerts import evaluate_and_notify
            await evaluate_and_notify()
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


async def _reminders_loop():
    """Phase Q: OVERDUE_REMINDERS — checks hourly, sends only inside the owner's IST window; thresholds dedupe via unique index so hourly re-checks never double-send."""
    from services.messaging.reminders import run_overdue_reminders
    while True:
        try:
            await timed_job("overdue_reminders", run_overdue_reminders)
        except Exception:
            logging.getLogger("kkt").exception("reminders job failed")
        await asyncio.sleep(3600)


async def _message_send_loop():
    """Phase Q: MESSAGE_SEND outbox — queued messages with due next_attempt_at, ×3 backoff."""
    from services.messaging.outbox import ensure_indexes, run_message_send
    from services.trends import backfill_once
    try:
        await ensure_indexes()
        await backfill_once()
    except Exception:
        logging.getLogger("kkt").exception("messaging indexes / trends backfill failed")
    while True:
        try:
            await run_message_send()
        except Exception:
            logging.getLogger("kkt").exception("message send job failed")
        await asyncio.sleep(60)


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
from routers import project_statement as _project_statement
from routers import structure as _structure
from routers import graph as _graph
from routers import reports_i as _reports_i
from routers import reports_n as _reports_n
from routers import docgen as _docgen
from routers import demand_register as _demand_register
from routers import messaging as _messaging
from routers import trends as _trends
from routers import load_test as _load_test
from routers import exports as _exports
from routers import files as _files
from routers import inventory as _inventory
from routers import propagation
from routers import access as _access
for r in (_ops.router, _access.router, _exports.router, _files.router, _inventory.router, auth.router, users.router, roles.router, master.router, projects.router, rate_cards.router, blocks.router, masters_plus.router, flats.router, parking.router,
          settings.router, audit.router, dashboard.router, search.router, imports.router,
          customers.router, leads.router, documents.router, bookings.router, milestones.router, payments.router, roznamcha.router, admin.router, cms.router, public.router, reports.router, notifications.router, pdfs.router, dashboard_widgets.router, portal.router, portal.mgmt, support.router, construction.router, visits.pub, visits.router,
          catalogues.router, project_setup.router, crm.router, bootstrap.router, home.router, propagation.router, _reports_i.router, _project_statement.router, _structure.router, _graph.router, _reports_n.router, _docgen.router, _demand_register.router, _messaging.router, _trends.router, _load_test.router):
    api_router.include_router(r)

app.include_router(api_router)

_cors_list, _cors_regex = __import__("services.cors", fromlist=["parse_cors_origins"]).parse_cors_origins(os.environ.get("CORS_ORIGINS"))
# ERP is same-origin (served at `/`): default DENY. Explicit origins or a single-level host wildcard (https://*.emergent.host) via CORS_ORIGINS; "*" is ignored (never wildcard + credentials).
if _cors_list or _cors_regex:
    app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=_cors_list, allow_origin_regex=_cors_regex, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID", "X-Response-Time", "ETag", "Idempotent-Replayed", "Content-Disposition"])
app.add_middleware(ETagMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(IdempotencyMiddleware)
app.add_middleware(ObservabilityMiddleware)
app.add_middleware(__import__("services.loadshed", fromlist=["LoadShedMiddleware"]).LoadShedMiddleware)  # Phase K.7: outermost — sheds before any work


async def _trim_loop():
    """Every 60 s return freed arenas to the OS (RSS otherwise never falls after a heavy job)."""
    while True:
        await asyncio.sleep(60)
        _trim_memory()


async def _tracemalloc_loop():
    """Phase J.2 profiling aid (KKT_TRACEMALLOC=1): log top allocation sites + RSS every 20 s."""
    import tracemalloc
    tracemalloc.start(40)
    while True:
        await asyncio.sleep(20)
        import gc
        unreachable = gc.collect()
        _trim_memory()
        snap = tracemalloc.take_snapshot().statistics("lineno")
        rss = int(open("/proc/self/statm").read().split()[1]) * 4096 // 1048576
        logger.warning("[tracemalloc] rss=%sMB traced=%sMB gc_unreachable=%s phase=%s", rss, tracemalloc.get_traced_memory()[0] // 1048576, unreachable, STARTUP.get("phase"))
        for st in snap[:3]:
            logger.warning("[tracemalloc]   %s", str(st)[:220])
        top = tracemalloc.take_snapshot().statistics("traceback")[0]
        for line in top.traceback.format()[-40:]:
            logger.warning("[tracemalloc] tb %s", line.strip()[:200])
        import gc
        big = []
        for o in gc.get_objects():
            if isinstance(o, (list, dict)) and len(o) > 2000:
                big.append(o)
        big.sort(key=len, reverse=True)
        for o in big[:6]:
            refs = [type(r).__name__ for r in gc.get_referrers(o)[:4]]
            sample = (list(o)[:3] if isinstance(o, dict) else [type(x).__name__ for x in o[:2]])
            logger.warning("[tracemalloc] big %s len=%s refs=%s sample=%s", type(o).__name__, len(o), refs, str(sample)[:160])


async def _memory_loop():
    """Phase J.2: decoded-document cycles (cursor batches, request scopes) linger until gen-2 GC; collect + trim every 20 s so RSS tracks live data, not history."""
    while True:
        await asyncio.sleep(20)
        await asyncio.to_thread(_trim_memory)
