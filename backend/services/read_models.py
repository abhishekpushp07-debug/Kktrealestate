"""Derived read models (recomputable, never a source of truth):
   project_summaries, block_summaries, customer_summaries, dashboard_snapshots.
   Maintained by the event bus (debounced ≤2 s) + a 60 s sweep; `recompute_all()` rebuilds everything."""
import asyncio
import hashlib
import logging
from datetime import UTC, date, datetime, timedelta

from db import db
from events import bus
from utils import now_iso

log = logging.getLogger("kkt.readmodels")
_dirty = {"projects": set(), "blocks": set(), "customers": set(), "all": False, "task": None}
DEBOUNCE_S = 2.0


def mark_dirty(project_id=None, block_id=None, customer_id=None, all_=False):
    if project_id:
        _dirty["projects"].add(project_id)
    if block_id:
        _dirty["blocks"].add(block_id)
    if customer_id:
        _dirty["customers"].add(customer_id)
    if all_:
        _dirty["all"] = True
    if _dirty["task"] is None or _dirty["task"].done():
        try:
            _dirty["task"] = asyncio.get_running_loop().create_task(_flush_later())
        except RuntimeError:
            pass


async def _flush_later():
    await asyncio.sleep(DEBOUNCE_S)
    await flush()


async def flush():
    try:
        if _dirty["all"]:
            _dirty.update({"all": False, "projects": set(), "blocks": set(), "customers": set()})
            await recompute_all()
            return
        ps, bs, cs = _dirty["projects"], _dirty["blocks"], _dirty["customers"]
        _dirty.update({"projects": set(), "blocks": set(), "customers": set()})
        for bid in bs:
            await refresh_block(bid)
        for pid in ps | {b["project_id"] for b in await db.blocks.find({"id": {"$in": list(bs)}}, {"_id": 0, "project_id": 1}).to_list(None)}:
            await refresh_project(pid)
        for cid in cs:
            await refresh_customer(cid)
        if ps or bs or cs:
            await refresh_dashboards()
    except Exception:
        log.exception("read model refresh failed")


ENTITY_LOOKUP = {"payment": (db.payments, ("project_id", "block_id", "customer_id")), "booking": (db.bookings, ("project_id", "block_id", "customer_id")), "demand": (db.demands, ("project_id", "block_id", "customer_id")),
                 "flat": (db.flats, ("project_id", "block_id", None)), "block": (db.blocks, ("project_id", "id", None)), "project": (db.projects, ("id", None, None)), "customer": (db.customers, (None, None, "id")),
                 "lead": (db.leads, ("project_id", None, "converted_customer_id")), "site_visit": (db.site_visits, ("project_id", None, "customer_id")), "service_request": (db.service_requests, ("project_id", "block_id", "customer_id")),
                 "communication": (db.communications, (None, None, "customer_id"))}


@bus.subscribe("entity.changed")
async def _on_change(evt: dict):
    spec = ENTITY_LOOKUP.get(evt.get("entity_type"))
    if not spec:
        return
    coll, (pf, bf, cf) = spec
    doc = await coll.find_one({"id": evt["entity_id"]}, {"_id": 0, "project_id": 1, "block_id": 1, "customer_id": 1, "id": 1, "converted_customer_id": 1})
    if not doc:
        return
    mark_dirty(project_id=doc.get(pf) if pf else None, block_id=doc.get(bf) if bf else None, customer_id=doc.get(cf) if cf else None)


