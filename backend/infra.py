import asyncio
import os
import json
import logging
import time
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timezone

import jwt
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from db import db
from dbtiming import DB_MS

logger = logging.getLogger("kkt.http")


class ETagMiddleware(BaseHTTPMiddleware):
    """Strong ETag (sha1 of body) on every JSON GET under /api; If-None-Match → 304. Skips streams/binary/already-tagged."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.method != "GET" or not request.url.path.startswith("/api") or response.status_code != 200 or "etag" in response.headers:
            return response
        if not (response.headers.get("content-type") or "").startswith("application/json"):
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        import hashlib
        tag = '"' + hashlib.sha1(body).hexdigest()[:32] + '"'
        headers = dict(response.headers)
        headers["ETag"] = tag
        headers.setdefault("Cache-Control", "private, no-cache")
        headers.pop("content-length", None)
        if request.headers.get("if-none-match") == tag:
            return Response(status_code=304, headers={k: v for k, v in headers.items() if k.lower() not in ("content-type",)})
        return Response(content=body, status_code=200, media_type=response.media_type, headers=headers)
START_TIME = time.time()
MAX_BODY = 2 * 1024 * 1024
BUCKETS = [50, 100, 300, 1000, 3000]
METRICS: dict[str, dict] = defaultdict(lambda: {"count": 0, "errors": 0, "total_ms": 0.0, "max_ms": 0.0, "buckets": {str(b): 0 for b in BUCKETS + ["inf"]}})

# ---- Ops ring buffer (rolling 15 min, in-process) + background job registry (Phase D5) ----
from collections import deque  # noqa: E402

RING: deque = deque(maxlen=20000)  # (ts, route_group, status, ms, db_ms, rid, path, dbq)
SLOW: deque = deque(maxlen=50)
ERRORS: dict[str, int] = defaultdict(int)
JOBS: dict[str, dict] = {}
_GROUPS = (("GET /api/bootstrap", "bootstrap"), ("/api/dashboard", "dashboard"), ("/api/home", "dashboard"), ("/api/search", "search"), ("/api/reports", "reports"),
           ("/api/customers/", "customer_detail"), ("/api/bookings/", "booking_detail"), ("/api/payments", "payments"), ("/api/customers", "customers"), ("/api/bookings", "bookings"),
           ("/api/flats", "inventory"), ("/api/leads", "crm"), ("/api/site-visits", "crm"), ("/api/service-requests", "support"), ("/api/admin", "admin"), ("/api/auth", "auth"))


def route_group(method: str, path: str) -> str:
    key = f"{method} {path}"
    for prefix, g in _GROUPS:
        if key.startswith(prefix) or path.startswith(prefix):
            if g in ("customer_detail", "booking_detail") and path.rstrip("/").count("/") < 3:
                continue
            return g
    return "other"


def record_job(name: str, started: float, ok: bool, result=None, error: str | None = None):
    JOBS[name] = {"last_run": datetime.now(timezone.utc).isoformat(), "duration_ms": round((time.perf_counter() - started) * 1000, 1), "ok": ok,
                  "result": (result if isinstance(result, (int, float, str, bool, type(None))) else {k: v for k, v in (result or {}).items() if isinstance(v, (int, float, str, bool))} if isinstance(result, dict) else str(result)[:200]),
                  "error": error, "runs": JOBS.get(name, {}).get("runs", 0) + 1}


async def timed_job(name: str, coro_fn, *a, **kw):
    t = time.perf_counter()
    try:
        res = await coro_fn(*a, **kw)
        record_job(name, t, True, res)
        return res
    except Exception as e:  # noqa: BLE001
        record_job(name, t, False, None, f"{type(e).__name__}: {e}"[:300])
        raise


def ops_snapshot(window_s: int = 900) -> dict:
    now = time.time()
    cutoff = now - window_s
    rows = [r for r in RING if r[0] >= cutoff]
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        groups[r[1]].append(r)

    def pct(xs, p):
        if not xs:
            return None
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, int(len(xs) * p))], 1)
    by_group = {}
    for g, rs in sorted(groups.items()):
        ms = [r[3] for r in rs]
        by_group[g] = {"count": len(rs), "rps": round(len(rs) / window_s, 2), "p50_ms": pct(ms, 0.5), "p95_ms": pct(ms, 0.95), "p99_ms": pct(ms, 0.99),
                       "db_p95_ms": pct([r[4] for r in rs], 0.95), "avg_queries": round(sum(r[7] for r in rs) / len(rs), 1), "errors_5xx": sum(1 for r in rs if r[2] >= 500), "errors_4xx": sum(1 for r in rs if 400 <= r[2] < 500)}
    return {"window_s": window_s, "requests": len(rows), "rps": round(len(rows) / window_s, 2), "p50_ms": pct([r[3] for r in rows], 0.5), "p95_ms": pct([r[3] for r in rows], 0.95),
            "by_group": by_group, "slow": [{"at": datetime.fromtimestamp(r[0], timezone.utc).isoformat(), "path": r[6], "ms": round(r[3], 1), "status": r[2], "request_id": r[5]} for r in list(SLOW)[-20:]][::-1],
            "errors_by_code": dict(ERRORS), "jobs": JOBS}


def _route_key(request: Request) -> str:
    route = request.scope.get("route")
    return f"{request.method} {getattr(route, 'path', request.url.path)}"


REQUEST_TIMEOUT_S = float(os.environ.get("REQUEST_TIMEOUT_S", "60"))


def surfaces_enabled(request: Request | None = None) -> bool:
    """Public website + customer-portal APIs are parked (Phase C). PUBLIC_SURFACES_ENABLED=true re-enables them.
    Test-only: a request carrying the process-env LOGIN_RATE_LIMIT_BYPASS_TOKEN (never set in production) also sees them enabled,
    so the parked code stays fully exercised by the suite while the preview keeps surfaces off."""
    if os.environ.get("PUBLIC_SURFACES_ENABLED", "false").lower() in ("1", "true", "yes"):
        return True
    tok = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN")
    return bool(tok) and request is not None and request.headers.get("x-rate-limit-bypass") == tok


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        from deps import _BYPASS_HDR
        _BYPASS_HDR.set(request.headers.get("x-rate-limit-bypass"))
        from services import clock
        from services.clock import REQ_CTX
        clock.set_as_of(request.headers.get("x-as-of") if clock.enabled() and request.headers.get("x-as-of") and request.headers.get("x-rate-limit-bypass") == os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN") else None)
        request.state.request_id = rid
        REQ_CTX.set({"request_id": rid, "user_agent": (request.headers.get("user-agent") or "")[:200]})
        if not surfaces_enabled(request) and (request.url.path.startswith("/api/public/") or request.url.path.startswith("/api/portal/") or request.url.path in ("/api/public", "/api/portal")):
            return JSONResponse(status_code=404, content={"detail": "Not found", "code": "NOT_FOUND", "request_id": rid, "error": {"code": "NOT_FOUND", "message": "Not found", "details": [], "request_id": rid}})
        cl = request.headers.get("content-length")
        limit = (5 * 1024 * 1024 + 1024) if "/api/uploads/" in request.url.path and "/parts/" in request.url.path else MAX_BODY
        if cl and cl.isdigit() and int(cl) > limit:
            return JSONResponse(status_code=413, content={"detail": "Request body too large (max 2 MB)", "code": "PAYLOAD_TOO_LARGE", "request_id": rid, "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Request body too large (max 2 MB)", "details": [], "request_id": rid}})
        t0 = time.perf_counter()
        acc = [0.0, 0]
        token = DB_MS.set(acc)
        try:
            budget = 900.0 if request.url.path.endswith("/complete") and "/api/uploads/" in request.url.path else REQUEST_TIMEOUT_S
            response = await asyncio.wait_for(call_next(request), timeout=budget)
        except asyncio.TimeoutError:
            logger.error(json.dumps({"request_id": rid, "path": request.url.path, "error": "timeout"}))
            response = JSONResponse(status_code=504, content={"detail": "Request timed out", "code": "REQUEST_TIMEOUT", "request_id": rid, "error": {"code": "REQUEST_TIMEOUT", "message": "Request timed out", "details": [], "request_id": rid}})
        except Exception:
            logger.exception(json.dumps({"request_id": rid, "path": request.url.path, "error": "unhandled"}))
            response = JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR", "request_id": rid, "error": {"code": "INTERNAL_ERROR", "message": "Internal server error", "details": [], "request_id": rid}})
        finally:
            DB_MS.reset(token)
        ms = (time.perf_counter() - t0) * 1000
        response.headers["X-Request-ID"] = rid
        response.headers["X-Response-Time"] = f"{ms:.1f}ms"
        response.headers["Server-Timing"] = f"db;dur={acc[0]:.1f}, dbq;dur={acc[1]};desc=\"queries\", app;dur={max(ms - acc[0], 0):.1f}"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        if request.url.path.startswith("/api"):
            if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
                from services import ttlcache
                ttlcache.invalidate("list:")  # any successful write drops first-page list caches (writes that bypass the event bus included)
            RING.append((time.time(), route_group(request.method, request.url.path), response.status_code, ms, acc[0], rid, request.url.path, acc[1]))
            if ms > 500:
                SLOW.append(RING[-1])
            if response.status_code >= 400:
                ERRORS[str(response.status_code)] += 1
            m = METRICS[_route_key(request)]
            m["count"] += 1
            m["total_ms"] += ms
            m["max_ms"] = max(m["max_ms"], ms)
            if response.status_code >= 500:
                m["errors"] += 1
            for b in BUCKETS:
                if ms <= b:
                    m["buckets"][str(b)] += 1
                    break
            else:
                m["buckets"]["inf"] += 1
            entry = {"request_id": rid, "method": request.method, "path": request.url.path, "status": response.status_code,
                     "duration_ms": round(ms, 1), "user_id": getattr(request.state, "user_id", None)}
            if ms > 500:
                logger.warning(json.dumps({**entry, "slow": True}))
            else:
                logger.info(json.dumps(entry))
        return response


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Phase K durable idempotency: claim (owner, key) with route + body hash BEFORE the handler runs.
    in-progress duplicate: wait <=10 s then 409 IDEMPOTENCY_IN_PROGRESS; same key different body: 422 IDEMPOTENCY_MISMATCH; different route: 422 IDEMPOTENCY_KEY_REUSED;
    replay: stored response + Idempotent-Replayed: true; one-time secrets stored redacted so replay is 409 IDEMPOTENT_SECRET_REPLAY; claims abandoned after 60 s; TTL 24 h."""
    SECRET_KEYS = ("temp_password", "temporary_password", "api_key", "reset_token", "otp", "recovery_codes")

    @staticmethod
    def _err(status, code, msg, headers=None):
        return JSONResponse(status_code=status, headers=headers or {}, content={"detail": msg, "code": code, "error": {"code": code, "message": msg}})

    async def dispatch(self, request, call_next):
        key = request.headers.get("idempotency-key")
        if request.method != "POST" or not key or not request.url.path.startswith("/api"):
            return await call_next(request)
        import hashlib
        from datetime import timedelta
        auth = request.headers.get("authorization", "")
        try:
            sub = jwt.decode(auth[7:], options={"verify_signature": False}).get("sub") if auth.lower().startswith("bearer ") else None
        except Exception:
            sub = None
        owner = sub or request.headers.get("x-forwarded-for", request.client.host if request.client else "anon")
        raw = await request.body()
        body_hash = hashlib.sha256(raw).hexdigest()
        now = datetime.now(UTC)
        try:
            await db.idempotency_claims.insert_one({"owner": owner, "key": key, "path": request.url.path, "body_hash": body_hash, "state": "in_progress", "created_at": now, "updated_at": now})
        except Exception:
            deadline = time.time() + 10
            while True:
                existing = await db.idempotency_claims.find_one({"owner": owner, "key": key}, {"_id": 0})
                if not existing:
                    return self._err(409, "IDEMPOTENCY_IN_PROGRESS", "Request with this Idempotency-Key is still being processed; retry shortly", {"Retry-After": "2"})
                if existing["path"] != request.url.path:
                    return self._err(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key already used for a different endpoint")
                if existing["body_hash"] != body_hash:
                    return self._err(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was used with a different request body")
                if existing["state"] == "done":
                    if existing.get("secret_redacted"):
                        return self._err(409, "IDEMPOTENT_SECRET_REPLAY", "This response carried a one-time secret and cannot be replayed; issue a new request")
                    return Response(content=existing["body"], status_code=existing["status"], media_type="application/json", headers={"Idempotent-Replayed": "true"})
                upd = existing["updated_at"]
                upd = upd if upd.tzinfo else upd.replace(tzinfo=UTC)
                if now - upd > timedelta(seconds=60):
                    r = await db.idempotency_claims.update_one({"owner": owner, "key": key, "state": "in_progress", "updated_at": existing["updated_at"]}, {"$set": {"updated_at": now}})
                    if r.modified_count:
                        break
                if time.time() >= deadline:
                    return self._err(409, "IDEMPOTENCY_IN_PROGRESS", "Request with this Idempotency-Key is still being processed; retry shortly", {"Retry-After": "2"})
                await asyncio.sleep(0.25)
        try:
            response = await call_next(request)
        except Exception:
            await db.idempotency_claims.delete_one({"owner": owner, "key": key, "state": "in_progress"})
            raise
        body = b"".join([chunk async for chunk in response.body_iterator])
        stored = body
        if response.headers.get("content-encoding") == "gzip":
            import gzip
            try:
                stored = gzip.decompress(body)
            except (EOFError, OSError):
                stored = None
        if response.status_code < 500 and stored is not None:
            text = stored.decode("utf-8", "replace")
            redacted = response.status_code < 300 and any(f'"{k}"' in text for k in self.SECRET_KEYS)
            await db.idempotency_claims.update_one({"owner": owner, "key": key}, {"$set": {"state": "done", "status": response.status_code, "body": "" if redacted else text, "secret_redacted": redacted, "updated_at": datetime.now(UTC)}})
        else:
            await db.idempotency_claims.delete_one({"owner": owner, "key": key})
        return Response(content=body, status_code=response.status_code, media_type=response.media_type, headers=dict(response.headers))


def metrics_snapshot() -> dict:
    out = {}
    for k, m in METRICS.items():
        out[k] = {**m, "avg_ms": round(m["total_ms"] / m["count"], 1) if m["count"] else 0, "max_ms": round(m["max_ms"], 1), "total_ms": round(m["total_ms"], 1)}
    return {"uptime_s": round(time.time() - START_TIME), "routes": out}
