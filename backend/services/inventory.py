"""Phase N — inventory control: allocation categories, holds/blocks with mandatory expiry, and a customer-facing DISPLAY layer decoupled from
the real inventory state. Real state lives in flats.status (booking engine owns Booked/Sold); display_state defaults to mirror it unless overridden."""
import uuid
from datetime import datetime, timedelta, timezone

from db import db
from utils import now_iso

REAL_STATES = ("Available", "Hold", "Blocked", "Booked", "Sold", "Not for sale")
DISPLAY_STATES = ("Show as Available", "Show as Sold", "Show as Hold", "Hidden")
MIRROR = {"Available": "Show as Available", "Hold": "Show as Hold", "Blocked": "Show as Sold", "Booked": "Show as Sold", "Sold": "Show as Sold", "Not for sale": "Hidden"}
DISPLAY_TO_STATUS = {"Show as Available": "Available", "Show as Sold": "Sold", "Show as Hold": "Hold", "Hidden": None}
REAL_STATUS_PERM = "inventory.real_status.view"
PRIVILEGED_FIELDS = ("display_state", "display_override", "display_set_by", "display_set_at", "display_reason", "hold", "block", "inventory_state")
SEED_CATEGORIES = [("Builder saleable", "BUILDER", True, "#2f855a"), ("Landowner share", "LANDOWNER", False, "#b7791f"), ("Investor share", "INVESTOR", False, "#6b46c1"),
                   ("Bank/mortgage", "BANK", False, "#2b6cb0"), ("Management reserve", "RESERVE", False, "#718096"), ("Sample/show flat", "SAMPLE", False, "#dd6b20"), ("Society/common", "SOCIETY", False, "#4a5568")]
SEED_HOLD_REASONS = [("Customer interest", "INTEREST"), ("Token received", "TOKEN"), ("Management", "MGMT"), ("Pricing review", "PRICING"), ("Legal/documentation", "LEGAL")]


def can_see_real(user: dict | None) -> bool:
    return bool(user) and REAL_STATUS_PERM in (user.get("permissions") or [])


def effective_display(flat: dict) -> str:
    return flat.get("display_state") if flat.get("display_override") and flat.get("display_state") else MIRROR.get(flat.get("status"), "Show as Available")


def shape(flat: dict, user: dict | None) -> dict | None:
    """Server-side response shaping. Non-privileged viewers get the DISPLAY layer as `status` and cannot tell a masked flat from a sold one;
    Hidden flats are dropped. Privileged viewers get both layers (`inventory_state` + `display_state`/`display_override`)."""
    disp = effective_display(flat)
    if can_see_real(user):
        flat["inventory_state"] = flat.get("status")
        flat["display_state"] = disp
        flat["display_override"] = bool(flat.get("display_override"))
        flat["masked"] = bool(flat.get("display_override")) and disp != MIRROR.get(flat.get("status"))
        return flat
    if disp == "Hidden":
        return None
    out = {k: v for k, v in flat.items() if k not in PRIVILEGED_FIELDS and k not in ("masked", "status_changed_by", "status_reason", "booking_id")}  # booking_id stripped for everyone non-privileged: a masked flat has none
    out["status"] = DISPLAY_TO_STATUS[disp]
    if "created_at" in out:  # full documents: key always present and non-null so a masked flat cannot be told apart from a genuinely sold one
        masked = bool(flat.get("display_override")) and disp != MIRROR.get(flat.get("status"))
        out["status_changed_at"] = (flat.get("display_set_at") if masked else None) or flat.get("status_changed_at") or flat.get("updated_at") or flat.get("created_at")
    if flat.get("status") == "Hold" and disp == "Show as Hold":
        h = flat.get("hold") or {}
        out["hold"] = {k: h.get(k) for k in ("expires_at", "for_customer_id", "for_user_id", "reason_id")}  # sales users work holds; no display metadata
    return out


def shape_list(items: list[dict], user: dict | None) -> list[dict]:
    return [s for s in (shape(f, user) for f in items) if s is not None]


def public_available_filter() -> dict:
    """Public/portal: display layer only — shown-as-Available, i.e. real Available with no override, or overridden to Show as Available."""
    return {"$or": [{"status": "Available", "display_override": {"$ne": True}}, {"display_override": True, "display_state": "Show as Available"}]}