# ---------- computations ----------
async def _money(match: dict) -> dict:
    today = date.today().isoformat()
    month = today[:7]
    agg = await db.bookings.aggregate([{"$match": {**match, "status": {"$in": ["Active", "Completed"]}}}, {"$group": {"_id": None, "n": {"$sum": 1}, "agreed": {"$sum": "$agreement_value_paise"}, "paid": {"$sum": "$summary.paid_paise"},
                                                                                                             "cash_due": {"$sum": {"$max": ["$summary.cash_due_paise", 0]}}, "acc_due": {"$sum": {"$max": ["$summary.account_due_paise", 0]}}, "oc_due": {"$sum": {"$max": ["$summary.other_charges_due_paise", 0]}},
                                                                                                             "oc_paid": {"$sum": "$summary.other_charges_paid_paise"}, "pending": {"$sum": "$summary.pending_cheques_paise"}}}]).to_list(1)
    a = agg[0] if agg else {}
    col = await db.payments.aggregate([{"$match": {**match, "status": "Cleared"}}, {"$group": {"_id": None, "total": {"$sum": "$amount_paise"}, "mtd": {"$sum": {"$cond": [{"$eq": [{"$substr": ["$payment_date", 0, 7]}, month]}, "$amount_paise", 0]}}}}]).to_list(1)
    c = col[0] if col else {}
    od = await db.demands.aggregate([{"$match": {**match, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}}}, {"$group": {"_id": None, "n": {"$sum": 1}, "amt": {"$sum": {"$subtract": ["$total_demand_paise", {"$ifNull": ["$paid_paise", 0]}]}}}}]).to_list(1)
    o = od[0] if od else {}
    return {"bookings": a.get("n", 0), "agreement_paise": a.get("agreed", 0), "paid_paise": a.get("paid", 0) + a.get("oc_paid", 0), "collections_total_paise": c.get("total", 0), "collections_mtd_paise": c.get("mtd", 0),
            "outstanding": {"cash_paise": a.get("cash_due", 0), "account_paise": a.get("acc_due", 0), "other_charges_paise": a.get("oc_due", 0), "total_paise": a.get("cash_due", 0) + a.get("acc_due", 0) + a.get("oc_due", 0)},
            "overdue": {"count": o.get("n", 0), "amount_paise": o.get("amt", 0)}, "pending_cheques_paise": a.get("pending", 0)}


async def _units(match: dict) -> dict:
    rows = await db.flats.aggregate([{"$match": {**match, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "value": {"$sum": {"$ifNull": ["$price", 0]}}}}]).to_list(None)
    by = {r["_id"]: r["n"] for r in rows}
    return {"by_status": by, "total": sum(by.values()), "inventory_value": sum(r["value"] for r in rows), "sold_value": sum(r["value"] for r in rows if r["_id"] in ("Booked", "Sold")),
            "available": by.get("Available", 0), "sold_pct": round(100 * sum(by.get(s, 0) for s in ("Booked", "Sold")) / max(sum(by.values()), 1), 1)}


async def refresh_block(block_id: str) -> dict | None:
    b = await db.blocks.find_one({"id": block_id}, {"_id": 0, "id": 1, "project_id": 1, "company_id": 1, "name": 1, "code": 1, "construction_percent": 1, "construction_stages": 1, "status": 1})
    if not b:
        await db.block_summaries.delete_one({"block_id": block_id})
        return None
    stages = b.get("construction_stages") or []
    done = [s for s in stages if s.get("status") == "Completed"]
    nxt = next((s for s in stages if s.get("status") != "Completed"), None)
    doc = {"block_id": block_id, "project_id": b["project_id"], "company_id": b["company_id"], "name": b["name"], "code": b["code"], "status": b.get("status"), "units": await _units({"block_id": block_id}), **await _money({"block_id": block_id}),
           "progress": {"percent": b.get("construction_percent", 0), "completed": len(done), "total": len(stages), "current_stage": done[-1]["name"] if done else None, "upcoming_stage": nxt["name"] if nxt else None}, "computed_at": now_iso(), "derived": True}
    await db.block_summaries.update_one({"block_id": block_id}, {"$set": doc}, upsert=True)
    return doc


async def refresh_project(project_id: str) -> dict | None:
    p = await db.projects.find_one({"id": project_id}, {"_id": 0, "id": 1, "company_id": 1, "name": 1, "code": 1, "status": 1, "address": 1, "cover_image_url": 1})
    if not p:
        await db.project_summaries.delete_one({"project_id": project_id})
        return None
    blocks = await db.block_summaries.find({"project_id": project_id}, {"_id": 0, "block_id": 1, "name": 1, "progress": 1, "units": 1}).to_list(None)
    today = date.today().isoformat()
    doc = {"project_id": project_id, "company_id": p["company_id"], "name": p["name"], "code": p["code"], "status": p.get("status"), "city": (p.get("address") or {}).get("city"), "cover_image_url": p.get("cover_image_url"), "units": await _units({"project_id": project_id}), **await _money({"project_id": project_id}),
           "progress_pct": round(sum(b["progress"]["percent"] for b in blocks) / len(blocks), 1) if blocks else 0, "towers": len(blocks),
           "leads_open": await db.leads.count_documents({"project_id": project_id, "status": {"$nin": ["Lost", "Converted"]}}), "visits_upcoming": await db.site_visits.count_documents({"project_id": project_id, "date": {"$gte": today}, "status": {"$in": ["Confirmed", "Rescheduled"]}}),
           "blocks": [{"block_id": b["block_id"], "name": b["name"], "progress": b["progress"], "units": {"total": b["units"]["total"], "available": b["units"]["available"]}} for b in blocks], "computed_at": now_iso(), "derived": True}
    await db.project_summaries.update_one({"project_id": project_id}, {"$set": doc}, upsert=True)
    return doc


