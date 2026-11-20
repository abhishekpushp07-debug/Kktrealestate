"""F-44 nightly demo refresh (REQ-51…59), preview only: 03:00 IST under the scheduler lease, through the existing reseed path.
One rule: it runs only where DEMO_AUTO_REFRESH=true AND every host this database has served is a demo host."""

import asyncio
import fcntl
import logging
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import require
from routers import admin
from services import clock
from services.owner_bootstrap import demo_host_allowed, request_host
from utils import ApiError, StrictModel, write_audit

router = APIRouter(prefix="/admin", tags=["admin"])
log = logging.getLogger("kkt.demo_refresh")
JOB = "DEMO_REFRESH"
RESEED_LOCK = "/tmp/kkt_reseed.lock"  # routers.admin._reseed_lock_acquire
SNAPSHOT_LOCK = "/tmp/kkt_test_snapshot.lock"  # held by tests/conftest.py while it copies the preview DB
STATE = {"running": False}
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def guard(hosts: list[str]) -> str | None:
    """Why the refresh must not run here (None = allowed). Production (billpe.com) or flag absent → disabled."""
    if os.environ.get("DEMO_AUTO_REFRESH", "").strip().lower() != "true":
        return "disabled: DEMO_AUTO_REFRESH is not set on this server"
    if not hosts:
        return "disabled: this server has not served a demo host yet"
    bad = [h for h in hosts if not demo_host_allowed(h)]
    return f"disabled: {bad[0]} is not a demo host" if bad else None


def busy() -> str | None:
    for path, why in ((RESEED_LOCK, "reseed running"), (SNAPSHOT_LOCK, "test snapshot running")):
        try:
            with open(path, "a+") as fh:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(fh, fcntl.LOCK_UN)
        except BlockingIOError:
            return f"skipped: {why}"
    return "skipped: reseed running" if STATE["running"] or admin.RESEED_JOB.get("status") == "running" else None


async def served_hosts() -> list[str]:
    return [d["host"] async for d in db.served_hosts.find({}, {"_id": 0, "host": 1})]


def _run_id(started: datetime) -> str:
    return f"{JOB}-{int(started.timestamp() * 1000)}"


async def _start_row(trigger: str, as_of: str, started: datetime) -> None:
    """E11: the attempt is on record from its first second; a restart mid-run leaves a 'running' row to mark interrupted."""
    await db.job_runs.insert_one(
        {
            "id": _run_id(started),
            "job": JOB,
            "started_at": started.isoformat(),
            "finished_at": None,
            "status": "RUNNING",
            "outcome": "running",
            "trigger": trigger,
            "as_of": as_of,
            "items": 1,
            "failed_items": 0,
            "errors": [],
        }
    )


async def mark_interrupted() -> int:
    """On (leader) start no refresh is running in this process: any 'running' row is a run a restart killed."""
    if STATE["running"] or admin.RESEED_JOB.get("status") == "running":
        return 0  # the lease can be (re)acquired while this process is mid-run — that run is alive, not interrupted
    r = await db.job_runs.update_many(
        {"job": JOB, "outcome": "running"},
        {
            "$set": {
                "outcome": "interrupted: backend restarted mid-run",
                "status": "FAILED",
                "failed_items": 1,
                "finished_at": datetime.now(UTC).isoformat(),
                "errors": [{"item": "demo", "error": "interrupted"}],
            }
        },
    )
    return r.modified_count


async def _record(trigger: str, outcome: str, as_of: str, started: datetime, extra: dict | None = None) -> dict:
    """One job_runs row per attempt (job_runs survive the reseed wipe); replaces the attempt's 'running' row."""
    status = outcome.split(":")[0]
    doc = {
        "id": _run_id(started),
        "job": JOB,
        "started_at": started.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "status": "FAILED" if status == "failed" else "OK",
        "outcome": outcome,
        "trigger": trigger,
        "as_of": as_of,
        "items": 1,
        "failed_items": 1 if status == "failed" else 0,
        "errors": [{"item": "demo", "error": outcome}] if status == "failed" else [],
        **(extra or {}),
    }
    await db.job_runs.replace_one({"id": doc["id"]}, {**doc}, upsert=True)
    log.info("[demo-refresh] %s (%s, as-of %s)", outcome, trigger, as_of)
    return doc


async def _rebuild(as_of: str) -> tuple[str, dict]:
    """Backup first (REQ-54), then the existing reseed path; done only when chronology, integrity and tie-outs pass."""
    backup_job = __import__("importlib").import_module("tools.backup").backup_job  # tools/ pulls mongodump deps
    b = await backup_job()
    m = b.get("result") or {}
    if b.get("status") != "OK" or m.get("skipped"):
        return f"failed: backup {m.get('reason') or m.get('error') or b.get('status')}", {}
    extra = {"backup": m.get("archive") or m.get("file") or m.get("name")}
    try:
        admin._reseed_lock_acquire()
    except ApiError:
        return "skipped: reseed running", extra
    admin.RESEED_JOB.update({"status": "running", "as_of": as_of, "reason": None})
    try:
        await admin._reseed(admin.ReseedIn(confirm="RESEED", story=True, as_of=as_of), None, None)
    except BaseException:
        admin._reseed_lock_release()
        raise
    while admin.RESEED_JOB.get("status") == "running":
        await asyncio.sleep(5)
    if admin.RESEED_JOB.get("status") != "done":
        return f"failed: {admin.RESEED_JOB.get('reason') or 'story rebuild failed'}", extra
    gen = await asyncio.create_subprocess_exec(
        sys.executable, "tools/demo_journeys.py", cwd=BACKEND, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )  # REQ-59: demo_journeys.md + STORY block for the new as-of
    _, err = await gen.communicate()
    if gen.returncode != 0:
        return f"failed: demo_journeys {err.decode()[-200:]}", extra
    return "done", extra