def status_key(user: dict | None):
    """Aggregation group key: real `$status` for privileged viewers; the DISPLAY layer mapped back to a legacy status for everyone else
    (Hidden → null, so dashboards/counters cannot leak masked inventory)."""
    if can_see_real(user):
        return "$status"
    mirrored = {"$switch": {"branches": [{"case": {"$eq": ["$status", s]}, "then": DISPLAY_TO_STATUS[d]} for s, d in MIRROR.items()], "default": None}}
    overridden = {"$switch": {"branches": [{"case": {"$eq": ["$display_state", d]}, "then": st} for d, st in DISPLAY_TO_STATUS.items()], "default": None}}
    return {"$cond": [{"$eq": ["$display_override", True]}, overridden, mirrored]}


async def display_unit_counts(docs: list[dict], field: str, user: dict | None) -> list[dict]:
    """Non-privileged viewers: overwrite cached `unit_counts` (real) with display-layer counts so tower/project cards cannot leak masked inventory."""
    if not docs or can_see_real(user):
        return docs
    ids = [d["id"] for d in docs]
    rows = await db.flats.aggregate([{"$match": {field: {"$in": ids}, "is_active": True}}, {"$group": {"_id": {"k": f"${field}", "s": status_key(user)}, "n": {"$sum": 1}}}]).to_list(None)
    agg: dict = {i: {"available": 0, "hold": 0, "booked": 0, "sold": 0, "blocked": 0, "total": 0} for i in ids}
    for r in rows:
        s = r["_id"]["s"]
        if s:  # Hidden → None: not counted at all
            agg[r["_id"]["k"]][s.lower()] += r["n"]
            agg[r["_id"]["k"]]["total"] += r["n"]
    for d in docs:
        d["unit_counts"] = {**(d.get("unit_counts") or {}), **agg[d["id"]]}
    return docs


def bookable_filter(customer_id: str | None, user: dict) -> dict:
    """Booking wizard: Builder-saleable AND (Available, or Hold for this customer / this RM). Masked/blocked/landowner never appear."""
    ors = [{"status": "Available"}]
    if customer_id:
        ors.append({"status": "Hold", "hold.for_customer_id": customer_id})
    ors.append({"status": "Hold", "hold.for_user_id": user["id"], "hold.for_customer_id": None})
    return {"is_active": True, "bookable": True, "$or": ors, "$nor": [{"display_override": True, "display_state": {"$in": ["Show as Sold", "Hidden"]}}]}


