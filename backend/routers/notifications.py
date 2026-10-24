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
    "demand.overdue": (["Accounts", "Super Admin"], lambda a: ("Demand overdue", f"{a.get('demand_number', '')} · {a.get('customer_name', '')} · due {a.get('due_date', '')}")),
}


async def notify_roles(company_id: str, roles: list[str], title: str, body: str, kind: str, entity_type: str, entity_id: str, link: str | None = None):
    role_ids = [r["id"] for r in await db.roles.find({"company_id": company_id, "name": {"$in": roles}}, {"_id": 0, "id": 1}).to_list(None)]
    users = await db.users.find({"company_id": company_id, "role_id": {"$in": role_ids}, "is_active": True}, {"_id": 0, "id": 1}).to_list(None)
    if not users:
        return
    now = now_iso()
    await db.notifications.insert_many([{**base_doc(None, company_id), "user_id": u["id"], "title": title, "body": body, "kind": kind, "entity_type": entity_type, "entity_id": entity_id, "link": link, "read": False, "created_at": now} for u in users])


@bus.subscribe("entity.changed")
async def notification_subscriber(evt: dict):
    rule = RULES.get(evt.get("action"))
    if not rule or not evt.get("company_id"):
        return
    roles, build = rule
    after = evt.get("after") or {}
    res = build(after)
    if not res:
        return
    if evt["action"].startswith("service.") and after.get("assigned_to"):
        now = now_iso()
        link = f"/service-requests/{evt['entity_id']}"
        await db.notifications.insert_one({**base_doc(None, evt["company_id"]), "user_id": after["assigned_to"], "title": res[0], "body": res[1], "kind": evt["action"], "entity_type": "service_request", "entity_id": evt["entity_id"], "link": link, "read": False, "created_at": now})
        roles = [r for r in roles if r != "Sales"]
    link = {"lead": "/leads?source=Website", "payment": "/payments", "booking": f"/bookings/{evt['entity_id']}", "block": f"/blocks/{evt['entity_id']}", "demand": "/bookings", "service_request": f"/service-requests/{evt['entity_id']}"}.get(evt["entity_type"])
    await notify_roles(evt["company_id"], roles, res[0], res[1], evt["action"], evt["entity_type"], evt["entity_id"], link)


async def overdue_demand_job():
    """Daily: notify Accounts for demands that became overdue (idempotent per demand)."""
    today = now_iso()[:10]
    from routers.support import sla_breach_job
    await sla_breach_job()
    async for d in db.demands.find({"voided": False, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}, "overdue_notified": {"$ne": True}}, {"_id": 0}):
        b = await db.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "customer_name": 1, "company_id": 1})
        if b:
            await notify_roles(b["company_id"], RULES["demand.overdue"][0], "Demand overdue", f"{d['demand_number']} · {b['customer_name']} · due {d['due_date']}", "demand.overdue", "booking", d["booking_id"], f"/bookings/{d['booking_id']}")
        await db.demands.update_one({"id": d["id"]}, {"$set": {"overdue_notified": True}})


@router.get("")
async def list_notifications(unread_only: bool = False, limit: int = 30, user: dict = Depends(require("project.read"))):
    q = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    items = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 100)).to_list(None)
    return {"items": items, "unread": await db.notifications.count_documents({"user_id": user["id"], "read": False})}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: dict = Depends(require("project.read"))):
    await db.notifications.update_one({"id": notification_id, "user_id": user["id"]}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(user: dict = Depends(require("project.read"))):
    r = await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True, "updated": r.modified_count}
