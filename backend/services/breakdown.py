"""Phase PS.3 — booking value breakdown.

agreement value → agreement GST (project default %, editable per booking) → charges[] (each with own GST %, calc, timing) → total_final_value.
Charges live as `other_charges` lines (existing ledger bucket); agreement GST is a line coded AGR_GST demanded proportionally with stages
("stage" timing) so Cash/Account buckets keep splitting the agreement value exactly as before."""

from db import db
from services import clock
from services import pricing as P
from services.money import pct_of
from utils import new_id

AGR_GST_CODE = "AGR_GST"
TIMINGS = ("on_booking", "on_possession", "stage", "manual")


def _line(name, code, amount_paise, gst_percent, timing, *, head_id=None, calc="fixed", base=None, source=None) -> dict:
    gst = pct_of(amount_paise, gst_percent)
    return {
        "line_id": new_id(),
        "charge_type_id": head_id,
        "name": name,
        "code": code,
        "calc": calc,
        "base": base,
        "source": source,
        "amount_paise": amount_paise,
        "gst_percent": gst_percent,
        "gst_paise": gst,
        "total_paise": amount_paise + gst,
        "demand_at": timing,
        "demanded_paise": 0,
        "paid_paise": 0,
        "demanded_at": None,
    }


async def prelisted_lines(flat: dict, project: dict, agreement_value_paise: int) -> list[dict]:
    """Project-enabled heads + one parking line per attached slot + maintenance from the flat's method. Nothing hidden: every line is visible/editable."""
    setup = P.setup_of(project)
    heads = {
        h["id"]: h
        for h in await db.charge_types.find(
            {"company_id": project["company_id"], "is_active": True}, {"_id": 0}
        ).to_list(None)
    }
    by_code = {h["code"]: h for h in heads.values()}
    sal = flat.get("saleable_sqft") or 0
    lines = []
    for s in setup.get("charge_heads") or []:
        h = heads.get(s["charge_type_id"])
        if not h or not s.get("enabled") or h["code"] in ("PARKING", "MAINT", "MAINT_DEPOSIT", "GST"):
            continue
        val = (
            s.get("value")
            if s.get("value") is not None
            else (h.get("default_value") if h.get("default_value") is not None else h.get("default_amount"))
        )
        if val is None:
            continue
        calc = h.get("calc_type") or "fixed"
        if calc == "per_sqft":
            amt, base = round(val * sal * 100), f"₹{val:g}/sq ft × {sal:g} sq ft"
        elif calc == "percent_of_agreement":
            amt, base = pct_of(agreement_value_paise, val), f"{val:g}% of agreement value"
        elif calc == "per_sqft_months":
            m = setup["maintenance"]
            amt, base = (
                round(val * (m.get("months") or 0) * sal * 100),
                f"₹{val:g} × {m.get('months') or 0} months × {sal:g} sq ft",
            )
        else:
            amt, base = round(val * 100), None
        gst = s.get("gst_percent") if s.get("gst_percent") is not None else h.get("default_gst_percent", 18)
        lines.append(
            _line(
                h["name"],
                h["code"],
                amt,
                gst,
                s.get("timing") or h.get("default_demand_timing") or "on_booking",
                head_id=h["id"],
                calc=calc,
                base=base,
            )
        )
    park = by_code.get("PARKING")
    for slot in await db.parking_slots.find(
        {"flat_id": flat["id"], "is_active": True}, {"_id": 0, "id": 1, "number": 1, "type": 1, "price": 1}
    ).to_list(50):
        lines.append(
            _line(
                f"Parking {slot['number']} ({slot.get('type') or 'slot'})",
                "PARKING",
                round((slot.get("price") or 0) * 100),
                (park or {}).get("default_gst_percent", 18),
                (park or {}).get("default_demand_timing") or "on_booking",
                head_id=(park or {}).get("id"),
                calc="fixed",
                source=f"parking:{slot['id']}",
            )
        )
    m = {**setup["maintenance"], **(flat.get("maintenance") or {})}
    maint_amt = P.maintenance_amount(flat, setup)
    if m.get("method") and m["method"] != "none" and maint_amt:
        mh = by_code.get("MAINT")
        base = (
            f"₹{m['rate_per_sqft']:g} × {m['months']} months × {sal:g} sq ft"
            if m["method"] == "per_sqft_months"
            else "fixed"
        )
        lines.append(
            _line(
                "Maintenance (advance)",
                "MAINT",
                round(maint_amt * 100),
                (mh or {}).get("default_gst_percent", 18),
                (mh or {}).get("default_demand_timing") or "on_possession",
                head_id=(mh or {}).get("id"),
                calc=m["method"],
                base=base,
                source="maintenance",
            )
        )
    return lines


