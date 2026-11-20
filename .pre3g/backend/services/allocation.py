"""Phase S3.1 — automatic receipt allocation: oldest open bill first across instalments and charge lines.
Instalment share bucket comes from the mode (Cash → Cash bucket, else Account); charge lines are always Account.
Remainder beyond all open bills is recorded as ADVANCE in the instalment bucket (existing advance semantics)."""

from db import db
from services import clock


def _demand_bucket_open(demands: list[dict], cash_paid: int, account_paid: int) -> list[dict]:
    """Per-demand open amount per bucket using the same FIFO (by posted_at) the ledger uses for demand statuses."""
    out, cum_c, cum_a = [], 0, 0
    for d in sorted(demands, key=lambda x: x["posted_at"]):
        prev_c, prev_a = cum_c, cum_a
        cum_c += d["cash_demand_paise"]
        cum_a += d["account_demand_paise"]
        paid_c = min(max(cash_paid - prev_c, 0), d["cash_demand_paise"])
        paid_a = min(max(account_paid - prev_a, 0), d["account_demand_paise"])
        out.append(
            {**d, "_open_cash": d["cash_demand_paise"] - paid_c, "_open_account": d["account_demand_paise"] - paid_a}
        )
    return out


async def open_items(booking: dict, bucket: str) -> list[dict]:
    """Open bills of a booking payable by a receipt in `bucket`, oldest due first."""
    s = booking.get("summary") or {}
    demands = await db.demands.find(
        {"booking_id": booking["id"], "voided": {"$ne": True}, "status": {"$nin": ["Cancelled", "Voided"]}}, {"_id": 0}
    ).to_list(None)  # FIFO needs paid ones too
    items = []
    for d in _demand_bucket_open(demands, s.get("cash_paid_paise", 0), s.get("account_paid_paise", 0)):
        open_p = d["_open_cash"] if bucket == "Cash" else d["_open_account"]
        if open_p > 0:
            items.append(
                {
                    "kind": "FLAT_VALUE",
                    "category": bucket,
                    "demand_id": d["id"],
                    "demand_number": d["demand_number"],
                    "name": d.get("installment_name") or d.get("milestone_name") or d["demand_number"],
                    "due_date": d.get("due_date") or d.get("demand_date") or "",
                    "posted_at": d["posted_at"],
                    "open_paise": open_p,
                }
            )
    for l in booking.get("other_charges") or []:
        open_p = (l.get("demanded_paise") or 0) - (l.get("paid_paise") or 0)
        if l.get("demanded_at") and open_p > 0:
            items.append(
                {
                    "kind": "OTHER_CHARGE",
                    "category": "Account",
                    "line_id": l["line_id"],
                    "name": l["name"],
                    "due_date": clock.day_of(l.get("due_date") or l["demanded_at"]),
                    "posted_at": l["demanded_at"],
                    "open_paise": open_p,
                }
            )
    items.sort(key=lambda i: (i["due_date"], i["posted_at"]))
    return items


async def plan(booking: dict, amount_paise: int, bucket: str) -> dict:
    """Allocate `amount_paise` oldest-first; leftover → ADVANCE in `bucket`."""
    items, allocs, left = await open_items(booking, bucket), [], amount_paise
    for it in items:
        if left <= 0:
            break
        take = min(left, it["open_paise"])
        allocs.append(
            {k: it[k] for k in ("kind", "category", "name")}
            | {k: it[k] for k in ("demand_id", "demand_number", "line_id", "due_date") if k in it}
            | {"amount_paise": take, "open_paise": it["open_paise"]}
        )
        left -= take
    if left > 0:
        allocs.append({"kind": "ADVANCE", "category": bucket, "name": "Advance (no open bill)", "amount_paise": left})
    return {
        "bucket": bucket,
        "allocations": allocs,
        "advance_paise": left,
        "open_total_paise": sum(i["open_paise"] for i in items),
        "open_count": len(items),
    }


def bucket_parts(allocs: list[dict]) -> dict:
    """{Cash: paise, Account: paise, lines: {line_id: paise}} from an allocation list."""
    parts = {"Cash": 0, "Account": 0, "lines": {}}
    for a in allocs:
        if a["kind"] == "OTHER_CHARGE":
            parts["lines"][a["line_id"]] = parts["lines"].get(a["line_id"], 0) + a["amount_paise"]
        else:
            parts[a["category"]] += a["amount_paise"]
    return parts


def explode(p: dict) -> list[dict]:
    """Split one payment doc with `allocations` into per-allocation pseudo-payments for the ledger engine. Unsplit docs pass through."""
    if not p.get("allocations"):
        return [p]
    out = []
    for a in p["allocations"]:
        if a["kind"] == "OTHER_CHARGE":
            out.append(
                {
                    **p,
                    "against": "OTHER_CHARGE",
                    "payment_category": None,
                    "other_charge_line_id": a["line_id"],
                    "amount_paise": a["amount_paise"],
                    "_alloc_note": a["name"],
                }
            )
        else:
            out.append(
                {
                    **p,
                    "against": "FLAT_VALUE",
                    "payment_category": a["category"],
                    "other_charge_line_id": None,
                    "amount_paise": a["amount_paise"],
                    "_alloc_note": a.get("demand_number") or a["name"],
                }
            )
    return out
