"""In-app notification center: per-user notifications generated from audit/event bus, polled by the UI."""
from fastapi import APIRouter, Depends

from db import db
from deps import require
from events import bus
from utils import base_doc, now_iso

router = APIRouter(prefix="/notifications", tags=["notifications"])

# action -> (roles that should receive, title builder)
RULES = {
    "lead.create": (["Sales", "Marketing", "Super Admin"], lambda a: ("New website enquiry", f"{a.get('lead_number', '')} · {a.get('project') or 'General'}") if a.get("source") == "Website" else None),
    "payment.bounce": (["Accounts", "Super Admin"], lambda a: ("Cheque bounced", f"{a.get('receipt_number', '')} · {a.get('customer_name', '')} · {a.get('reason', '')}")),
    "milestone.complete": (["Accounts", "Project Admin", "Super Admin"], lambda a: ("Milestone completed", f"{a.get('block_name') or a.get('block_code') or ''} · {a.get('milestone_name', '')} ({a.get('cumulative_percent', '')}%)")),
    "booking.agreement_revision": (["Accounts", "Super Admin"], lambda a: ("Agreement revised", f"{a.get('booking_number', '')} · {a.get('reason', '')}")),
    "booking.cancel": (["Accounts", "Sales", "Super Admin"], lambda a: ("Booking cancelled", f"{a.get('booking_number', '')} · {a.get('reason', '')}")),
    "service.create": (["Sales", "Super Admin"], lambda a: ("New service request", f"{a.get('ticket_number', '')} · {a.get('subject', '')} · {a.get('customer_name', '')}")),
    "service.customer_reply": (["Sales", "Super Admin"], lambda a: ("Customer replied on ticket", f"{a.get('ticket_number', '')} · {a.get('customer_name', '')}")),
    "service.sla_breach": (["Sales", "Super Admin", "Project Admin"], lambda a: ("SLA breached", f"{a.get('ticket_number', '')} · {a.get('subject', '')}")),
    "demand.create": (["Accounts", "Super Admin"], lambda a: ("Installment demand raised", f"{a.get('demand_number', '')} · {a.get('customer_name', '')} · {a.get('milestone', '')} · due {a.get('due_date', '')}")),
    "demand.overdue": (["Accounts", "Super Admin"], lambda a: ("Demand overdue", f"{a.get('demand_number', '')} · {a.get('customer_name', '')} · due {a.get('due_date', '')}")),
}


async def notify_roles(company_id: str, roles: list[str], title: str, body: str, kind: str, entity_type: str, entity_id: str, link: str | None = None, exclude: set | None = None):
    role_ids = [r["id"] for r in await db.roles.find({"company_id": company_id, "name": {"$in": roles}}, {"_id": 0, "id": 1}).to_list(None)]
    users = [u for u in await db.users.find({"company_id": company_id, "$or": [{"role_id": {"$in": role_ids}}, {"role_ids": {"$in": role_ids}}], "is_active": True}, {"_id": 0, "id": 1}).to_list(None) if u["id"] not in (exclude or set())]
    if not users:
        return
    now = now_iso()
    await db.notifications.insert_many([{**base_doc(None, company_id), "user_id": u["id"], "title": title, "body": body, "kind": kind, "entity_type": entity_type, "entity_id": entity_id, "link": link, "read": False, "created_at": now} for u in users])


