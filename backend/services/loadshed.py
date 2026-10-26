"""Phase K.7: load shedding. In-flight cap (API_MAX_INFLIGHT) with a pre-built 503 body; event-loop lag probe lowers the cap to 25% (floor 8).
Probes (/health, /api/health, /api/ready, /metrics) are never shed. Shed logs are throttled to one line per 5 s."""
import asyncio
import json
import logging
import os
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

log = logging.getLogger("loadshed")
EXEMPT = ("/health", "/api/health", "/api/ready", "/metrics", "/api/metrics")
MAX_INFLIGHT = int(os.environ.get("API_MAX_INFLIGHT", str(max(32, 64 * int(os.environ.get("WEB_CONCURRENCY", "1"))))))
LAG_THRESHOLD_S = float(os.environ.get("API_LOOP_LAG_SHED_S", "0.25"))
STATE = {"inflight": 0, "shed_total": 0, "loop_lag_ms": 0.0, "degraded": False, "cap": MAX_INFLIGHT, "last_log": 0.0}
_BODY = json.dumps({"detail": "Server busy, retry shortly", "code": "OVERLOADED", "error": {"code": "OVERLOADED", "message": "Server busy, retry shortly"}}).encode()


def current_cap() -> int:
    return max(8, MAX_INFLIGHT // 4) if STATE["degraded"] else MAX_INFLIGHT


async def lag_probe(interval: float = 0.5):
    """Measures how late the loop wakes up; sustained lag above threshold marks the process degraded."""
    while True:
        t0 = time.perf_counter()
        await asyncio.sleep(interval)
        lag = time.perf_counter() - t0 - interval
        STATE["loop_lag_ms"] = round(max(0.0, lag) * 1000, 1)
        STATE["degraded"] = lag > LAG_THRESHOLD_S
        STATE["cap"] = current_cap()


class LoadShedMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in EXEMPT or STATE.get("force_cap") is None and STATE["inflight"] < current_cap():
            pass
        elif STATE["inflight"] >= (STATE.get("force_cap") or current_cap()):
            STATE["shed_total"] += 1
            now = time.time()
            if now - STATE["last_log"] > 5:
                STATE["last_log"] = now
                log.warning("shedding: inflight=%s cap=%s degraded=%s shed_total=%s", STATE["inflight"], current_cap(), STATE["degraded"], STATE["shed_total"])
            return Response(content=_BODY, status_code=503, media_type="application/json", headers={"Retry-After": "2"})
        STATE["inflight"] += 1
        try:
            return await call_next(request)
        finally:
            STATE["inflight"] -= 1


def snapshot() -> dict:
    return {"inflight": STATE["inflight"], "cap": current_cap(), "max_inflight": MAX_INFLIGHT, "degraded": STATE["degraded"], "loop_lag_ms": STATE["loop_lag_ms"], "shed_total": STATE["shed_total"]}
