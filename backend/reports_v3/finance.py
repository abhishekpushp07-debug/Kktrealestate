"""Phase 3F Finance: extra row fields for filtering only (bank, mode, shares, days in hand, bands…). They are looked
up from the same payments / bookings the existing report read; no money figure is changed or re-derived."""

import asyncio

from db import db
from services import clock
from services import definitions as D


async def _payments(user: dict, receipts: list[str]) -> dict:
    proj = {"_id": 0, "receipt_number": 1, "payment_mode_name": 1, "bank_account_name": 1, "instrument": 1}
    proj |= {"payment_date": 1, "cleared_at": 1, "status": 1, "payment_mode_code": 1, "bounced_at": 1}
    q = {"company_id": user["company_id"], "receipt_number": {"$in": receipts}}
    return {p["receipt_number"]: p async for p in db.payments.find(q, proj)}


async def collections(user, rows, ctx):
    rn = {r["group"]: r["group"].removesuffix(" (reversal)") for r in rows}  # a reversal row keeps its receipt's mode
    ready = all("pay_info" in r for r in rows)
    pays = {} if ready else await _payments(user, list(set(rn.values())))
    for r in rows:
        p = r.pop("pay_info", None) if ready else pays.get(rn[r["group"]]) or {}
        ins = p.get("instrument") or {}
        r["bank"] = ins.get("bank") or p.get("bank_account_name") or ("Cash" if r.get("cash_paise") else "Not recorded")
        r["mode"] = p.get("payment_mode_name") or r.get("tag") or "—"
        cash = (r.get("payment_mode_code") or p.get("payment_mode_code")) == "CASH"
        r["cash_mode_paise"], r["bank_mode_paise"] = (r["total_paise"], 0) if cash else (0, r["total_paise"])
        r["shares"] = [k for k in ("cash", "account", "other") if r.get(f"{k}_paise")]
        r["is_regular"] = not r.get("reversal_paise")
    return rows


async def cheques(user, rows, ctx):
    ready = all("pay_info" in r for r in rows)
    pays = {} if ready else await _payments(user, [r["receipt_number"] for r in rows])
    today = ctx["as_of"]
    for r in rows:
        p = r.pop("pay_info", None) if ready else pays.get(r["receipt_number"]) or {}
        r["received_on"] = p.get("payment_date")
        r["_pay"] = {k: p.get(k) for k in ("payment_date", "status", "payment_mode_code", "cleared_at", "bounced_at")}
        r["cleared_on"] = clock.day_of(p.get("cleared_at"))
        if r.get("status") == "Pending":
            r["status"] = "In hand"
        pending = r.get("status") == "In hand"
        r["days_in_hand"] = (
            (today - __import__("datetime").date.fromisoformat(p["payment_date"])).days
            if pending and p.get("payment_date")
            else 0
        )
    return rows


async def outstanding(user, rows, ctx):
    from reports_v3.customers import customer_status

    base = {b["booking_id"]: b for b in await customer_status(user, ctx)}
    for r in rows:
        r["bands"] = [b for b in ("Not due", "0-30", "31-60", "61-90", "90+") if r.get(f"band_{b}")]
        r["is_overdue"] = bool(r.get("overdue_paise"))
        r["days_overdue"] = (base.get(r.get("booking_id")) or {}).get("days_overdue", 0)
    return rows


async def day_book(user, rows, ctx):
    for r in rows:
        r["books"] = [
            b
            for b, on in (
                (
                    "cash",
                    r.get("cash_in_paise")
                    or r.get("deposit_paise")
                    or r.get("withdrawal_paise")
                    or r.get("cash_refund_paise"),
                ),
                ("bank", r.get("bank_in_paise") or r.get("deposit_paise")),
            )
            if on
        ]
    return rows


async def other_charges(user, rows, ctx):
    q = {"company_id": user["company_id"], "id": {"$in": [r.get("booking_id") for r in rows]}}
    heads = {
        b["id"]: sorted({l.get("name") for l in b.get("other_charges") or [] if l.get("name")})
        async for b in db.bookings.find(q, {"_id": 0, "id": 1, "other_charges.name": 1})
    }
    for r in rows:
        r["heads"] = heads.get(r.get("booking_id"), [])
    return rows


async def outstanding_asof(user, ctx):
    """F7: Outstanding & ageing on any As-of date through the one definitions path (Customer status rows: shares as of
    D, ageing_bands as of D, incl. other-charge parts and waivers); bill raised / received = ledger Udhar / Jama to D."""
    from reports_v3.customers import BAND_KEYS, customer_status

    wv = {"$in": ["$type", ["WAIVER", "WAIVER_REVERSAL"]]}
    grp = {
        "_id": "$booking_id",
        "u": {"$sum": "$udhar_paise"},
        "j": {"$sum": "$jama_paise"},
        "w": {"$sum": {"$cond": [wv, "$jama_paise", 0]}},
    }

    async def ledger_sums():
        # 3I: read beside customer_status for every booking booked by the as-of day (a superset of the live rows;
        # sums are per booking, so only the live rows' values are looked up)
        ids = await db.bookings.distinct(
            "id", {"company_id": user["company_id"], "booking_date": {"$lte": ctx["as_of"].isoformat()}}
        )
        q = {"booking_id": {"$in": ids}, "date": {"$lte": ctx["as_of"].isoformat()}}
        return await db.ledger_entries.aggregate([{"$match": q}, {"$group": grp}]).to_list(None)

    status_rows, led_l, hand_l = await asyncio.gather(
        customer_status(user, ctx),
        ledger_sums(),
        D.cheques_in_hand({"company_id": user["company_id"]}, ctx["as_of"].isoformat()),
    )
    rows = [r for r in status_rows if r["live"]]
    led = {d["_id"]: d for d in led_l}
    hand: dict = {}  # REQ-334: dated on / before the day, cleared after it → in hand, still owed
    for p in hand_l:
        h = hand.setdefault(p["booking_id"], [0, 0])
        h[0], h[1] = h[0] + p["amount_paise"], h[1] + 1
    out = []
    for r in rows:
        l = led.get(r["booking_id"]) or {}
        bands = {k: r[v] for k, v in BAND_KEYS.items()}
        out.append(
            r
            | {
                "unit": r["flat_code"],
                "udhar_paise": l.get("u", 0),
                "jama_paise": l.get("j", 0) - l.get("w", 0),
                "waived_paise": l.get("w", 0),
                "outstanding_paise": r["total_due"],
                "advance_paise": r["advance_total"],
                "net_balance_paise": r["total_due"] - r["advance_total"],
                **{f"band_{k}": v for k, v in bands.items()},
                "overdue_paise": r["overdue_amount"],
                "bands": [k for k, v in bands.items() if v],
                "is_overdue": bool(r["overdue_amount"]),
                "promise": "",
                "in_hand_paise": (hand.get(r["booking_id"]) or [0, 0])[0],
                "in_hand_n": (hand.get(r["booking_id"]) or [0, 0])[1],
            }
        )
    return out
