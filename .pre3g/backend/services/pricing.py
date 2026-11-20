"""Phase PS — flat pricing rules.

Owner rules: one area field (saleable_sqft); price = rate × saleable or lump sum; nothing is pre-filled silently — type defaults are
applied only through an explicit action; Booked/Sold flats are locked individually (STATUS_LOCKED), never a whole floor/tower."""

from db import db
from utils import ApiError, now_iso

LOCKED_STATUSES = {"Booked", "Sold"}
MAINT_METHODS = ("per_sqft_months", "fixed", "none")
DEFAULT_SETUP = {
    "agreement_gst_percent": 5.0,
    "floor_rise_enabled": False,
    "rounding": "none",
    "maintenance": {"method": "none", "rate_per_sqft": None, "months": None, "fixed_amount": None},
    "charge_heads": [],
}

SEED_CHARGE_HEADS = [  # (name, code, calc_type, default_value, gst %, timing)
    ("Parking", "PARKING", "fixed", None, 18, "on_booking"),
    ("Maintenance (advance)", "MAINT", "per_sqft_months", None, 18, "on_possession"),
    ("Club membership", "CLUB", "fixed", 100000, 18, "on_booking"),
    ("Legal & documentation", "LEGAL", "fixed", 15000, 18, "on_booking"),
    ("Development charges", "DEV", "per_sqft", None, 18, "on_booking"),
    ("Electricity & water connection", "ELEC_WATER", "fixed", 50000, 18, "on_possession"),
    ("Other", "OTHER", "fixed", None, 18, "manual"),
]


def setup_of(project: dict | None) -> dict:
    s = {**DEFAULT_SETUP, **((project or {}).get("pricing_setup") or {})}
    s["maintenance"] = {**DEFAULT_SETUP["maintenance"], **(s.get("maintenance") or {})}
    return s


def lock_of(flat: dict) -> dict | None:
    if flat.get("status") in LOCKED_STATUSES or flat.get("booking_id"):
        return {
            "reason": f"Locked by booking {flat.get('booking_number') or ''}".strip(),
            "booking_id": flat.get("booking_id"),
            "status": flat.get("status"),
        }
    return None


def ensure_unlocked(flat: dict):
    lock = lock_of(flat)
    if lock:
        raise ApiError(
            409,
            f"{flat['flat_number']} is {flat['status']} — {lock['reason']}. Use the agreement-revision flow.",
            "STATUS_LOCKED",
            lock,
        )


def _round(v: float, rule: str) -> float:
    if rule == "nearest_100":
        return round(v / 100) * 100
    if rule == "nearest_1000":
        return round(v / 1000) * 1000
    return round(v, 2)


def compute(flat: dict, block: dict, setup: dict) -> dict:
    """Derive price_paise / breakup / pricing_status from the flat's own saleable_sqft, pricing_mode and rate (or lump sum)."""
    sal, mode = flat.get("saleable_sqft"), flat.get("pricing_mode") or "rate"
    out = {}
    if mode == "rate":
        rate = flat.get("rate_per_sqft")
        if sal and rate is not None:
            rise = (block.get("floor_rise_per_sqft") or 0) if setup.get("floor_rise_enabled") else 0
            rise_floors = max(0, (flat.get("floor") or 0) - block.get("floor_start", 1))
            breakup = [{"label": f"Rate ₹{rate:g}/sq ft × {sal:g} sq ft", "amount": round(rate * sal, 2)}]
            if rise and rise_floors:
                breakup.append(
                    {
                        "label": f"Floor rise ₹{rise:g} × {rise_floors} floors × {sal:g}",
                        "amount": round(rise * rise_floors * sal, 2),
                    }
                )
            price = _round(sum(b["amount"] for b in breakup), setup.get("rounding") or "none")
            out.update(price_paise=round(price * 100), price_breakup=breakup, price_source="rate")
        else:
            out.update(price_paise=None, price_breakup=[], price_source="rate")
    else:
        if flat.get("price_paise") is not None:
            out.update(
                price_breakup=[{"label": "Lump sum price", "amount": flat["price_paise"] / 100}],
                price_source="lump_sum",
            )
    price = out.get("price_paise", flat.get("price_paise"))
    out["pricing_status"] = "ready" if (sal and price) else "pending"
    return out


def maintenance_amount(flat: dict, setup: dict) -> float | None:
    m = {**setup["maintenance"], **(flat.get("maintenance") or {})}
    if m.get("method") == "fixed":
        return m.get("fixed_amount")
    if (
        m.get("method") == "per_sqft_months"
        and flat.get("saleable_sqft")
        and m.get("rate_per_sqft")
        and m.get("months")
    ):
        return round(m["rate_per_sqft"] * m["months"] * flat["saleable_sqft"], 2)
    return None