def engagement_score(last_contact: str | None, visits: int, brochures: int, replies: int, on_time_ratio: float | None, now: datetime) -> int:
    """0–100: recency 30 · visits 20 · brochures 10 · replies 10 · payment punctuality 30 (documented in PRD)."""
    rec = 0
    if last_contact:
        days = (now - datetime.fromisoformat(last_contact.replace("Z", "+00:00"))).days
        rec = 30 if days <= 7 else 22 if days <= 30 else 12 if days <= 90 else 4
    pay = 15 if on_time_ratio is None else round(30 * on_time_ratio)
    return min(100, rec + min(20, visits * 10) + min(10, brochures * 5) + min(10, replies * 2) + pay)


async def refresh_customer(customer_id: str) -> dict | None:
    c = await db.customers.find_one({"id": customer_id}, {"_id": 0, "id": 1, "company_id": 1, "full_name": 1, "customer_code": 1, "phone": 1, "last_contacted_at": 1, "lifecycle_stage": 1})
    if not c:
        await db.customer_summaries.delete_one({"customer_id": customer_id})
        return None
    now = datetime.now(UTC)
    bookings = await db.bookings.find({"customer_id": customer_id}, {"_id": 0, "id": 1, "status": 1, "agreement_value_paise": 1, "summary": 1}).to_list(None)
    bids = [b["id"] for b in bookings]
    money = await _money({"customer_id": customer_id})
    dem = await db.demands.find({"booking_id": {"$in": bids}, "voided": {"$ne": True}, "status": "Paid"}, {"_id": 0, "due_date": 1, "id": 1}).to_list(None)
    on_time = None
    if dem:
        last_pay = {}
        for p in await db.payments.find({"booking_id": {"$in": bids}, "status": "Cleared"}, {"_id": 0, "payment_date": 1, "booking_id": 1}).to_list(None):
            last_pay[p["booking_id"]] = max(last_pay.get(p["booking_id"], ""), p["payment_date"])
        on_time = sum(1 for d in dem if d["due_date"] >= min(last_pay.values(), default=d["due_date"])) / len(dem)
    leads = await db.leads.find({"$or": [{"converted_customer_id": customer_id}, {"phone": c.get("phone")}]}, {"_id": 0, "id": 1, "status": 1}).to_list(10)
    lids = [l["id"] for l in leads]
    visits = await db.site_visits.count_documents({"$or": [{"customer_id": customer_id}, {"lead_id": {"$in": lids}}], "status": {"$in": ["Completed", "Confirmed", "Rescheduled"]}})
    brochures = await db.brochure_downloads.count_documents({"lead_id": {"$in": lids}}) if lids else 0
    replies = await db.service_requests.count_documents({"customer_id": customer_id, "thread.by": "customer"})
    last_comm = await db.communications.find_one({"customer_id": customer_id}, {"_id": 0, "happened_at": 1}, sort=[("happened_at", -1)])
    last_contact = max(filter(None, [c.get("last_contacted_at"), (last_comm or {}).get("happened_at")]), default=None)
    statuses = {b["status"] for b in bookings}
    stage = "Owner" if "Completed" in statuses else "Customer" if "Active" in statuses else "Prospect" if (visits or any(l["status"] not in ("New",) for l in leads)) else "Lead"
    score = engagement_score(last_contact, visits, brochures, replies, on_time, now)
    last_payment = max((b.get("summary") or {}).get("last_payment_at") or "" for b in bookings) or None if bookings else None
    doc = {"customer_id": customer_id, "company_id": c["company_id"], "full_name": c["full_name"], "customer_code": c["customer_code"], **money, "due_paise": money["outstanding"]["total_paise"], "overdue_paise": money["overdue"]["amount_paise"],
           "last_payment_at": last_payment, "engagement_score": score, "lifecycle_stage": stage, "visits": visits, "brochure_downloads": brochures, "last_contacted_at": last_contact, "computed_at": now_iso(), "derived": True}
    await db.customer_summaries.update_one({"customer_id": customer_id}, {"$set": doc}, upsert=True)
    await db.customers.update_one({"id": customer_id}, {"$set": {"engagement_score": score, "lifecycle_stage": stage}})
    return doc


