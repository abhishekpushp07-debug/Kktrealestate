"""Canonical event bus + outbox (Phase G).

Every write calls `write_audit(...)` → `bus.publish("entity.changed", evt)`. The audit row *is* the outbox: it is inserted first,
then every registered subscriber runs; each one is recorded in `audit_logs.propagated` {name: iso|"ERR: ..."} and
`propagated_complete` is set. The reconciliation sweep replays rows that are incomplete (idempotent handlers)."""
from services import clock
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from core.money import money_snapshot as _money
from core.types import new_id, now_iso
from db import db
from event_registry import spec_for
from services.audit_diff import action_kind, changed_fields, mask, module_name, record_label

logger = logging.getLogger("kkt.events")


class EventBus:
    def __init__(self):
        self._subs: dict[str, list[tuple[str, Callable[[dict], Awaitable[None]]]]] = defaultdict(list)

    def subscribe(self, topic: str, name: str | None = None):
        def deco(handler):
            self._subs[topic].append((name or handler.__name__, handler))
            return handler
        return deco

    def handlers(self, topic: str):
        return self._subs.get(topic, []) + self._subs.get("*", [])

    async def publish(self, topic: str, payload: dict):
        evt = {"topic": topic, **payload}
        evt["spec"] = spec_for(evt.get("action"), evt.get("entity_type"))
        audit_id = None
        if topic == "entity.changed":
            audit_id = await _insert_audit(evt)
            evt["audit_id"] = audit_id
        propagated = await self._run(evt)
        if audit_id:
            await db.audit_logs.update_one({"id": audit_id}, {"$set": {"propagated": propagated, "propagated_complete": _complete(propagated)}})
        return audit_id

    async def _run(self, evt: dict) -> dict:
        out = {}
        for name, h in self.handlers(evt["topic"]):
            try:
                await h(evt)
                out[name] = now_iso()
            except Exception as e:  # noqa: BLE001
                logger.exception("event handler %s failed for %s", name, evt.get("action"))
                out[name] = f"ERR: {type(e).__name__}: {e}"[:200]
        return out

    async def replay(self, audit_doc: dict) -> dict:
        """Re-run all subscribers for an outbox row (idempotent). Used by the reconciliation sweep and tests."""
        evt = {"topic": "entity.changed", "actor": {"id": audit_doc.get("actor_id"), "name": audit_doc.get("actor_name"), "company_id": audit_doc.get("company_id")},
               "action": audit_doc["action"], "entity_type": audit_doc["entity_type"], "entity_id": audit_doc["entity_id"], "before": audit_doc.get("before"), "after": audit_doc.get("after"),
               "company_id": audit_doc.get("company_id"), "audit_id": audit_doc["id"], "replay": True}
        evt["spec"] = spec_for(evt["action"], evt["entity_type"])
        propagated = await self._run(evt)
        await db.audit_logs.update_one({"id": audit_doc["id"]}, {"$set": {"propagated": propagated, "propagated_complete": _complete(propagated), "replayed_at": now_iso()}})
        return propagated


def _complete(propagated: dict) -> bool:
    return all(not str(v).startswith("ERR") for v in propagated.values())


bus = EventBus()


async def _insert_audit(evt: dict) -> str:
    actor = evt.get("actor")
    before, after = mask(evt.get("before")), mask(evt.get("after"))
    doc = {"id": new_id(), "company_id": evt.get("company_id"), "actor_id": actor["id"] if actor else "system", "actor_name": (actor.get("name") or "System") if actor else "System",
           "user_id": actor["id"] if actor else None, "user_name": (actor.get("name") or "System") if actor else "System", "actor_type": "user" if actor and actor.get("id") else "system",
           "action": evt["action"], "action_kind": action_kind(evt["action"]), "module_name": module_name(evt["entity_type"]), "entity_type": evt["entity_type"], "entity_id": evt["entity_id"],
           "record_label": record_label(before, after), "before": before, "after": after, "changed_fields": changed_fields(before, after),
           "ip": evt.get("ip", ""), "user_agent": evt.get("user_agent"), "request_id": evt.get("request_id"), **({"as_of": evt["as_of"]} if evt.get("as_of") else {}),
           "created_at": now_iso(), "event": evt["spec"]["event"], "surfaces": evt["spec"]["surfaces"], "propagated": {}, "propagated_complete": False}
    await db.audit_logs.insert_one(doc)
    return doc["id"]


