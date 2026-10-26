"""Phase K: durable job runs. Every scheduled job writes a job_runs record; per-item failures are captured and the run continues.
Statuses: RUNNING → OK | FAILED (some items failed) | ABANDONED (stuck > 2× budget, marked by JOB_RUN_SWEEP)."""
import logging
import time
from datetime import datetime, timedelta, timezone

from db import db

log = logging.getLogger("jobs")
BUDGET_S = {"DAILY_DUES": 600, "NIGHTLY_INTEGRITY": 600, "JOB_RUN_SWEEP": 60, "BACKUP": 1800, "RESTORE_DRILL": 1800, "ALERTS": 60}
STALE_AFTER_H = 26
WATCHED = ("DAILY_DUES", "NIGHTLY_INTEGRITY")


def _now():
    return datetime.now(timezone.utc)


async def start(job: str, meta: dict | None = None) -> dict:
    run = {"id": f"{job}-{int(time.time() * 1000)}", "job": job, "started_at": _now().isoformat(), "finished_at": None, "status": "RUNNING", "items": 0, "failed_items": 0, "errors": [], "budget_s": BUDGET_S.get(job, 600), **(meta or {})}
    await db.job_runs.insert_one({**run})
    return run


async def item_failed(run: dict, item_id: str, err: Exception | str):
    run["failed_items"] += 1
    e = {"item": item_id, "error": f"{type(err).__name__}: {err}"[:300] if isinstance(err, Exception) else str(err)[:300], "at": _now().isoformat()}
    if len(run["errors"]) < 50:
        run["errors"].append(e)
    log.warning("[job %s] item %s failed: %s", run["job"], item_id, e["error"])


async def finish(run: dict, result: dict | None = None):
    run["finished_at"] = _now().isoformat()
    run["status"] = "FAILED" if run["failed_items"] else "OK"
    run["duration_ms"] = round((datetime.fromisoformat(run["finished_at"]) - datetime.fromisoformat(run["started_at"])).total_seconds() * 1000)
    await db.job_runs.update_one({"id": run["id"]}, {"$set": {k: v for k, v in run.items() if k != "_id"} | {"result": result or {}}})
    run["result"] = result or {}
    return run


async def run_isolated(job: str, items, fn, item_id=lambda x: x.get("id", "?"), result_fn=None) -> dict:
    """Run fn(item) for every item; one bad item never stops the run."""
    run = await start(job)
    acc = []
    async for it in items:
        run["items"] += 1
        try:
            acc.append(await fn(it))
        except Exception as e:  # noqa: BLE001 — isolation is the point
            await item_failed(run, item_id(it), e)
    return await finish(run, result_fn(acc) if result_fn else {"ok_items": len(acc)})


async def sweep() -> int:
    """JOB_RUN_SWEEP: runs still RUNNING after 2× their budget are ABANDONED (the process died or hung)."""
    n = 0
    async for r in db.job_runs.find({"status": "RUNNING"}, {"_id": 0, "id": 1, "started_at": 1, "budget_s": 1}):
        if _now() - datetime.fromisoformat(r["started_at"]) > timedelta(seconds=2 * r.get("budget_s", 600)):
            await db.job_runs.update_one({"id": r["id"]}, {"$set": {"status": "ABANDONED", "finished_at": _now().isoformat()}})
            n += 1
    return n


async def health() -> dict:
    """Last OK per job + stale flags (no OK run in 26 h for the watched jobs)."""
    out, stale = {}, []
    jobs = await db.job_runs.distinct("job")
    for j in set(jobs) | set(WATCHED):
        last_ok = await db.job_runs.find_one({"job": j, "status": "OK"}, {"_id": 0, "finished_at": 1, "duration_ms": 1}, sort=[("finished_at", -1)])
        last = await db.job_runs.find_one({"job": j}, {"_id": 0, "status": 1, "finished_at": 1, "started_at": 1, "failed_items": 1, "items": 1}, sort=[("started_at", -1)])
        is_stale = j in WATCHED and (not last_ok or _now() - datetime.fromisoformat(last_ok["finished_at"]) > timedelta(hours=STALE_AFTER_H))
        out[j] = {"last_ok_at": (last_ok or {}).get("finished_at"), "last_ok_duration_ms": (last_ok or {}).get("duration_ms"), "last_status": (last or {}).get("status"), "last_items": (last or {}).get("items"), "last_failed_items": (last or {}).get("failed_items"), "stale": is_stale}
        if is_stale:
            stale.append(j)
    return {"jobs": out, "stale": stale, "stale_after_h": STALE_AFTER_H}


async def notify_stale_if_needed():
    h = await health()
    if not h["stale"]:
        return h
    marker = await db.settings.find_one({"key": "job_stale_notified"}, {"_id": 0, "value": 1})
    today = _now().date().isoformat()
    if (marker or {}).get("value") == today:
        return h
    from routers.notifications import notify_roles
    for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None):
        await notify_roles(c["id"], ["Super Admin"], "Scheduled job stale", f"No successful run in {STALE_AFTER_H} h: {', '.join(h['stale'])}", "job.stale", "system", "jobs", "/settings/system-health")
    await db.settings.update_one({"key": "job_stale_notified"}, {"$set": {"value": today}}, upsert=True)
    return h