def type_defaults(ft: dict) -> dict:
    """Suggestions from the Flat Type master — used only via 'Apply type defaults'."""
    sal = ft.get("default_saleable_sqft")
    if sal is None:
        for a in ft.get("areas_snapshot") or []:
            if a.get("area_type_code") == "SUPER_BUILTUP":
                sal = a["value_sqft"]
    return {"saleable_sqft": sal, "rate_per_sqft": ft.get("base_rate_per_sqft")}


async def migrate_saleable():
    """Idempotent backfill: super_builtup_sqft → saleable_sqft; pricing_status for every flat."""
    await db.flats.update_many(
        {"saleable_sqft": {"$exists": False}, "super_builtup_sqft": {"$ne": None}},
        [{"$set": {"saleable_sqft": "$super_builtup_sqft"}}],
    )
    await db.flats.update_many({"saleable_sqft": {"$exists": False}}, {"$set": {"saleable_sqft": None}})
    await db.flats.update_many(
        {"pricing_status": {"$exists": False}, "saleable_sqft": {"$ne": None}, "price_paise": {"$ne": None}},
        {"$set": {"pricing_status": "ready"}},
    )
    await db.flats.update_many({"pricing_status": {"$exists": False}}, {"$set": {"pricing_status": "pending"}})
    await db.flats.update_many(
        {"pricing_mode": {"$exists": False}}, {"$set": {"pricing_mode": "rate", "maintenance": None}}
    )


async def ensure_area_types():
    """Fix 1: 'Super Built-up Area' → 'Saleable Area' (code kept); Carpet / Built-up hidden from pickers (rows kept)."""
    await db.area_types.update_many({"code": "SUPER_BUILTUP"}, {"$set": {"name": "Saleable Area"}})
    await db.area_types.update_many(
        {"code": {"$in": ["CARPET", "BUILTUP"]}, "hidden": {"$ne": True}}, {"$set": {"hidden": True}}
    )


async def dedupe_charge_heads():
    """PS.4: legacy 'Maintenance Deposit' merges into Maintenance (advance); standalone 'GST' head retired (GST is per line now)."""
    for cid in [c["id"] for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None)]:
        maint = await db.charge_types.find_one({"company_id": cid, "code": "MAINT"}, {"_id": 0, "id": 1})
        legacy = await db.charge_types.find_one(
            {"company_id": cid, "code": {"$in": ["MAINT_DEPOSIT", "MAINTENANCE"]}, "is_active": True},
            {"_id": 0, "id": 1, "default_amount": 1},
        )
        if maint and legacy:
            await db.charge_types.update_one(
                {"id": legacy["id"]},
                {"$set": {"is_active": False, "merged_into": maint["id"], "updated_at": now_iso()}},
            )
            await db.charge_types.update_one(
                {"id": maint["id"], "default_value": None}, {"$set": {"default_value": legacy.get("default_amount")}}
            )
        await db.charge_types.update_many(
            {"company_id": cid, "code": "GST", "is_active": True},
            {"$set": {"is_active": False, "retired_reason": "GST is applied per line", "updated_at": now_iso()}},
        )


async def ensure_charge_heads():
    """Seed the charge-head catalogue fields on charge_types (name, code, GST %, calc type, default value, timing) — editable by the owner."""
    for cid in [c["id"] for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None)]:
        ewc = await db.charge_types.find_one({"company_id": cid, "code": "EWC"}, {"_id": 0, "id": 1})
        if ewc:  # legacy code for the same head — retire the duplicate, never delete (bookings may reference it)
            await db.charge_types.update_many(
                {"company_id": cid, "code": "ELEC_WATER", "is_active": True},
                {"$set": {"is_active": False, "merged_into": ewc["id"], "updated_at": now_iso()}},
            )
        for i, (name, code, calc, val, gst, timing) in enumerate(SEED_CHARGE_HEADS):
            if code == "ELEC_WATER" and await db.charge_types.find_one(
                {"company_id": cid, "code": "EWC"}, {"_id": 0, "id": 1}
            ):
                continue
            ex = await db.charge_types.find_one({"company_id": cid, "code": code}, {"_id": 0, "id": 1, "calc_type": 1})
            if ex and ex.get("calc_type"):
                continue
            if ex:
                await db.charge_types.update_one(
                    {"id": ex["id"]},
                    {
                        "$set": {
                            "calc_type": calc,
                            "default_gst_percent": gst,
                            "default_demand_timing": timing,
                            "updated_at": now_iso(),
                        }
                    },
                )
            else:
                from utils import base_doc

                await db.charge_types.insert_one(
                    {
                        **base_doc(None, cid),
                        "name": name,
                        "code": code,
                        "default_amount": val,
                        "default_value": val,
                        "is_taxable": gst > 0,
                        "default_gst_percent": gst,
                        "calc_type": calc,
                        "default_demand_timing": timing,
                        "sort_order": 100 + i,
                    }
                )
