"""REQ-243…256 Waiver with owner approval. The ONLY new money effect of phase 3E: an approved waiver is a Jama credit
(never a receipt — not in Roznamcha / Collections). Instalment waivers are at share level (Cash / Account) and settle
oldest-first exactly like a receipt; an Account-share waiver also credits the GST-on-agreement line by W × GST %.
Other-charge waivers credit their own line (oldest part first). Pending = no money effect."""

from datetime import date

from db import db
from services import clock
from services.breakdown import AGR_GST_CODE
from services.numbering import financial_year, generate_number
from utils import ApiError, new_id, now_iso


def gst_rate(b: dict) -> float:
    line = next((x for x in b.get("other_charges") or [] if x.get("code") == AGR_GST_CODE), None)
    if not line or not b.get("agreement_value_paise"):
        return 0.0
    return round(100 * line["total_paise"] / b["agreement_value_paise"], 2)


def open_of(b: dict, target: dict) -> int:
    s = b.get("summary") or {}
    if target["kind"] == "share":
        return max(s.get("cash_due_paise" if target["share"] == "Cash" else "account_due_paise", 0), 0)
    line = next((x for x in b.get("other_charges") or [] if x["line_id"] == target["line_id"]), None)
    if not line:
        raise ApiError(404, "Charge line not found", "NOT_FOUND")
    return max(line.get("demanded_paise", 0) - line.get("paid_paise", 0), 0)


def entries_for(b: dict, target: dict, amount: int) -> tuple[list[dict], dict]:
    """The Jama credits an approval posts, plus the GST note shown on the credit note."""
    if target["kind"] == "share" and target["share"] == "Cash":
        return [{"bucket": "Cash", "amount_paise": amount}], {"gst_paise": 0, "text": "Cash share — no GST"}
    if target["kind"] == "share":
        rate = gst_rate(b)
        g = round(amount * rate / 100)
        out = [{"bucket": "Account", "amount_paise": amount}]
        gst_line = next((x for x in b.get("other_charges") or [] if x.get("code") == AGR_GST_CODE), None)
        note = {"gst_paise": 0, "rate": rate, "text": "No GST on agreement"}
        if g and gst_line:
            open_g = max(gst_line.get("demanded_paise", 0) - gst_line.get("paid_paise", 0), 0)
            out.append({"bucket": "Other", "line_id": gst_line["line_id"], "amount_paise": g, "gst": True})
            held = max(g - open_g, 0)
            note = {
                "gst_paise": g,
                "rate": rate,
                "held_as_advance_paise": held,
                "text": f"₹{g / 100:,.2f} GST credit ({rate:g}%)"
                + (f" · ₹{held / 100:,.2f} held as advance" if held else ""),
            }
        return out, note
    line = next(x for x in b["other_charges"] if x["line_id"] == target["line_id"])
    p = line.get("gst_percent") or 0
    g = round(amount * p / (100 + p)) if p else 0
    return [{"bucket": "Other", "line_id": line["line_id"], "amount_paise": amount}], {
        "gst_paise": g,
        "rate": p,
        "text": f"includes ₹{g / 100:,.2f} GST ({p:g}%)" if g else "No GST on this charge",
    }


def section34(b: dict, w: dict, company: dict) -> dict:
    """GST Section 34: a credit note may adjust GST only until 30 Nov after the FY of the supply (the bill date)."""
    if not (w.get("gst_note") or {}).get("gst_paise"):
        return {"gst_adjustable": False, "text": "Commercial only — no GST in this credit"}
    supply = min([s["bill_day"] for s in w.get("settles") or [] if s.get("bill_day")] or [w["approved_on"]])
    fy = financial_year(date.fromisoformat(supply), company.get("financial_year_start_month") or 4)
    end_year = 2000 + int(fy[2:])  # FY "2627" ends Mar 2027 → limit 30 Nov 2027
    limit = date(end_year, 11, 30).isoformat()
    ok = w["approved_on"] <= limit
    return {
        "gst_adjustable": ok,
        "limit": limit,
        "text": f"GST adjustable until 30 Nov {end_year}" if ok else "Commercial only (GST time limit passed)",
    }


async def next_waiver_number(company: dict) -> str:
    return await generate_number("waiver", company, clock.today(), 4)


async def credit_note_number(company: dict) -> str:
    return await generate_number("credit_note", company, clock.today(), 4)


def new_request(b: dict, target: dict, amount: int, reason: str, note: str | None, user: dict, number: str) -> dict:
    return {
        "id": new_id(),
        "company_id": b["company_id"],
        "waiver_number": number,
        "booking_id": b["id"],
        "booking_number": b["booking_number"],
        "customer_id": b["customer_id"],
        "customer_name": b.get("customer_name"),
        "project_id": b["project_id"],
        "block_id": b.get("block_id"),
        "target": target,
        "target_label": target.get("label"),
        "amount_paise": amount,
        "reason": reason,
        "note": note,
        "status": "Pending",
        "requested_at": now_iso(),
        "requested_on": clock.today().isoformat(),
        "requested_by": user["id"],
        "requested_by_name": user["name"],
        "history": [{"at": now_iso(), "by": user["name"], "action": "requested"}],
    }


async def settled_bills(booking_id: str, before: dict) -> list[dict]:
    """Bills whose paid amount grew on approval — what the credit actually settled (oldest-first)."""
    out = []
    async for d in db.demands.find(
        {"booking_id": booking_id, "voided": {"$ne": True}},
        {"_id": 0, "id": 1, "demand_number": 1, "paid_paise": 1, "posted_at": 1, "due_date": 1},
    ).sort("posted_at", 1):
        grew = (d.get("paid_paise") or 0) - before.get(d["id"], 0)
        if grew > 0:
            out.append(
                {"demand_number": d["demand_number"], "amount_paise": grew, "bill_day": clock.day_of(d["posted_at"])}
            )
    return out
