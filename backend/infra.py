import json
import logging
import time
import uuid
from collections import defaultdict
from datetime import UTC

import jwt
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from db import db

logger = logging.getLogger("kkt.http")
START_TIME = time.time()
MAX_BODY = 2 * 1024 * 1024
BUCKETS = [50, 100, 300, 1000, 3000]
METRICS: dict[str, dict] = defaultdict(lambda: {"count": 0, "errors": 0, "total_ms": 0.0, "max_ms": 0.0, "buckets": {str(b): 0 for b in BUCKETS + ["inf"]}})


def _route_key(request: Request) -> str:
    route = request.scope.get("route")
    return f"{request.method} {getattr(route, 'path', request.url.path)}"


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY:
            return JSONResponse(status_code=413, content={"detail": "Request body too large (max 2 MB)", "code": "PAYLOAD_TOO_LARGE"})
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(json.dumps({"request_id": rid, "path": request.url.path, "error": "unhandled"}))
            response = JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL_ERROR"})
        ms = (time.perf_counter() - t0) * 1000
        response.headers["X-Request-ID"] = rid
        response.headers["X-Response-Time"] = f"{ms:.1f}ms"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/api"):
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
            if ms > 300:
                logger.warning(json.dumps({**entry, "slow": True}))
            else:
                logger.info(json.dumps(entry))
        return response


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Replays stored responses for POST requests carrying Idempotency-Key (per user, 24h TTL)."""

    async def dispatch(self, request, call_next):
        key = request.headers.get("idempotency-key")
        if request.method != "POST" or not key or not request.url.path.startswith("/api"):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        try:
            sub = jwt.decode(auth[7:], options={"verify_signature": False}).get("sub") if auth.lower().startswith("bearer ") else None
        except Exception:
            sub = None
        owner = sub or request.headers.get("x-forwarded-for", request.client.host if request.client else "anon")
        existing = await db.idempotency_keys.find_one({"user_id": owner, "key": key}, {"_id": 0})
        if existing:
            if existing["path"] != request.url.path:
                return JSONResponse(status_code=422, content={"detail": "Idempotency-Key already used for a different endpoint", "code": "IDEMPOTENCY_KEY_REUSED"})
            return Response(content=existing["body"], status_code=existing["status"], media_type="application/json", headers={"Idempotent-Replayed": "true"})
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
        stored = body
        if response.headers.get("content-encoding") == "gzip":
            import gzip
            stored = gzip.decompress(body)
        if response.status_code < 500:
            from datetime import datetime
            try:
                await db.idempotency_keys.insert_one({"user_id": owner, "key": key, "path": request.url.path, "status": response.status_code,
                                                      "body": stored.decode("utf-8", "replace"), "created_at": datetime.now(UTC)})
            except Exception:
                pass
        return Response(content=body, status_code=response.status_code, media_type=response.media_type, headers=dict(response.headers))


def metrics_snapshot() -> dict:
    out = {}
    for k, m in METRICS.items():
        out[k] = {**m, "avg_ms": round(m["total_ms"] / m["count"], 1) if m["count"] else 0, "max_ms": round(m["max_ms"], 1), "total_ms": round(m["total_ms"], 1)}
    return {"uptime_s": round(time.time() - START_TIME), "routes": out}
