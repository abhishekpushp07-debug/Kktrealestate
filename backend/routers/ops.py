from services import clock
"""Phase D5: /api/admin/ops — in-process observability snapshot (Super Admin)."""
import os
import time

from fastapi import APIRouter, Depends, Request

from db import POOL, db
from dbtiming import POOL_STATS
from deps import require
from utils import ApiError, client_ip, write_audit

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
        "load_shed": __import__("services.loadshed", fromlist=["snapshot"]).snapshot(),
        "pool": {**__import__("dbtiming").POOL_STATS, "max_pool_size": __import__("db").POOL["maxPoolSize"]},
        "caches": {"ttlcache": __import__("services.ttlcache", fromlist=["snapshot"]).snapshot()},
        "alerts": __import__("services.alerts", fromlist=["LAST"]).LAST,
        "backup": await _backup_status(),
        "storage": await __import__("routers.files", fromlist=["storage_usage"]).storage_usage(),
        "job_runs": await __import__("services.job_runs", fromlist=["health"]).health(),
        "read_models": {"last_full_refresh": (rm or {}).get("value"), "oldest_project_summary_age_s": staleness_s},
        "cache": __import__("services.ttlcache", fromlist=["HITS"]).HITS, "db_pool": {"config": POOL, "live": POOL_STATS, "server": {"connections": (srv.get("connections") or {}), "opcounters": (srv.get("opcounters") or {}),
                                                                   "version": srv.get("version")} if srv else None},
    }


async def _backup_status() -> dict:
    """Phase K.12: last app-level backup + restore drill; stale when > 26 h. (Managed Atlas keeps its own snapshots — this is the app-level export.)"""
    from datetime import datetime, timezone
    lb = await db.settings.find_one({"key": "last_backup"}, {"_id": 0, "value": 1})
    rd = await db.settings.find_one({"key": "last_restore_drill"}, {"_id": 0, "value": 1})
    v = (lb or {}).get("value")
    age_h = round((datetime.now(timezone.utc) - datetime.fromisoformat(v["created_at"])).total_seconds() / 3600, 1) if v else None
    return {"last_backup": v, "age_h": age_h, "stale": age_h is None or age_h > 26, "last_restore_drill": (rd or {}).get("value"), "note": "App-level mongodump export; managed Atlas snapshots are separate"}


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str, body: dict, request: Request, user: dict = Depends(require("admin.system_health.view"))):
    """Super Admin clears a resolved alert; it stays cleared while the values the rule looked at are unchanged, and re-fires when they change."""
    if "Super Admin" not in (user.get("role_names") or user.get("roles") or []):
        raise ApiError(403, "Only Super Admin can acknowledge alerts", "PERMISSION_DENIED")
    from services import alerts
    try:
        ack = await alerts.acknowledge(alert_id, user, (body or {}).get("note"))
    except ValueError:
        raise ApiError(404, f"Unknown alert '{alert_id}'", "NOT_FOUND")
    await write_audit(user, "alert.acknowledge", "alert", alert_id, after={"note": ack["note"], "fingerprint": ack["fingerprint"]}, ip=client_ip(request))
    return {"ok": True, "alert_id": alert_id, "ack": ack}
