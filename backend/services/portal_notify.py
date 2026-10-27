"""Customer (portal) notifications — stored in `notifications` with user_id = "customer:<id>"."""
import logging
import re

from db import db
from utils import new_id, now_iso

logger = logging.getLogger("kkt.notify")
PORTAL_LINKS = {"demand.raised": "/ledger", "demand.overdue": "/ledger", "stage.completed": "/construction", "ticket.reply": "/service-requests", "notice.published": "/notices"}
CANONICAL = {"demand.create": "demand.raised", "milestone.complete": "stage.completed", "service.reply": "ticket.reply", "notice.create": "notice.published"}
_DM = re.compile(r"\b(DM-\d{4}-\d{4})\b")


async def notify_customer(company_id: str, customer_id: str, ntype: str, title: str, body: str, booking_id: str | None = None, entity_type: str | None = None, entity_id: str | None = None, extra: dict | None = None):
    await db.notifications.insert_one({"id": new_id(), "company_id": company_id, "user_id": f"customer:{customer_id}", "type": ntype, "kind": ntype, "title": title, "body": body,
                                       "booking_id": booking_id, "entity_type": entity_type, "entity_id": entity_id, "link": PORTAL_LINKS.get(ntype), "read": False, "withdrawn": False, "created_at": now_iso(), **(extra or {})})


async def notify_booking_parties(booking: dict, ntype: str, title: str, body: str, entity_type: str | None = None, entity_id: str | None = None, extra: dict | None = None):
    """Primary customer + co-applicants of a booking."""
    for cid in dict.fromkeys([booking["customer_id"], *(booking.get("co_applicant_customer_ids") or [])]):
        await notify_customer(booking["company_id"], cid, ntype, title, body, booking["id"], entity_type, entity_id, extra)


def public_notification(n: dict) -> dict:
    return {"id": n["id"], "type": n.get("type") or CANONICAL.get(n.get("kind"), n.get("kind")), "title": n["title"], "body": n.get("body"), "booking_id": n.get("booking_id"), "entity_type": n.get("entity_type"), "entity_id": n.get("entity_id"), "is_read": bool(n.get("read")), "withdrawn": bool(n.get("withdrawn")), "created_at": n["created_at"]}


async def retract(query: dict, reason: str = "entity_voided") -> dict:
    """Unread → soft-retracted (hidden, out of unread counts); already read → withdrawn (body suffixed). No deletes.
    Applies to customer and ERP notifications alike. `deleted` is kept in the return shape for the unread-retracted count."""
    q = {**query, "withdrawn": {"$ne": True}}
    deleted = (await db.notifications.update_many({**q, "read": False}, {"$set": {"withdrawn": True, "retracted": True, "retracted_at": now_iso(), "reason": reason}})).modified_count
    withdrawn = 0
    async for n in db.notifications.find({**q, "read": True}, {"_id": 0, "id": 1, "body": 1}).batch_size(500):
        await db.notifications.update_one({"id": n["id"]}, {"$set": {"withdrawn": True, "withdrawn_at": now_iso(), "body": f"{n.get('body') or ''} (withdrawn)".strip()}})
        withdrawn += 1
    return {"deleted": deleted, "withdrawn": withdrawn}


async def retract_for_demands(demands: list[dict]) -> dict:
    """Retract customer + ERP notifications tied to the given (now voided) demands."""
    ids = [d["id"] for d in demands]
    nums = [d["demand_number"] for d in demands if d.get("demand_number")]
    if not ids:
        return {"deleted": 0, "withdrawn": 0}
    ors = [{"entity_type": "demand", "entity_id": {"$in": ids}}]
    if nums:
        ors.append({"kind": {"$in": ["demand.create", "demand.raised", "demand.overdue"]}, "body": {"$regex": "|".join(re.escape(n) for n in nums)}})
    return await retract({"$or": ors})


async def retract_for_stage(block_id: str, stage_id: str, stage_name: str) -> dict:
    return await retract({"$or": [{"stage_id": stage_id}, {"kind": "stage.completed", "entity_type": "block", "entity_id": block_id, "title": {"$regex": re.escape(stage_name)}}]})


async def _withdraw_orphan(n: dict) -> None:
    """Startup sweep never deletes: orphaned rows are soft-withdrawn (same shape retract() uses for read rows)."""
    await db.notifications.update_one({"id": n["id"]}, {"$set": {"withdrawn": True, "withdrawn_at": now_iso(), "orphan": True, "swept_v": 2, "body": f"{n.get('body') or ''} (withdrawn)".strip()}})


async def sweep_notifications() -> dict:
    """Startup: canonical types for customer notifications, fill booking_id from the demand, soft-withdraw orphans (no deletes). Idempotent."""
    stats = {"normalized": 0, "withdrawn": 0}
    # Phase J.2: O(changed) — rows already normalised carry swept_v=2 and are skipped (watermark per row; no full rescan on later boots)
    async for n in db.notifications.find({"user_id": {"$regex": "^customer:"}, "swept_v": {"$ne": 2}}, {"_id": 0}).batch_size(500):
        kind = n.get("type") or n.get("kind")
        ntype = CANONICAL.get(kind, kind)
        upd = {}
        if n.get("type") != ntype or n.get("kind") != ntype:
            upd.update(type=ntype, kind=ntype)
        if ntype in ("demand.raised", "demand.overdue"):
            dem = await db.demands.find_one({"id": n.get("entity_id")}, {"_id": 0, "id": 1, "booking_id": 1, "voided": 1}) if n.get("entity_type") == "demand" else None
            if not dem:
                m = _DM.search(n.get("body") or "")
                dem = await db.demands.find_one({"demand_number": m.group(1)}, {"_id": 0, "id": 1, "booking_id": 1, "voided": 1}) if m else None
            if not dem or dem.get("voided"):
                await _withdraw_orphan(n)
                stats["withdrawn"] += 1
                continue
            upd.update(entity_type="demand", entity_id=dem["id"], booking_id=dem["booking_id"])
        elif ntype in ("ticket.reply", "notice.published", "stage.completed"):
            coll = {"ticket.reply": db.service_requests, "notice.published": db.notices, "stage.completed": db.blocks}[ntype]
            if n.get("entity_id") and not await coll.find_one({"id": n["entity_id"]}, {"_id": 0, "id": 1}):
                await _withdraw_orphan(n)
                stats["withdrawn"] += 1
                continue
        if "withdrawn" not in n:
            upd["withdrawn"] = False
        if "link" not in n or n.get("link") is None:
            upd["link"] = PORTAL_LINKS.get(ntype)
        upd["swept_v"] = 2
        await db.notifications.update_one({"id": n["id"]}, {"$set": upd})
        stats["normalized"] += 1
    if stats["normalized"] or stats["withdrawn"]:
        logger.info("[notify] sweep: %s", stats)
    return stats
