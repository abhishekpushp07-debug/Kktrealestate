"""Leaf: background-job timing registry (read by /api/admin/ops). No project imports."""
import time
from datetime import datetime, timezone

JOBS: dict[str, dict] = {}


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