def agreement_gst_line(agreement_value_paise: int, gst_percent: float, has_plan: bool) -> dict | None:
    if not gst_percent:
        return None
    return _line(
        f"GST on agreement value ({gst_percent:g}%)",
        AGR_GST_CODE,
        agreement_value_paise,
        0,
        "stage" if has_plan else "on_booking",
        calc="percent_of_agreement",
        base=f"{gst_percent:g}% of agreement value",
    ) | {
        "amount_paise": 0,
        "gst_paise": pct_of(agreement_value_paise, gst_percent),
        "gst_percent": gst_percent,
        "total_paise": pct_of(agreement_value_paise, gst_percent),
    }


def _normalise(l: dict) -> dict:
    """Legacy other_charges lines (pre-PS) may carry only amount/gst_percent (or rupee `amount`); derive the paise fields instead of failing."""
    if all(k in l for k in ("amount_paise", "gst_paise", "total_paise")):
        return l
    amount = l.get("amount_paise")
    if amount is None:
        amount = int(round(float(l.get("amount") or 0) * 100))
    gst_pct = float(l.get("gst_percent") or 0)
    gst = l.get("gst_paise")
    if gst is None:
        gst = pct_of(amount, gst_pct)
    return {
        **l,
        "amount_paise": amount,
        "gst_paise": gst,
        "total_paise": l.get("total_paise") if l.get("total_paise") is not None else amount + gst,
    }


def snapshot(agreement_value_paise: int, gst_percent: float, lines: list[dict], version: int = 1) -> dict:
    lines = [_normalise(l) for l in lines]
    charges = [l for l in lines if l.get("code") != AGR_GST_CODE]
    agr_gst = sum(l["total_paise"] for l in lines if l.get("code") == AGR_GST_CODE)
    add = sum(l["amount_paise"] for l in charges)
    gst_charges = sum(l["gst_paise"] for l in charges)
    return {
        "version": version,
        "agreement_value_paise": agreement_value_paise,
        "agreement_gst_percent": gst_percent,
        "agreement_gst_paise": agr_gst,
        "charges": [
            {
                k: l.get(k)
                for k in (
                    "line_id",
                    "name",
                    "code",
                    "calc",
                    "base",
                    "source",
                    "amount_paise",
                    "gst_percent",
                    "gst_paise",
                    "total_paise",
                    "demand_at",
                )
            }
            for l in charges
        ],
        "additional_charges_total_paise": add,
        "gst_total_paise": agr_gst + gst_charges,
        "total_final_value_paise": agreement_value_paise + agr_gst + add + gst_charges,
    }


def raise_stage_charges(
    booking: dict,
    cum_percent: float,
    at: str,
    stage_id: str | None = None,
    due: str | None = None,
    bill_day: str | None = None,
) -> list[dict]:
    """Lines with timing 'stage' are demanded proportionally to the cumulative raised %. Each increment is kept in `demand_history`
    (one ledger row per increment; undo of a stage pops its increment)."""
    lines, changed = booking.get("other_charges") or [], False
    for l in lines:
        if l.get("demand_at") != "stage":
            continue
        target = min(l["total_paise"], pct_of(l["total_paise"], cum_percent))
        delta = target - (l.get("demanded_paise") or 0)
        if delta > 0:
            l["demanded_paise"], l["demanded_at"], changed = target, l.get("demanded_at") or at, True
            l.setdefault("demand_history", []).append(  # REQ-205/206: a part with its own due date
                {
                    "at": at,
                    "bill_day": bill_day or (clock.day_of(at) if at != "preview" else None),
                    "paise": delta,
                    "stage_id": stage_id,
                    "cum_percent": cum_percent,
                    "due_on": due,
                }
            )
    return lines if changed else []


def unwind_stage_charges(booking: dict, stage_id: str) -> list[dict]:
    """Undo of a construction stage: remove that stage's increments from every 'stage' line."""
    lines, changed = booking.get("other_charges") or [], False
    for l in lines:
        hist = l.get("demand_history") or []
        keep = [h for h in hist if h.get("stage_id") != stage_id]
        if len(keep) != len(hist):
            l["demand_history"], changed = keep, True
            l["demanded_paise"] = sum(h["paise"] for h in keep)
            l["demanded_at"] = keep[0]["at"] if keep else None
    return lines if changed else []


async def migrate_bookings():
    """Existing bookings: agreement_gst_percent = 0, total_final_value = agreement + existing other charges incl. GST. Ledger numbers untouched.
    A malformed legacy line logs a warning for that booking and never fails the step."""
    import logging

    log = logging.getLogger("kkt.migrate")
    async for b in db.bookings.find(
        {"pricing": {"$exists": False}},
        {"_id": 0, "id": 1, "booking_number": 1, "agreement_value_paise": 1, "other_charges": 1},
    ):
        try:
            snap = snapshot(b.get("agreement_value_paise") or 0, 0, b.get("other_charges") or [])
        except Exception as e:  # noqa: BLE001
            log.warning("migrate_bookings: %s skipped (%s)", b.get("booking_number") or b["id"], e)
            continue
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"pricing": snap}})
