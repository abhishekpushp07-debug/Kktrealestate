"""Phase K.13: alert rules as code (backend/ops/alerts.yaml) evaluated against a snapshot built from the ring buffer, job_runs, settings and a DB ping."""
import logging
import os
import time
from datetime import UTC, datetime, timedelta

import yaml

from core.rule_eval import RuleSyntaxError, compile_rule
from db import db

log = logging.getLogger("alerts")
RULES_PATH = os.path.join(os.path.dirname(__file__), "..", "ops", "alerts.yaml")
LAST: dict = {"evaluated_at": None, "firing": []}


def load_rules() -> list[dict]:
    """Rules are validated against the whitelist grammar at load; a bad rule fails loudly here, never at evaluation."""
    with open(RULES_PATH) as f:
        rules = yaml.safe_load(f)["rules"]
    for r in rules:
        compile_rule(r["condition"])
    return rules


def evaluate(rules: list[dict], snap: dict) -> list[dict]:
    """Pure: returns firing rules for a snapshot (unit-testable with synthetic data)."""
    firing = []
    for r in rules:
        try:
            if compile_rule(r["condition"])(snap):
                firing.append({"id": r["id"], "severity": r["severity"], "message": r["message"], "source": r["source"]})
        except (RuleSyntaxError, KeyError, TypeError, AttributeError, ValueError) as e:
            firing.append({"id": r["id"], "severity": "warning", "message": f"rule error: {e}", "source": r["source"]})
    return firing


async def build_snapshot() -> dict:
    from infra import START_TIME, ops_snapshot
    from services import job_runs, loadshed
    s = ops_snapshot(900)
    total = s["requests"] or 0
    n5 = sum(v for k, v in (s.get("errors_by_code") or {}).items() if str(k).startswith("5"))
    since = (datetime.now(UTC) - timedelta(minutes=15)).isoformat()
    day = (datetime.now(UTC) - timedelta(hours=24)).isoformat()
    jh = await job_runs.health()
    failed = []  # self-clearing: a FAILED/ABANDONED run only fires until the next OK run of that job
    for j in await db.job_runs.distinct("job", {"status": {"$in": ["FAILED", "ABANDONED"]}, "started_at": {"$gte": day}}):
        bad = await db.job_runs.find_one({"job": j, "status": {"$in": ["FAILED", "ABANDONED"]}}, {"_id": 0, "finished_at": 1, "started_at": 1}, sort=[("started_at", -1)])
        ok = await db.job_runs.find_one({"job": j, "status": "OK", "started_at": {"$gt": bad["started_at"]}}, {"_id": 0, "id": 1})
        if not ok:
            failed.append(j)
    integ = await db.settings.find_one({"key": "integrity_last_report"}, {"_id": 0, "value": 1})
    lb = await db.settings.find_one({"key": "last_backup"}, {"_id": 0, "value": 1})
    age_h = None
    if lb and lb.get("value", {}).get("created_at"):
        age_h = (datetime.now(UTC) - datetime.fromisoformat(lb["value"]["created_at"])).total_seconds() / 3600
    try:
        await db.command("ping")
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"uptime_s": time.time() - START_TIME, "requests": total, "rate_5xx": (n5 / total) if total else 0.0, "p95_ms": s.get("p95_ms"), "shed_total": loadshed.STATE["shed_total"],
            "login_failures_15m": await db.login_events.count_documents({"success": False, "created_at": {"$gte": since}}), "jobs_failed_24h": failed, "jobs_stale": jh["stale"],
            "integrity_findings": len((integ or {}).get("value", {}).get("findings", []) or []), "backup_age_h": age_h, "db_ok": db_ok}


def fingerprint(rule: dict, snap: dict) -> str:
    """Values the rule looked at — an acknowledgement is valid while these are unchanged (re-fires when e.g. another job fails)."""
    import json
    import re
    keys = sorted(set(re.findall(r"snap\['(\w+)'\]", rule.get("condition", ""))))
    return json.dumps({k: snap.get(k) for k in keys}, sort_keys=True, default=str)


async def acknowledge(alert_id: str, user: dict, note: str | None) -> dict:
    rules = {r["id"]: r for r in load_rules()}
    if alert_id not in rules:
        raise ValueError(alert_id)
    snap = await build_snapshot()
    ack = {"at": datetime.now(UTC).isoformat(), "by": user["id"], "by_name": user.get("full_name") or user.get("email"), "note": note, "fingerprint": fingerprint(rules[alert_id], snap)}
    await db.settings.update_one({"key": "alerts_acked"}, {"$set": {f"value.{alert_id}": ack}}, upsert=True)
    LAST["firing"] = [f for f in LAST["firing"] if f["id"] != alert_id]
    return ack


async def evaluate_and_notify() -> list[dict]:
    rules = load_rules()
    snap = await build_snapshot()
    firing = evaluate(rules, snap)
    acked = ((await db.settings.find_one({"key": "alerts_acked"}, {"_id": 0, "value": 1})) or {}).get("value") or {}
    by_id = {r["id"]: r for r in rules}
    firing = [f for f in firing if not (f["id"] in acked and acked[f["id"]].get("fingerprint") == fingerprint(by_id[f["id"]], snap))]
    LAST.update({"evaluated_at": datetime.now(UTC).isoformat(), "firing": firing})
    if firing:
        today = datetime.now(UTC).date().isoformat()
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
        except Exception:
            log.exception("alert evaluation failed")
        await asyncio.sleep(60)
