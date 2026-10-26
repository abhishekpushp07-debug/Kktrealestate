"""Phase K.13: alert rules as code (backend/ops/alerts.yaml) evaluated against a snapshot built from the ring buffer, job_runs, settings and a DB ping."""
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import yaml

from db import db

log = logging.getLogger("alerts")
RULES_PATH = os.path.join(os.path.dirname(__file__), "..", "ops", "alerts.yaml")
LAST: dict = {"evaluated_at": None, "firing": []}


def load_rules() -> list[dict]:
    with open(RULES_PATH) as f:
        return yaml.safe_load(f)["rules"]


def evaluate(rules: list[dict], snap: dict) -> list[dict]:
    """Pure: returns firing rules for a snapshot (unit-testable with synthetic data)."""
    firing = []
    for r in rules:
        try:
            if eval(r["condition"], {"__builtins__": {"len": len, "abs": abs, "min": min, "max": max}}, {"snap": snap}):  # noqa: S307 — rules file is code we own
                firing.append({"id": r["id"], "severity": r["severity"], "message": r["message"], "source": r["source"]})
        except Exception as e:  # noqa: BLE001
            firing.append({"id": r["id"], "severity": "warning", "message": f"rule error: {e}", "source": r["source"]})
    return firing


async def build_snapshot() -> dict:
    from infra import START_TIME, ops_snapshot
    from services import job_runs, loadshed
    s = ops_snapshot(900)
    total = s["requests"] or 0
    n5 = sum(v for k, v in (s.get("errors_by_code") or {}).items() if str(k).startswith("5"))
    since = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    day = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    jh = await job_runs.health()
    failed = await db.job_runs.distinct("job", {"status": {"$in": ["FAILED", "ABANDONED"]}, "started_at": {"$gte": day}})
    integ = await db.settings.find_one({"key": "integrity_last_report"}, {"_id": 0, "value": 1})
    lb = await db.settings.find_one({"key": "last_backup"}, {"_id": 0, "value": 1})
    age_h = None
    if lb and lb.get("value", {}).get("created_at"):
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(lb["value"]["created_at"])).total_seconds() / 3600
    try:
        await db.command("ping")
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"uptime_s": time.time() - START_TIME, "requests": total, "rate_5xx": (n5 / total) if total else 0.0, "p95_ms": s.get("p95_ms"), "shed_total": loadshed.STATE["shed_total"],
            "login_failures_15m": await db.login_events.count_documents({"success": False, "created_at": {"$gte": since}}), "jobs_failed_24h": failed, "jobs_stale": jh["stale"],
            "integrity_findings": len((integ or {}).get("value", {}).get("findings", []) or []), "backup_age_h": age_h, "db_ok": db_ok}


async def evaluate_and_notify() -> list[dict]:
    firing = evaluate(load_rules(), await build_snapshot())
    LAST.update({"evaluated_at": datetime.now(timezone.utc).isoformat(), "firing": firing})
    if firing:
        today = datetime.now(timezone.utc).date().isoformat()
        marker = await db.settings.find_one({"key": "alerts_notified"}, {"_id": 0, "value": 1})
        sent = set((marker or {}).get("value", {}).get(today, []))
        new = [f for f in firing if f["id"] not in sent]
        if new:
            from routers.notifications import notify_roles
            for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None):
                await notify_roles(c["id"], ["Super Admin"], "Ops alert", "; ".join(f"[{f['severity']}] {f['message']}" for f in new), "ops.alert", "system", "alerts", link="/settings")
            await db.settings.update_one({"key": "alerts_notified"}, {"$set": {"value": {today: sorted(sent | {f['id'] for f in new})}}}, upsert=True)
    return firing


async def loop():
    import asyncio
    while True:
        try:
            await evaluate_and_notify()
        except Exception:  # noqa: BLE001
            log.exception("alert evaluation failed")
        await asyncio.sleep(60)