@bus.subscribe("entity.changed", "notifications")
async def notification_subscriber(evt: dict):
    """Registry-driven (event_registry.EVENTS): roles → ERP users, parties → assignee / RM / customer (portal). RULES is the legacy fallback."""
    spec = evt.get("spec") or {}
    after = evt.get("after") or {}
    cid = evt.get("company_id")
    if not cid:
        return
    title_fn = spec.get("title")
    res = title_fn(after) if title_fn else None
    if res is None and evt.get("action") in RULES:
        res = RULES[evt["action"]][1](after)
    if not res:
        return
    link = {"lead": "/leads", "payment": "/payments", "booking": f"/bookings/{evt['entity_id']}", "block": f"/blocks/{evt['entity_id']}", "demand": "/bookings", "service_request": f"/service-requests/{evt['entity_id']}", "site_visit": "/site-visits"}.get(evt["entity_type"])
    parties = spec.get("parties") or []
    seen = set()
    if "assignee" in parties and after.get("assigned_to"):
        seen.add(after["assigned_to"])
        await db.notifications.insert_one({**base_doc(None, cid), "user_id": after["assigned_to"], "title": res[0], "body": res[1], "kind": evt["action"], "entity_type": evt["entity_type"], "entity_id": evt["entity_id"], "link": link, "read": False, "created_at": now_iso()})
    if "rm" in parties and after.get("rm_user_id") and after["rm_user_id"] not in seen:
        seen.add(after["rm_user_id"])
        await db.notifications.insert_one({**base_doc(None, cid), "user_id": after["rm_user_id"], "title": res[0], "body": res[1], "kind": evt["action"], "entity_type": evt["entity_type"], "entity_id": evt["entity_id"], "link": link, "read": False, "created_at": now_iso()})
    if "customer" in parties and evt["entity_type"] == "booking":
        b = await db.bookings.find_one({"id": evt["entity_id"]}, {"_id": 0, "id": 1, "company_id": 1, "customer_id": 1, "co_applicant_customer_ids": 1})
        if b:
            from services.portal_notify import notify_booking_parties
            await notify_booking_parties(b, evt["action"], res[0], res[1], evt["entity_type"], evt["entity_id"])
    roles = spec.get("roles") or (RULES.get(evt["action"], ([], None))[0])
    if roles:
        await notify_roles(cid, roles, res[0], res[1], evt["action"], evt["entity_type"], evt["entity_id"], link, exclude=seen)


async def overdue_demand_job():
    """Daily: notify Accounts for demands that became overdue (idempotent per demand)."""
    today = now_iso()[:10]
    from routers.support import sla_breach_job
    await sla_breach_job()
    async for d in db.demands.find({"voided": False, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}, "overdue_notified": {"$ne": True}}, {"_id": 0}).batch_size(500):
        b = await db.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "id": 1, "customer_name": 1, "company_id": 1, "customer_id": 1, "co_applicant_customer_ids": 1})
        if b:
            from services.portal_notify import notify_booking_parties
            await notify_booking_parties(b, "demand.overdue", f"Payment overdue: {d.get('installment_name') or d.get('milestone_name')}", f"{d['demand_number']} · ₹{(d['total_demand_paise'] - d.get('paid_paise', 0)) / 100:,.0f} outstanding · was due {d['due_date']}", "demand", d["id"])
            await notify_roles(b["company_id"], RULES["demand.overdue"][0], "Demand overdue", f"{d['demand_number']} · {b['customer_name']} · due {d['due_date']}", "demand.overdue", "booking", d["booking_id"], f"/bookings/{d['booking_id']}")
        await db.demands.update_one({"id": d["id"]}, {"$set": {"overdue_notified": True}})


@router.get("/unread-count")
async def unread_count(user: dict = Depends(require("masters.project.view"))):
    return {"unread": await db.notifications.count_documents({"user_id": user["id"], "read": False, "withdrawn": {"$ne": True}})}


@router.get("")
async def list_notifications(unread_only: bool = False, limit: int = 30, user: dict = Depends(require("masters.project.view"))):
    q = {"user_id": user["id"], "withdrawn": {"$ne": True}}
    if unread_only:
        q["read"] = False
    items = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100)).to_list(None)
    return {"items": items, "unread": await db.notifications.count_documents({"user_id": user["id"], "read": False, "withdrawn": {"$ne": True}})}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: dict = Depends(require("masters.project.view"))):
    await db.notifications.update_one({"id": notification_id, "user_id": user["id"]}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(user: dict = Depends(require("masters.project.view"))):
    r = await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True, "updated": r.modified_count}


async def notify_users(company_id: str, user_ids: list[str], title: str, body: str, kind: str, entity_type: str, entity_id: str, link: str | None = None):
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return
    now = now_iso()
    await db.notifications.insert_many([{**base_doc(None, company_id), "user_id": u, "title": title, "body": body, "kind": kind, "entity_type": entity_type, "entity_id": entity_id, "link": link, "read": False, "created_at": now} for u in ids])