def scope_hash(scope: list[str] | None) -> str:
    return "*" if not scope or "*" in scope else hashlib.md5(",".join(sorted(scope)).encode()).hexdigest()[:12]


async def refresh_dashboards():
    """One snapshot per (company, project scope) that has been requested recently."""
    for snap in await db.dashboard_snapshots.find({}, {"_id": 0, "company_id": 1, "scope_hash": 1, "scope": 1}).to_list(None):
        await compute_dashboard(snap["company_id"], snap.get("scope"))


async def compute_dashboard(company_id: str, scope: list[str] | None) -> dict:
    pf = {} if not scope or "*" in scope else {"project_id": {"$in": scope}}
    projects = await db.project_summaries.find({"company_id": company_id, **pf}, {"_id": 0}).to_list(None)
    today = date.today().isoformat()
    payload = {"projects": projects,
               "totals": {"units": sum(p["units"]["total"] for p in projects), "available": sum(p["units"]["available"] for p in projects), "bookings": sum(p["bookings"] for p in projects),
                          "agreement_paise": sum(p["agreement_paise"] for p in projects), "paid_paise": sum(p["paid_paise"] for p in projects), "collections_mtd_paise": sum(p["collections_mtd_paise"] for p in projects),
                          "outstanding_paise": sum(p["outstanding"]["total_paise"] for p in projects), "overdue_paise": sum(p["overdue"]["amount_paise"] for p in projects), "overdue_count": sum(p["overdue"]["count"] for p in projects),
                          "pending_cheques_paise": sum(p["pending_cheques_paise"] for p in projects)},
               "counts": {"projects": await db.projects.count_documents({"company_id": company_id, **({"id": pf["project_id"]} if "project_id" in pf else {})}),
                          "leads_open": await db.leads.count_documents({"company_id": company_id, **pf, "status": {"$nin": ["Lost", "Converted"]}}),
                          "visits_today": await db.site_visits.count_documents({"company_id": company_id, **pf, "date": today, "status": {"$in": ["Confirmed", "Rescheduled"]}}),
                          "cheques_pending": await db.payments.count_documents({"company_id": company_id, **pf, "status": "Pending"}),
                          "tickets_open": await db.service_requests.count_documents({"company_id": company_id, **pf, "status": {"$nin": ["Resolved", "Closed"]}}),
                          "followups_due": await db.leads.count_documents({"company_id": company_id, **pf, "next_follow_up_at": {"$lte": now_iso()}, "status": {"$nin": ["Lost", "Converted"]}})}}
    doc = {"company_id": company_id, "scope_hash": scope_hash(scope), "scope": scope, "payload": payload, "computed_at": now_iso(), "derived": True}
    await db.dashboard_snapshots.update_one({"company_id": company_id, "scope_hash": doc["scope_hash"]}, {"$set": doc}, upsert=True)
    return doc


async def get_dashboard(company_id: str, scope: list[str] | None) -> dict:
    snap = await db.dashboard_snapshots.find_one({"company_id": company_id, "scope_hash": scope_hash(scope)}, {"_id": 0})
    return snap or await compute_dashboard(company_id, scope)


async def recompute_all() -> dict:
    t0 = datetime.now(UTC)
    bl = [b["id"] for b in await db.blocks.find({}, {"_id": 0, "id": 1}).to_list(None)]
    for bid in bl:
        await refresh_block(bid)
    pr = [p["id"] for p in await db.projects.find({}, {"_id": 0, "id": 1}).to_list(None)]
    for pid in pr:
        await refresh_project(pid)
    cu = [c["id"] for c in await db.customers.find({}, {"_id": 0, "id": 1}).to_list(None)]
    for cid in cu:
        await refresh_customer(cid)
    await refresh_dashboards()
    out = {"blocks": len(bl), "projects": len(pr), "customers": len(cu), "ms": int((datetime.now(UTC) - t0).total_seconds() * 1000)}
    await db.settings.update_one({"key": "read_models_v1"}, {"$set": {"value": now_iso()}}, upsert=True)
    return out


async def sweep_loop():
    while True:
        await asyncio.sleep(60)
        try:
            stale = now_iso()
            await flush()
            for p in await db.project_summaries.find({"computed_at": {"$lt": (datetime.now(UTC) - timedelta(minutes=10)).isoformat()}}, {"_id": 0, "project_id": 1}).to_list(50):
                await refresh_project(p["project_id"])
            await refresh_dashboards()
            log.debug("[readmodels] sweep ok %s", stale)
        except Exception:
            log.exception("read model sweep failed")