async def run(trigger: str, hosts: list[str]) -> dict:
    started, as_of = datetime.now(UTC), clock.today_iso()
    reason = guard(hosts) or busy()
    if reason:
        return await _record(trigger, reason, as_of, started)
    STATE["running"] = True
    try:
        await _start_row(trigger, as_of, started)
        outcome, extra = await _rebuild(as_of)
        if trigger == "catch-up" and outcome == "done":
            outcome = "done (catch-up)"
    except Exception as e:  # the outcome is recorded, never lost
        log.exception("demo refresh failed")
        outcome, extra = f"failed: {type(e).__name__}: {e}"[:300], {}
    finally:
        STATE["running"] = False
    return await _record(trigger, outcome, as_of, started, extra)


async def catch_up_due(now: datetime | None = None) -> bool:
    """D2: after 03:00 business time, today's refresh is missing (no done run as of today, no scheduled/catch-up attempt
    today) → run it once (the pod was down at 03:00)."""
    now = (now or clock.now()).astimezone(clock.business_tz())
    if now.hour < 3:
        return False
    today = now.date().isoformat()
    if await db.job_runs.find_one({"job": JOB, "as_of": today, "outcome": {"$regex": "^done"}}, {"_id": 1}):
        return False
    tried = {"job": JOB, "as_of": today, "trigger": {"$in": ["schedule", "catch-up"]}}
    # E11: an interrupted attempt is not "done" — retry, but at most twice a day (a crash loop must not reseed forever)
    if await db.job_runs.count_documents({**tried, "outcome": {"$regex": "^interrupted"}}) >= 2:
        return False
    return not await db.job_runs.find_one({**tried, "outcome": {"$not": {"$regex": "^interrupted"}}}, {"_id": 1})


async def catch_up() -> dict | None:
    """Run a missed 03:00 refresh once (same guards and path as the nightly run)."""
    return await run("catch-up", await served_hosts()) if await catch_up_due() else None


async def nightly_loop():
    """03:00 IST every night (scheduler leader only); on leader start, catch up a missed 03:00 run once."""
    try:
        await mark_interrupted()
        await catch_up()
    except Exception:
        log.exception("demo refresh catch-up error")
    while True:
        now = datetime.now(clock.IST)
        nxt = now.replace(hour=3, minute=0, second=0, microsecond=0)
        if nxt <= now:
            nxt += timedelta(days=1)
        await asyncio.sleep((nxt - now).total_seconds())
        try:
            await run("schedule", await served_hosts())
        except Exception:
            log.exception("demo refresh loop error")


class RunIn(StrictModel):
    check_host: str | None = Field(
        default=None, max_length=200
    )  # evaluate the guard as if serving this host (can only disable)


@router.post("/demo-refresh/run")
async def run_now(body: RunIn, request: Request, user: dict = Depends(require("admin.demo_refresh.run"))):
    """Super Admin: run the nightly demo refresh now (same job as 03:00 IST). Disabled/skipped outcomes return at once."""
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    hosts = sorted(
        {*await served_hosts(), request_host(request), *([body.check_host.lower()] if body.check_host else [])}
    )
    reason = guard(hosts) or busy()
    await write_audit(user, "admin.demo_refresh.run", "system", "demo", after={"hosts": hosts, "blocked": reason})
    if reason:
        return await run("manual", hosts)
    asyncio.get_event_loop().create_task(run("manual", hosts))
    return {"outcome": "running", "trigger": "manual", "as_of": clock.today_iso()}


@router.get("/demo-refresh")
async def status(user: dict = Depends(require("admin.system_health.view"))):
    last_done = await db.job_runs.find_one(
        {"job": JOB, "outcome": {"$regex": "^done"}}, {"_id": 0}, sort=[("started_at", -1)]
    )
    history = await db.job_runs.find({"job": JOB}, {"_id": 0}).sort("started_at", -1).limit(10).to_list(10)
    hosts = await served_hosts()
    return {
        "enabled": guard(hosts) is None,
        "guard": guard(hosts),
        "running": STATE["running"] or admin.RESEED_JOB.get("status") == "running",
        "schedule": "03:00 IST nightly",
        "last_done": last_done,
        "last": history[0] if history else None,
        "history": history,
        "story_as_of": ((await db.settings.find_one({"key": "story"}, {"_id": 0, "value": 1})) or {}).get("value"),
    }
