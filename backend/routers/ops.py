from services import clock
"""Phase D5: /api/admin/ops — in-process observability snapshot (Super Admin)."""
import os
import time

from fastapi import APIRouter, Depends

from db import POOL, db
from dbtiming import POOL_STATS
from deps import require

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/ops")
async def ops(window: int = 900, user: dict = Depends(require("admin.system_health.view"))):
    from infra import START_TIME, ops_snapshot
    from server import STARTUP
    snap = ops_snapshot(max(60, min(window, 900)))
    rm = await db.settings.find_one({"key": "read_models_v1"}, {"_id": 0, "value": 1})
    oldest = await db.project_summaries.find({}, {"_id": 0, "computed_at": 1}).sort("computed_at", 1).limit(1).to_list(1)
    staleness_s = None
    if oldest:
        from datetime import datetime, timezone
        try:
            staleness_s = round((clock.now() - datetime.fromisoformat(oldest[0]["computed_at"])).total_seconds())
        except Exception:  # noqa: BLE001
            staleness_s = None
    try:
        import resource
        rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:  # noqa: BLE001
        rss_mb = None
    srv = await db.command("serverStatus") if os.environ.get("OPS_SERVER_STATUS", "1") == "1" else {}
    return {
        "generated_at": time.time(),
        "uptime_s": round(time.time() - START_TIME),
        "startup": STARTUP,
        "process": {"pid": os.getpid(), "rss_mb": rss_mb, "db_name": os.environ.get("DB_NAME")},
        "requests": {k: snap[k] for k in ("window_s", "requests", "rps", "p50_ms", "p95_ms", "by_group", "slow", "errors_by_code")},
        "jobs": snap["jobs"],
        "read_models": {"last_full_refresh": (rm or {}).get("value"), "oldest_project_summary_age_s": staleness_s},
        "cache": __import__("services.ttlcache", fromlist=["HITS"]).HITS, "db_pool": {"config": POOL, "live": POOL_STATS, "server": {"connections": (srv.get("connections") or {}), "opcounters": (srv.get("opcounters") or {}),
                                                                   "version": srv.get("version")} if srv else None},
    }
