"""3I: background jobs at 1,500 bookings with the 50 % duty cap (KKT_JOB_DUTY) — measured duration vs window — and
proof that a job runs on one server only (2 worker processes on the same database, the scheduler lease decides).

Usage: python tools/job_windows_3i.py --source kkt_volume --out memory/qa/phase3i/job_windows.md
Works on a scratch copy (kkt_jobs_scratch), dropped at the end. Never touches the source."""

import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRATCH = "kkt_jobs_scratch"

# job → (window the owner allows, seconds; what the window is)
WINDOWS = {
    "OVERDUE_REMINDERS": (8 * 3600, "send window 10:00–18:00 IST; hourly loop"),
    "DAILY_DUES": (600, "nightly budget (BUDGET_S)"),
    "NIGHTLY_INTEGRITY": (600, "nightly budget (BUDGET_S)"),
    "AUDIT_ARCHIVE": (3600, "nightly slot, before the next job hour"),
    "OVERDUE_NOTIFICATIONS": (3600, "daily loop"),
    "HOLD_EXPIRY_SWEEP": (900, "every 15 min"),
    "MESSAGE_SEND": (60, "every minute"),
    "SNAPSHOTS": (60, "read-model sweep every minute"),
}


def copy(src: str):
    url = os.environ["MONGO_URL"]
    subprocess.run(["mongosh", url, "--quiet", "--eval", f'db.getSiblingDB("{SCRATCH}").dropDatabase()'], check=True)
    dump = subprocess.Popen(["mongodump", "--uri", url, "--db", src, "--archive", "--quiet"], stdout=subprocess.PIPE)
    subprocess.run(
        ["mongorestore", "--uri", url, "--archive", "--quiet", f"--nsFrom={src}.*", f"--nsTo={SCRATCH}.*"],
        stdin=dump.stdout,
        check=True,
    )
    dump.wait()


JOBS = r"""
import asyncio, json, os, sys, time, logging
sys.path.insert(0, ".")
logging.disable(logging.CRITICAL)
async def main():
    from db import db
    from services.dues_engine import run_dues_for_all
    from services.integrity import integrity_report
    from services.audit_archive import archive_old_rows
    from routers.notifications import overdue_demand_job
    from services.messaging.reminders import run_overdue_reminders
    from services.messaging.outbox import run_message_send
    from services import inventory as inv
    from services import read_models as rm
    out = {}
    async def t(name, coro):
        a = time.perf_counter()
        try:
            r = await coro
            ok = True
        except Exception as e:  # noqa: BLE001
            r, ok = f"{type(e).__name__}: {e}"[:200], False
        out[name] = {"s": round(time.perf_counter() - a, 1), "ok": ok}
        print(name, out[name], flush=True)
    await t("OVERDUE_REMINDERS", run_overdue_reminders(force_window=True))
    await t("DAILY_DUES", run_dues_for_all())
    await t("NIGHTLY_INTEGRITY", integrity_report())
    await t("AUDIT_ARCHIVE", archive_old_rows())
    await t("OVERDUE_NOTIFICATIONS", overdue_demand_job())
    await t("HOLD_EXPIRY_SWEEP", inv.expire_holds())
    await t("MESSAGE_SEND", run_message_send())
    await t("SNAPSHOTS", rm.refresh_dashboards())
    n = await db.bookings.count_documents({})
    print("RESULT", json.dumps({"bookings": n, "jobs": out}), flush=True)
asyncio.run(main())
"""


def run_jobs(env: dict) -> dict:
    p = subprocess.run(
        ["taskset", "-c", "0", sys.executable, "-c", JOBS],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env,
        capture_output=True,
        text=True,
        timeout=6 * 3600,
    )
    line = [x for x in p.stdout.splitlines() if x.startswith("RESULT ")]
    if not line:
        raise SystemExit(f"jobs failed: {p.stderr[-2000:]}")
    return json.loads(line[0][7:])


def two_servers(env: dict, minutes: float) -> dict:
    """2 workers on the scratch DB for `minutes`: every job run must name one owner, and no two runs of a job overlap."""
    from pymongo import MongoClient

    db = MongoClient(os.environ["MONGO_URL"])[SCRATCH]
    since = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    port = "8041"
    srv = subprocess.Popen(
        ["taskset", "-c", "0,1", sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", port]
        + ["--workers", "2", "--log-level", "warning"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(minutes * 60)
    finally:
        srv.kill()
        subprocess.run(["pkill", "-f", f"--port {port}"])
    by: dict = {}
    for r in db.job_runs.find({"started_at": {"$gte": since}}, {"_id": 0}).sort("started_at", 1):
        by.setdefault(r["job"], []).append(r)
    rep = {}
    for job, rs in by.items():
        owners = sorted({r.get("owner") or "?" for r in rs})
        overlap = sum(
            1
            for a, b in zip(rs, rs[1:])
            if b["started_at"] < (a.get("finished_at") or "9999") and a["status"] != "ABANDONED"
        )
        rep[job] = {"runs": len(rs), "owners": owners, "overlapping": overlap}
    lock = db.locks.find_one({"name": "scheduler"}, {"_id": 0, "owner": 1})
    return {"jobs": rep, "lease_owner": (lock or {}).get("owner")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="kkt_volume")
    ap.add_argument("--out", default="memory/qa/phase3i/job_windows.md")
    ap.add_argument("--minutes", type=float, default=6)
    a = ap.parse_args()
    copy(a.source)
    env = {**os.environ, "DB_NAME": SCRATCH, "KKT_ROLE": "test", "BACKUP_ENABLED": "0", "DEMO_AUTO_REFRESH": "false"}
    res = run_jobs(env | {"KKT_NO_SCHEDULER": "1"})
    two = two_servers(env, a.minutes)
    url = os.environ["MONGO_URL"]
    subprocess.run(["mongosh", url, "--quiet", "--eval", f'db.getSiblingDB("{SCRATCH}").dropDatabase()'])
    duty = os.environ.get("KKT_JOB_DUTY", "0.5")
    lines = [
        f"# 3I — background jobs at {res['bookings']:,} bookings · duty cap {duty} · one core (taskset 0)",
        "",
        "| Job | Measured | Window | Inside? |",
        "|---|---|---|---|",
    ]
    for job, (win, what) in WINDOWS.items():
        m = res["jobs"].get(job, {})
        inside = "yes" if m.get("ok") and m.get("s", 1e9) <= win else "**no**"
        lines.append(f"| {job} | {m.get('s')} s{'' if m.get('ok') else ' (error)'} | {win:,} s — {what} | {inside} |")
    lines += [
        "",
        f"## Two servers ({a.minutes} min, 2 workers on one database) — scheduler lease owner: `{two['lease_owner']}`",
        "",
        "| Job | Runs | Owner processes | Overlapping runs |",
        "|---|---|---|---|",
    ]
    for job, r in sorted(two["jobs"].items()):
        lines.append(f"| {job} | {r['runs']} | {', '.join(r['owners'])} | {r['overlapping']} |")
    open(a.out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