@bus.subscribe("entity.changed", "roles_version")
async def roles_version_bump(evt: dict):
    if evt["entity_type"] in ("role", "user"):
        await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
        from services import rbac
        rbac.invalidate()


MONEY_ENTITIES = {"payment", "booking", "demand", "refund", "flat", "block"}


async def surface_snapshot(company_id: str, booking_id: str | None, flat_id: str | None, project_id: str | None, day: str) -> dict:
    """Values of every money/status surface a booking-context entry can move. Cheap raw aggregates (never read models, which lag)."""
    from datetime import date as _d
    snap = {}
    if booking_id:
        b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "summary": 1, "status": 1, "customer_id": 1, "flat_id": 1, "block_id": 1, "project_id": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "agreement_value_paise": 1, "flat_snapshot.flat_number": 1})
        if b:
            sm = b.get("summary") or {}
            snap["bookings"] = {"status": b["status"], "unit": (b.get("flat_snapshot") or {}).get("flat_number"), "agreement_paise": b.get("agreement_value_paise"), "cash_raised_paise": sm.get("cash_order_raised_paise"), "cash_paid_paise": sm.get("cash_paid_paise"), "account_raised_paise": sm.get("account_order_raised_paise"), "account_paid_paise": sm.get("account_paid_paise"),
                                "other_demanded_paise": sm.get("other_charges_demanded_paise"), "other_paid_paise": sm.get("other_charges_paid_paise"), "outstanding_paise": sm.get("outstanding_paise"), "advance_paise": sm.get("advance_paise"), "pending_cheques_paise": sm.get("pending_cheques_paise")}
            snap["ledgers"] = {"rows": await db.ledger_entries.count_documents({"booking_id": booking_id}), "last_due_paise": ((await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0, "total_due_paise": 1}).sort("seq", -1).limit(1).to_list(1)) or [{}])[0].get("total_due_paise")}
            dem = await db.demands.aggregate([{"$match": {"booking_id": booking_id, "voided": {"$ne": True}}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "bal": {"$sum": {"$subtract": ["$total_demand_paise", {"$ifNull": ["$paid_paise", 0]}]}}}}]).to_list(None)
            snap["demands"] = {f"{d['_id']}_count": d["n"] for d in dem} | {"open_balance_paise": sum(d["bal"] for d in dem if d["_id"] in ("Open", "Partially Paid"))}
            cm = await _money({"customer_id": b["customer_id"]})
            snap["customer360"] = {"paid_paise": cm["paid_paise"], "outstanding_paise": cm["outstanding"]["total_paise"], "overdue_paise": cm["overdue"]["amount_paise"], "advance_paise": cm["advance_paise"]}
            flat_id, project_id = flat_id or b["flat_id"], project_id or b["project_id"]
            bl = await db.flats.aggregate([{"$match": {"block_id": b["block_id"]}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
            snap["blocks"] = {x["_id"]: x["n"] for x in bl}
            snap["refunds"] = {"pending_paise": sum(r["amount_paise"] for r in await db.refunds.find({"booking_id": booking_id, "status": "Pending"}, {"_id": 0, "amount_paise": 1}).to_list(20)), "paid_paise": sum(r["amount_paise"] for r in await db.refunds.find({"booking_id": booking_id, "status": "Paid"}, {"_id": 0, "amount_paise": 1}).to_list(20))}
    if flat_id:
        f = await db.flats.find_one({"id": flat_id}, {"_id": 0, "status": 1, "flat_number": 1})
        if f:
            snap["inventory"] = {"unit": f["flat_number"], "status": f["status"]}
    if project_id:
        pm = await _money({"project_id": project_id})
        snap["projects"] = {"collected_paise": pm["collections_total_paise"], "outstanding_paise": pm["outstanding"]["total_paise"], "overdue_paise": pm["overdue"]["amount_paise"], "advance_paise": pm["advance_paise"]}
    hm = await _money({"company_id": company_id})
    snap["home"] = {"outstanding_paise": hm["outstanding"]["total_paise"], "collections_mtd_paise": hm["collections_mtd_paise"], "advance_paise": hm["advance_paise"], "pending_cheques_paise": hm["pending_cheques_paise"]}
    rz = await db.payments.aggregate([{"$match": {"company_id": company_id, "payment_date": day, "status": {"$in": ["Cleared", "Pending"]}}}, {"$group": {"_id": "$status", "s": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(None)
    snap["roznamcha"] = {"date": day} | {f"{r['_id'].lower()}_paise": r["s"] for r in rz} | {"receipts": sum(r["n"] for r in rz)}
    snap["notifications"] = {"total": await db.notifications.count_documents({"company_id": company_id, "withdrawn": {"$ne": True}})}
    _ = _d
    return snap


@bus.subscribe("entity.changed", "surface_snapshot")
async def snapshot_subscriber(evt: dict):
    if evt.get("entity_type") not in MONEY_ENTITIES or evt.get("replay") or not evt.get("audit_id"):
        return
    et, eid = evt["entity_type"], evt["entity_id"]
    ctx = {"booking_id": None, "flat_id": None, "project_id": None}
    if et == "booking":
        ctx["booking_id"] = eid
    elif et in ("payment", "demand", "refund"):
        d = await getattr(db, et + "s").find_one({"id": eid}, {"_id": 0, "booking_id": 1})
        ctx["booking_id"] = (d or {}).get("booking_id")
    elif et == "flat":
        f = await db.flats.find_one({"id": eid}, {"_id": 0, "project_id": 1, "booking_id": 1})
        ctx.update({"flat_id": eid, "project_id": (f or {}).get("project_id"), "booking_id": (f or {}).get("booking_id")})
    elif et == "block":
        bl = await db.blocks.find_one({"id": eid}, {"_id": 0, "project_id": 1})
        ctx["project_id"] = (bl or {}).get("project_id")
    after = evt.get("after") or {}
    day = (after.get("payment_date") or after.get("paid_date") or evt.get("created_at") or "")[:10] or clock.today().isoformat()
    snap = await surface_snapshot(evt["company_id"], ctx["booking_id"], ctx["flat_id"], ctx["project_id"], day)
    # "before" = the most recent snapshot in the same context (booking, else flat/project), captured when the previous entry completed
    prev_q = {"company_id": evt["company_id"], "snapshot": {"$exists": True}, "id": {"$ne": evt["audit_id"]}}
    if ctx["booking_id"]:
        prev_q["snapshot_ctx.booking_id"] = ctx["booking_id"]
    elif ctx["flat_id"]:
        prev_q["snapshot_ctx.flat_id"] = ctx["flat_id"]
    else:
        prev_q["snapshot_ctx.project_id"] = ctx["project_id"]
    prev = await db.audit_logs.find(prev_q, {"_id": 0, "snapshot": 1}).sort("created_at", -1).limit(1).to_list(1)
    await db.audit_logs.update_one({"id": evt["audit_id"]}, {"$set": {"snapshot": snap, "snapshot_ctx": ctx, "snapshot_before": (prev[0]["snapshot"] if prev else None)}})


async def reconcile_outbox(max_age_s: int = 60, limit: int = 200) -> dict:
    """Replay incomplete outbox rows older than max_age_s. Returns health counters (also exposed in /api/admin/ops)."""
    from datetime import timedelta

    cutoff = (clock.now() - timedelta(seconds=max_age_s)).isoformat()
    rows = await db.audit_logs.find({"propagated_complete": False, "created_at": {"$lt": cutoff}}, {"_id": 0}).sort("created_at", 1).limit(limit).to_list(None)
    for r in rows:
        await bus.replay(r)
    await db.settings.update_one({"key": "outbox_last_sweep"}, {"$set": {"value": now_iso()}}, upsert=True)
    return {**await outbox_health(), "replayed": len(rows)}


async def outbox_health() -> dict:
    from datetime import datetime

    unprop = await db.audit_logs.count_documents({"propagated_complete": False})
    oldest = await db.audit_logs.find({"propagated_complete": False}, {"_id": 0, "created_at": 1}).sort("created_at", 1).limit(1).to_list(1)
    lag = 0
    if oldest:
        lag = round((clock.now() - datetime.fromisoformat(oldest[0]["created_at"].replace("Z", "+00:00"))).total_seconds())
    last = await db.settings.find_one({"key": "outbox_last_sweep"}, {"_id": 0, "value": 1})
    return {"unpropagated": unprop, "lag_s": lag, "last_sweep": (last or {}).get("value"), "checked_at": now_iso()}
