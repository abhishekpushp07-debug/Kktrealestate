"""Refunds (cancellation payouts) + Journey ("where did this go?") + Customer timeline + Definitions + propagation health."""
from services import clock
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import project_scope_filter, require
from event_registry import EVENTS, SURFACE_CACHE
from services.definitions import DEFINITIONS
from services.money import present_money
from utils import ApiError, StrictModel, get_or_404, paginate, ListParams

router = APIRouter(tags=["propagation"])


class RefundPayIn(StrictModel):
    paid_date: date
    mode: Literal["CASH", "NEFT_RTGS", "CHEQUE", "UPI", "DD"]
    bank_account_id: str | None = None
    reference: str | None = Field(default=None, max_length=120)


@router.get("/refunds")
async def list_refunds(params: ListParams = Depends(), status: str | None = None, project_id: str | None = None, user: dict = Depends(require("finance.refund.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), "parent_refund_id": {"$exists": False}}
    if status:
        q["status"] = {"$in": status.split(",")}
    if project_id:
        q["project_id"] = project_id
    res = await paginate(db.refunds, q, params, params.sort_spec(["created_at", "paid_date", "amount_paise", "status"], "-created_at"))
    res["items"] = present_money(res["items"])
    agg = await db.refunds.aggregate([{"$match": {**q, "parent_refund_id": {"$exists": False}}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "s": {"$sum": {"$ifNull": ["$amount_total_paise", "$amount_paise"]}}}}]).to_list(None)
    res["totals"] = present_money({a["_id"]: {"count": a["n"], "amount_paise": a["s"]} for a in agg})
    return res


@router.post("/refunds/{refund_id}/pay")
async def pay_refund_ep(refund_id: str, body: RefundPayIn, request: Request, user: dict = Depends(require("finance.refund.pay"))):
    rf = await get_or_404(db.refunds, refund_id, "Refund", {"company_id": user["company_id"]})
    if body.mode != "CASH" and not body.bank_account_id:
        raise ApiError(422, "bank_account_id required for non-cash refunds", "VALIDATION_ERROR")
    if body.paid_date > clock.today():
        raise ApiError(422, "paid_date cannot be in the future", "VALIDATION_ERROR")
    from services.money_ops import pay_refund
    return present_money(await pay_refund(rf, {"paid_date": body.paid_date.isoformat(), "mode": body.mode, "bank_account_id": body.bank_account_id, "reference": body.reference}, user))


# ---------- Definitions (read-only) ----------
@router.get("/definitions")
async def definitions(user: dict = Depends(require("admin.definitions.view"))):
    return {"items": DEFINITIONS, "events": [{"event": k, "entity": v["entity"], "surfaces": v["surfaces"], "roles": v.get("roles", []), "parties": v.get("parties", [])} for k, v in EVENTS.items()]}


# ---------- Journey ----------
SURFACE_LINKS = {
    "ledgers": lambda c: f"/bookings/{c.get('booking_id')}?tab=ledger" if c.get("booking_id") else "/bookings", "bookings": lambda c: f"/bookings/{c.get('booking_id')}" if c.get("booking_id") else "/bookings",
    "demands": lambda c: f"/bookings/{c.get('booking_id')}?tab=schedule" if c.get("booking_id") else "/payments?tab=demands", "payments": lambda c: "/payments", "customer360": lambda c: f"/customers/{c.get('customer_id')}" if c.get("customer_id") else "/customers",
    "home": lambda c: "/dashboard", "dashboard": lambda c: "/dashboard", "widgets": lambda c: "/dashboard", "bootstrap": lambda c: "/dashboard", "roznamcha": lambda c: f"/roznamcha?date={c.get('date') or ''}", "reports": lambda c: "/reports",
    "audit": lambda c: "/audit", "flats": lambda c: f"/blocks/{c.get('block_id')}" if c.get("block_id") else "/flats", "inventory": lambda c: f"/blocks/{c.get('block_id')}" if c.get("block_id") else "/flats", "blocks": lambda c: f"/blocks/{c.get('block_id')}" if c.get("block_id") else "/projects",
    "projects": lambda c: f"/projects/{c.get('project_id')}" if c.get("project_id") else "/projects", "leads": lambda c: "/leads", "visits": lambda c: "/site-visits", "service": lambda c: "/service-requests", "notifications": lambda c: "/notifications",
    "refunds": lambda c: f"/bookings/{c.get('booking_id')}?tab=refunds" if c.get("booking_id") else "/refunds", "cheques": lambda c: "/reports/cheques", "search": lambda c: "/", "customers": lambda c: f"/customers/{c.get('customer_id')}" if c.get("customer_id") else "/customers", "bundle": lambda c: "/settings", "users": lambda c: "/users",
}


async def _context(a: dict) -> dict:
    et, eid = a["entity_type"], a["entity_id"]
    ctx = {"booking_id": None, "customer_id": None, "block_id": None, "project_id": None, "date": a["created_at"][:10]}
    coll = {"booking": db.bookings, "payment": db.payments, "demand": db.demands, "refund": db.refunds, "flat": db.flats, "block": db.blocks, "lead": db.leads, "service_request": db.service_requests, "site_visit": db.site_visits, "customer": db.customers}.get(et)
    doc = await coll.find_one({"id": eid}, {"_id": 0, "id": 1, "booking_id": 1, "customer_id": 1, "block_id": 1, "project_id": 1, "converted_customer_id": 1}) if coll is not None else None
    if doc:
        ctx.update({"booking_id": doc["id"] if et == "booking" else doc.get("booking_id"), "customer_id": doc["id"] if et == "customer" else doc.get("customer_id") or doc.get("converted_customer_id"), "block_id": doc["id"] if et == "block" else doc.get("block_id"), "project_id": doc["id"] if et == "project" else doc.get("project_id")})
    return ctx


async def _effects(a: dict) -> list[dict]:
    """Concrete before→after values for the surfaces this event touched (what exists in the DB now)."""
    ctx = await _context(a)
    out = []
    after = a.get("after") or {}
    if ctx["booking_id"]:
        b = await db.bookings.find_one({"id": ctx["booking_id"]}, {"_id": 0, "booking_number": 1, "summary": 1, "status": 1, "flat_snapshot": 1})
        if b:
            s = b.get("summary") or {}
            out.append({"surface": "bookings", "label": f"Booking {b['booking_number']} summary", "now": present_money({k: s.get(k, 0) for k in ("paid_paise", "due_paise", "other_charges_due_paise", "pending_cheques_paise")}) | {"status": b["status"], "unit": (b.get("flat_snapshot") or {}).get("flat_number")}})
            rows = await db.ledger_entries.find({"booking_id": ctx["booking_id"], **({"ref": after["receipt_number"]} if after.get("receipt_number") else {"at": {"$gte": a["created_at"][:16]}})}, {"_id": 0, "seq": 1, "type": 1, "amount_paise": 1, "category": 1, "ref": 1, "note": 1, "total_due_paise": 1}).sort("seq", 1).to_list(10)
            if rows:
                out.append({"surface": "ledgers", "label": f"{len(rows)} ledger row(s)", "rows": present_money(rows)})
            dem = await db.demands.find({"booking_id": ctx["booking_id"], "voided": {"$ne": True}}, {"_id": 0, "demand_number": 1, "status": 1, "paid_paise": 1, "total_demand_paise": 1, "due_date": 1, "trigger_stage_id": 1}).sort("posted_at", 1).to_list(50)
            out.append({"surface": "demands", "label": f"{len(dem)} demand(s) · open {sum(1 for d in dem if d['status'] in ('Open', 'Partially Paid'))}", "rows": present_money(dem[-6:])})
            rf = await db.refunds.find({"booking_id": ctx["booking_id"], "parent_refund_id": {"$exists": False}}, {"_id": 0, "refund_number": 1, "status": 1, "amount_paise": 1, "paid_date": 1}).to_list(5)
            if rf:
                out.append({"surface": "refunds", "label": f"{len(rf)} refund(s)", "rows": present_money(rf)})
    if ctx["customer_id"]:
        cs = await db.customer_summaries.find_one({"customer_id": ctx["customer_id"]}, {"_id": 0, "full_name": 1, "due_paise": 1, "overdue_paise": 1, "paid_paise": 1, "lifecycle_stage": 1, "computed_at": 1})
        if cs:
            out.append({"surface": "customer360", "label": f"Customer 360 · {cs['full_name']}", "now": present_money(cs)})
    if ctx["block_id"]:
        bs = await db.block_summaries.find_one({"block_id": ctx["block_id"]}, {"_id": 0, "code": 1, "units": 1, "outstanding": 1, "overdue": 1, "progress": 1, "computed_at": 1})
        if bs:
            out.append({"surface": "blocks", "label": f"Tower {bs['code']} summary", "now": present_money({"units": bs["units"].get("by_status"), "outstanding_paise": bs["outstanding"]["total_paise"], "overdue_paise": bs["overdue"]["amount_paise"], "progress": bs["progress"], "computed_at": bs["computed_at"]})})
    if ctx["project_id"]:
        ps = await db.project_summaries.find_one({"project_id": ctx["project_id"]}, {"_id": 0, "code": 1, "units": 1, "outstanding": 1, "overdue": 1, "collections_mtd_paise": 1, "computed_at": 1})
        if ps:
            out.append({"surface": "projects", "label": f"Project {ps['code']} summary", "now": present_money({"available": ps["units"]["available"], "outstanding_paise": ps["outstanding"]["total_paise"], "overdue_paise": ps["overdue"]["amount_paise"], "collections_mtd_paise": ps["collections_mtd_paise"], "computed_at": ps["computed_at"]})})
    snap = await db.dashboard_snapshots.find_one({"company_id": a["company_id"], "scope_hash": "*"}, {"_id": 0, "payload.totals": 1, "computed_at": 1})
    if snap:
        out.append({"surface": "home", "label": "Home tiles", "now": present_money({**snap["payload"]["totals"], "computed_at": snap["computed_at"]})})
    notes = await db.notifications.find({"audit_id": a["id"]}, {"_id": 0, "user_id": 1, "title": 1, "withdrawn": 1}).to_list(50)
    out.append({"surface": "notifications", "label": f"{len(notes)} notification(s) sent", "rows": notes})
    if a["entity_type"] in ("flat",) or a["action"] in ("booking.create", "booking.cancel", "booking.transfer"):
        fid = a["entity_id"] if a["entity_type"] == "flat" else after.get("flat_id")
        f = await db.flats.find_one({"id": fid}, {"_id": 0, "flat_number": 1, "status": 1}) if fid else None
        if f:
            out.append({"surface": "inventory", "label": f"Unit {f['flat_number']}", "now": {"status": f["status"]}, "before": (a.get("before") or {}).get("status")})
    return out


def _diff(before: dict | None, after: dict | None) -> list[dict]:
    out = []
    for k in sorted(set((before or {}).keys()) | set((after or {}).keys())):
        b, a = (before or {}).get(k), (after or {}).get(k)
        out.append({"field": k, "before": b, "after": a, "changed": b != a})
    return out


@router.get("/journey/{audit_id}")
async def journey(audit_id: str, user: dict = Depends(require("admin.audit.view"))):
    a = await get_or_404(db.audit_logs, audit_id, "Entry", {"company_id": user["company_id"]})
    ctx = await _context(a)
    surfaces = list(a.get("surfaces") or EVENTS.get(a["action"], {}).get("surfaces") or [])
    snap_after, snap_before = a.get("snapshot") or {}, a.get("snapshot_before") or {}
    effects = await _effects(a)
    notes = await db.notifications.find({"audit_id": a["id"]}, {"_id": 0, "user_id": 1, "title": 1}).to_list(50)
    names = {u["id"]: u["name"] for u in await db.users.find({"id": {"$in": [n["user_id"] for n in notes]}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    done = {"notifications": "notified: " + ", ".join(names.get(n["user_id"], "customer" if str(n["user_id"]).startswith("customer:") else n["user_id"][:8]) for n in notes) if notes else "no recipients (actor excluded / none configured)",
            "audit": f"audit row {a['id'][:8]} · {len(a.get('propagated') or {})} handlers", "reports": "pull-based: recomputed on next request", "search": "indexed", "bootstrap": "counts cache invalidated", "widgets": "cache invalidated", "dashboard": "cache invalidated", "customers": "list cache invalidated", "payments": "list cache invalidated", "flats": "list cache invalidated", "cheques": "register recomputed on request"}
    items = []
    for s_ in surfaces + [e["surface"] for e in effects if e["surface"] not in surfaces]:
        caches = list(SURFACE_CACHE.get(s_, ()))
        diff = _diff(snap_before.get(s_), snap_after.get(s_)) if (s_ in snap_after) else None
        items.append({"surface": s_, "link": SURFACE_LINKS.get(s_, lambda c: "/")(ctx), "caches": caches, "propagated": True, "has_values": bool(diff), "before_after": present_money(diff) if diff else None,
                      "done": done.get(s_) or (f"cache invalidated: {', '.join(caches)}" if caches else None), "detail": next((e for e in effects if e["surface"] == s_), None)})
    return {"entry": {k: a.get(k) for k in ("id", "action", "entity_type", "entity_id", "actor_name", "created_at", "before", "after", "propagated", "propagated_complete", "replayed_at")}, "context": ctx, "surfaces": items, "surfaces_total": len(items),
            "with_detail": sum(1 for i in items if i["detail"]), "with_before_after": sum(1 for i in items if i["has_values"]), "snapshot_available": bool(snap_after)}


@router.get("/journey/entity/{entity_type}/{entity_id}")
async def journey_entity(entity_type: str, entity_id: str, limit: int = 30, user: dict = Depends(require("admin.audit.view"))):
    rows = await db.audit_logs.find({"company_id": user["company_id"], "entity_type": entity_type, "entity_id": entity_id}, {"_id": 0, "id": 1, "action": 1, "actor_name": 1, "created_at": 1, "after": 1, "surfaces": 1, "propagated_complete": 1}).sort("created_at", -1).limit(min(limit, 100)).to_list(None)
    return {"items": rows}


# ---------- Customer 360 timeline (all entity events from the outbox) ----------
@router.get("/customers/{customer_id}/events")
async def customer_timeline(customer_id: str, limit: int = 200, kinds: str | None = None, user: dict = Depends(require("sales.customer.view"))):
    c = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    bookings = await db.bookings.find({"$or": [{"customer_id": customer_id}, {"co_applicant_customer_ids": customer_id}]}, {"_id": 0, "id": 1, "block_id": 1, "booking_number": 1}).to_list(50)
    bids = [b["id"] for b in bookings]
    blocks = list({b["block_id"] for b in bookings})
    lead_q = {"$or": [{"converted_customer_id": customer_id}, {"booking_id": {"$in": bids}}] + ([{"phone": c["phone"], "converted_customer_id": None}] if c.get("phone") else [])}
    leads = [l["id"] for l in await db.leads.find(lead_q, {"_id": 0, "id": 1}).to_list(50)]
    visits = [v["id"] for v in await db.site_visits.find({"$or": [{"customer_id": customer_id}, {"lead_id": {"$in": leads}}]}, {"_id": 0, "id": 1}).to_list(50)]
    pays = [p["id"] for p in await db.payments.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1}).to_list(500)]
    tickets = [t["id"] for t in await db.service_requests.find({"customer_id": customer_id}, {"_id": 0, "id": 1}).to_list(100)]
    refunds = [r["id"] for r in await db.refunds.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1}).to_list(50)]
    docs = [d["id"] for d in await db.documents.find({"$or": [{"customer_id": customer_id}, {"booking_id": {"$in": bids}}]}, {"_id": 0, "id": 1}).to_list(100)]
    ors = [{"entity_type": "customer", "entity_id": customer_id}, {"entity_type": "booking", "entity_id": {"$in": bids}}, {"entity_type": "payment", "entity_id": {"$in": pays}}, {"entity_type": "lead", "entity_id": {"$in": leads}},
           {"entity_type": "site_visit", "entity_id": {"$in": visits}}, {"entity_type": "service_request", "entity_id": {"$in": tickets}}, {"entity_type": "refund", "entity_id": {"$in": refunds}}, {"entity_type": "document", "entity_id": {"$in": docs}},
           {"entity_type": "block", "entity_id": {"$in": blocks}, "action": {"$in": ["milestone.complete", "milestone.undo", "stage.photo"]}}, {"entity_type": "demand", "entity_id": {"$in": [d["id"] for d in await db.demands.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1}).to_list(300)]}}]
    q = {"company_id": user["company_id"], "$or": ors}
    if kinds:
        ks = [k.strip() for k in kinds.split(",")]
        pats = [k for k in ks if k != "transfer"]
        ors2 = ([{"action": {"$regex": "^(" + "|".join(pats) + ")"}}] if pats else []) + ([{"action": {"$in": ["booking.transfer", "booking.agreement_revision", "demand.rebind", "demand.reproportion"]}}] if "transfer" in ks else [])
        q = {"$and": [q, {"$or": ors2}]}
    all_actions = await db.audit_logs.distinct("action", {"company_id": user["company_id"], "$or": ors})
    rows = await db.audit_logs.find(q, {"_id": 0, "id": 1, "action": 1, "entity_type": 1, "entity_id": 1, "actor_name": 1, "created_at": 1, "after": 1, "before": 1, "surfaces": 1}).sort("created_at", -1).limit(min(limit, 500)).to_list(None)
    bnum = {b["id"]: b["booking_number"] for b in bookings}
    for r in rows:
        r["kind"] = "transfer" if r["action"] in ("booking.transfer", "booking.agreement_revision", "demand.rebind", "demand.reproportion") else r["action"].split(".")[0]
        r["booking_number"] = bnum.get(r["entity_id"]) or (r.get("after") or {}).get("booking_number")
        r["link"] = {"booking": f"/bookings/{r['entity_id']}", "payment": "/payments", "lead": "/leads", "site_visit": "/site-visits", "service_request": f"/service-requests/{r['entity_id']}", "block": f"/blocks/{r['entity_id']}", "refund": f"/bookings/{(r.get('after') or {}).get('booking_id', '')}"}.get(r["entity_type"], f"/customers/{customer_id}")
    kinds_present = sorted({"transfer" if a in ("booking.transfer", "booking.agreement_revision", "demand.rebind", "demand.reproportion") else a.split(".")[0] for a in all_actions})
    if kinds and "transfer" in kinds.split(","):
        rows = [r for r in rows if r["kind"] == "transfer"] if False else rows
    return present_money({"items": rows, "kinds": kinds_present, "total": len(rows)})


@router.get("/admin/propagation")
async def propagation_health(user: dict = Depends(require("admin.system_health.view"))):
    from events import outbox_health
    h = await outbox_health()
    recent = await db.audit_logs.find({}, {"_id": 0, "id": 1, "action": 1, "created_at": 1, "propagated_complete": 1, "propagated": 1}).sort("created_at", -1).limit(10).to_list(None)
    errs = await db.audit_logs.find({"propagated_complete": False}, {"_id": 0, "id": 1, "action": 1, "created_at": 1, "propagated": 1}).sort("created_at", -1).limit(10).to_list(None)
    return {**h, "registered_events": len(EVENTS), "recent": recent, "failing": errs}