async def ensure_masters(company_id: str) -> None:
    for name, code, bookable, colour in SEED_CATEGORIES:
        await db.allocation_categories.update_one({"company_id": company_id, "code": code}, {"$setOnInsert": {"id": str(uuid.uuid4()), "company_id": company_id, "name": name, "code": code, "bookable": bookable, "colour": colour, "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "is_system": True}}, upsert=True)
    for name, code in SEED_HOLD_REASONS:
        await db.hold_reasons.update_one({"company_id": company_id, "code": code}, {"$setOnInsert": {"id": str(uuid.uuid4()), "company_id": company_id, "name": name, "code": code, "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "is_system": True}}, upsert=True)


async def backfill(company_id: str) -> int:
    builder = await db.allocation_categories.find_one({"company_id": company_id, "code": "BUILDER"}, {"_id": 0, "id": 1})
    if not builder:
        return 0
    r = await db.flats.update_many({"company_id": company_id, "allocation_category_id": {"$exists": False}}, {"$set": {"allocation_category_id": builder["id"], "allocation_category_code": "BUILDER", "bookable": True, "display_override": False}})
    return r.modified_count


async def counters(match: dict, privileged: bool) -> dict:
    """Total · Saleable · Landowner · Other categories · Held (expiring in 48 h) · Blocked · Booked · Sold · Shown-as-sold (masked, privileged only)."""
    soon = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
    rows = await db.flats.aggregate([{"$match": {**match, "is_active": True}}, {"$group": {
        "_id": None, "total": {"$sum": 1},
        "saleable": {"$sum": {"$cond": [{"$eq": ["$bookable", True]}, 1, 0]}},
        "landowner": {"$sum": {"$cond": [{"$eq": ["$allocation_category_code", "LANDOWNER"]}, 1, 0]}},
        "other_categories": {"$sum": {"$cond": [{"$and": [{"$ne": ["$bookable", True]}, {"$ne": ["$allocation_category_code", "LANDOWNER"]}]}, 1, 0]}},
        "held": {"$sum": {"$cond": [{"$eq": ["$status", "Hold"]}, 1, 0]}},
        "held_expiring_48h": {"$sum": {"$cond": [{"$and": [{"$eq": ["$status", "Hold"]}, {"$lte": ["$hold.expires_at", soon]}]}, 1, 0]}},
        "blocked": {"$sum": {"$cond": [{"$eq": ["$status", "Blocked"]}, 1, 0]}},
        "booked": {"$sum": {"$cond": [{"$eq": ["$status", "Booked"]}, 1, 0]}},
        "sold": {"$sum": {"$cond": [{"$eq": ["$status", "Sold"]}, 1, 0]}},
        "available": {"$sum": {"$cond": [{"$eq": ["$status", "Available"]}, 1, 0]}},
        "shown_as_sold_masked": {"$sum": {"$cond": [{"$and": [{"$eq": ["$display_override", True]}, {"$eq": ["$display_state", "Show as Sold"]}, {"$not": [{"$in": ["$status", ["Booked", "Sold", "Blocked"]]}]}]}, 1, 0]}},
    }}]).to_list(1)
    c = rows[0] if rows else {k: 0 for k in ("total", "saleable", "landowner", "other_categories", "held", "held_expiring_48h", "blocked", "booked", "sold", "available", "shown_as_sold_masked")}
    c.pop("_id", None)
    if not privileged:
        # DISPLAY layer only: no masked/booked/blocked buckets — a masked flat counts under "sold" exactly as it is shown; Hidden flats are not counted.
        disp = await db.flats.aggregate([{"$match": {**match, "is_active": True}}, {"$group": {"_id": status_key(None), "n": {"$sum": 1}}}]).to_list(None)
        by = {r["_id"]: r["n"] for r in disp}
        hidden = by.pop(None, 0)
        c = {"total": c["total"] - hidden, "saleable": c["saleable"], "landowner": c["landowner"], "other_categories": c["other_categories"],
             "available": by.get("Available", 0), "held": by.get("Hold", 0), "sold": by.get("Sold", 0),
             "held_expiring_48h": await db.flats.count_documents({**match, "is_active": True, "status": "Hold", "display_override": {"$ne": True}, "hold.expires_at": {"$lte": soon}})}
    return c


async def expire_holds(actor: dict | None = None) -> dict:
    """HOLD_EXPIRY_SWEEP: releases expired holds one flat at a time (isolated), notifies the hold owner + RM 24 h before and on release."""
    from services import job_runs
    from routers.notifications import notify_users
    from utils import write_audit
    now = datetime.now(timezone.utc)
    now_s, soon_s = now.isoformat(), (now + timedelta(hours=24)).isoformat()

    async def gen():
        async for f in db.flats.find({"status": "Hold", "hold.expires_at": {"$lte": soon_s}}, {"_id": 0}).batch_size(200):
            yield f

    async def one(f):
        h = f.get("hold") or {}
        owners = [u for u in (h.get("for_user_id"), h.get("created_by")) if u]
        if h["expires_at"] <= now_s:
            await db.flats.update_one({"id": f["id"], "status": "Hold"}, {"$set": {"status": "Available", "hold": None, "status_changed_at": now_s, "status_changed_by": None, "status_reason": "Hold expired", "updated_at": now_s}, "$inc": {"version": 1}})
            await write_audit(actor or {"id": None, "company_id": f["company_id"], "full_name": "Hold expiry sweep"}, "flat.hold_expired", "flat", f["id"], before={"status": "Hold", "hold": h}, after={"status": "Available", "flat_number": f["flat_number"]})
            await notify_users(f["company_id"], owners, "Hold expired — unit released", f"{f['flat_number']}: hold expired at {h['expires_at'][:16].replace('T', ' ')} and the unit is Available again", "flat.hold_expired", "flat", f["id"], link=f"/blocks/{f['block_id']}?flat={f['id']}")
            return "released"
        if not h.get("expiry_warned"):
            await db.flats.update_one({"id": f["id"]}, {"$set": {"hold.expiry_warned": True}})
            await notify_users(f["company_id"], owners, "Hold expiring within 24 h", f"{f['flat_number']}: hold expires at {h['expires_at'][:16].replace('T', ' ')} — extend or convert to booking", "flat.hold_expiring", "flat", f["id"], link=f"/blocks/{f['block_id']}?flat={f['id']}")
            return "warned"
        return "noop"
    return await job_runs.run_isolated("HOLD_EXPIRY_SWEEP", gen(), one, item_id=lambda f: f["id"])
