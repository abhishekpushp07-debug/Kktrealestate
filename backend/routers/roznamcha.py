from datetime import date as Date
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from db import db
from deps import project_scope_filter, require
from services import clock
from services.cash_position import LIVE_OPENING, _cash_in_hand_before, _cash_refunds, cash_in_hand_on  # noqa: F401
from services.money import present_money, to_paise
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, new_id, now_iso, write_audit

router = APIRouter(prefix="/roznamcha", tags=["roznamcha"])


class ContraIn(StrictModel):
    date: Date
    kind: Literal["DEPOSIT", "WITHDRAWAL"]
    amount: float = Field(gt=0)
    bank_account_id: str
    remarks: str | None = Field(default=None, max_length=300)


class OpeningIn(StrictModel):
    date: Date
    amount: float = Field(ge=0)
    remarks: str | None = Field(default=None, max_length=300)


@router.get("/opening")
async def get_opening(user: dict = Depends(require("finance.roznamcha.view"))):
    items = await db.cash_openings.find({"company_id": user["company_id"]}, {"_id": 0}).sort("date", -1).to_list(50)
    return present_money({"items": items, "total": len(items)})


@router.post("/opening", status_code=201)
async def set_opening(
    body: OpeningIn, request: Request, user: dict = Depends(require("finance.roznamcha.opening_balance"))
):
    doc = {
        "id": new_id(),
        "company_id": user["company_id"],
        "date": body.date.isoformat(),
        "amount_paise": to_paise(body.amount),
        "remarks": body.remarks,
        "created_at": now_iso(),
        "created_by": user["id"],
        "created_by_name": user["name"],
    }
    prev = await db.cash_openings.find_one(
        {"company_id": user["company_id"], "date": doc["date"], **LIVE_OPENING}, {"_id": 0}
    )
    if prev:
        raise ApiError(
            409,
            f"Opening cash for {doc['date']} is already set — undo it first, then post the correct one",
            "OPENING_EXISTS",
        )
    await db.cash_openings.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "roznamcha.opening", "roznamcha", doc["id"], after=doc, ip=client_ip(request))
    return present_money(doc)


class UndoIn(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


def _undo_marks(user: dict, reason: str) -> dict:
    return {
        "reversed_at": now_iso(),
        "reversed_by": user["id"],
        "reversed_by_name": user["name"],
        "reverse_reason": reason,
    }


@router.post("/opening/{opening_id}/undo", status_code=201)
async def undo_opening(
    opening_id: str, body: UndoIn, request: Request, user: dict = Depends(require("finance.roznamcha.opening_balance"))
):
    """REQ-227: append-only — the wrong opening is marked undone and a reversing record is posted; nothing is edited."""
    o = await get_or_404(db.cash_openings, opening_id, "Opening entry", {"company_id": user["company_id"]})
    if o.get("reversed_at") or o.get("reverses_id"):
        raise ApiError(409, "This opening entry is already undone", "ALREADY_REVERSED")
    rev = {
        "id": new_id(),
        "company_id": user["company_id"],
        "date": o["date"],
        "amount_paise": -o["amount_paise"],
        "reverses_id": o["id"],
        "remarks": f"Undo: {body.reason}",
        "created_at": now_iso(),
        "created_by": user["id"],
        "created_by_name": user["name"],
    }
    await db.cash_openings.insert_one(rev)
    rev.pop("_id", None)
    await db.cash_openings.update_one({"id": o["id"]}, {"$set": _undo_marks(user, body.reason)})
    await write_audit(user, "roznamcha.opening_undo", "roznamcha", o["id"], before=o, after=rev, ip=client_ip(request))
    return present_money(rev)


@router.get("")
async def day_book(
    date_: Date = Query(..., alias="date"),
    date_to: Date | None = None,
    user: dict = Depends(require("finance.roznamcha.view")),
):
    return await _book(date_, date_to or date_, user)


@router.get("/range")
async def day_book_range(date_from: Date, date_to: Date, user: dict = Depends(require("finance.roznamcha.view"))):
    if date_to < date_from or (date_to - date_from) > timedelta(days=92):
        raise ApiError(422, "Range must be ascending and at most 92 days", "VALIDATION_ERROR")
    return await _book(date_from, date_to, user)


async def _book(d1: Date, d2: Date, user: dict) -> dict:
    cid, scope = user["company_id"], project_scope_filter(user)
    opening = await _cash_in_hand_before(cid, d1, scope)
    q = {
        "company_id": cid,
        "payment_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()},
        "status": {"$in": ["Cleared", "Pending", "Reversed"]},
        **scope,
    }
    receipts = await db.payments.find(q, {"_id": 0}).sort([("payment_date", 1), ("receipt_number", 1)]).to_list(2000)
    cleared = [r for r in receipts if r["status"] == "Cleared"]
    by_mode, by_cat, by_project = {}, {"Cash": 0, "Account": 0, "Other charges": 0}, {}
    for r in cleared:
        m = by_mode.setdefault(r["payment_mode_name"], {"count": 0, "amount_paise": 0})
        m["count"] += 1
        m["amount_paise"] += r["amount_paise"]
        key = r["payment_category"] if r["against"] == "FLAT_VALUE" else "Other charges"
        by_cat[key] = by_cat.get(key, 0) + r["amount_paise"]
        pr = by_project.setdefault(r.get("project_code") or "—", {"count": 0, "amount_paise": 0})
        pr["count"] += 1
        pr["amount_paise"] += r["amount_paise"]
    contra = (
        await db.contra_entries.find(
            {"company_id": cid, "date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}}, {"_id": 0}
        )
        .sort("date", 1)
        .to_list(500)
    )
    cash_received = sum(
        r["amount_paise"]
        for r in receipts
        if r["payment_mode_code"] == "CASH" and r["status"] in ("Cleared", "Reversed")
    )  # a cash receipt reversed later is still cash that came in; the reversal is a separate outflow below
    deposits = sum(c["amount_paise"] for c in contra if c["kind"] == "DEPOSIT")
    withdrawals = sum(c["amount_paise"] for c in contra if c["kind"] == "WITHDRAWAL")
    refunds_cash = await _cash_refunds(cid, {"paid_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}})
    refund_rows = (
        await db.refunds.find(
            {
                "company_id": cid,
                "status": "Paid",
                "parent_refund_id": None,
                "paid_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()},
            },
            {"_id": 0, "split": 0},
        )
        .sort([("paid_date", 1), ("refund_number", 1)])
        .to_list(500)
    )
    for r in refund_rows:
        r["paid_out_paise"] = r.get("amount_total_paise") or r.get("amount_paise") or 0
    refunds_all = await db.refunds.aggregate(
        [
            {
                "$match": {
                    "company_id": cid,
                    "status": "Paid",
                    "parent_refund_id": None,
                    "paid_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()},
                }
            },
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$amount_total_paise", "$amount_paise"]}}}},
        ]
    ).to_list(1)
    reversals = (
        await db.payments.find(
            {
                "company_id": cid,
                "status": "Reversed",
                "reversal.at": clock.day_range(d1, d2),
                **scope,
            },
            {"_id": 0},
        )
        .sort("reversal.at", 1)
        .to_list(500)
    )
    cash_reversed = sum(r["amount_paise"] for r in reversals if r["payment_mode_code"] == "CASH")
    closing = opening + cash_received - deposits + withdrawals - refunds_cash - cash_reversed
    return present_money(
        {
            "refunds_paise": refunds_all[0]["s"] if refunds_all else 0,
            "cash_refunds_paise": refunds_cash,
            "date_from": d1.isoformat(),
            "date_to": d2.isoformat(),
            "opening_cash_paise": opening,
            "cash_received_paise": cash_received,
            "bank_deposits_paise": deposits,
            "cash_withdrawals_paise": withdrawals,
            "closing_cash_paise": closing,
            "total_receipts_paise": sum(r["amount_paise"] for r in cleared),
            "pending_paise": sum(r["amount_paise"] for r in receipts if r["status"] == "Pending"),
            "by_mode": by_mode,
            "by_category": {k: {"amount_paise": v} for k, v in by_cat.items()},
            "by_project": by_project,
            "receipts": receipts,
            "contra": contra,
            "opening_entries": await db.cash_openings.find(
                {"company_id": cid, "date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}}, {"_id": 0}
            )
            .sort("created_at", 1)
            .to_list(50),
            "reversals": reversals,
            "cash_reversed_paise": cash_reversed,
            "refunds": refund_rows,
            # every rupee of physical cash that left the drawer today: opening + in − out = closing
            "cash_paid_out_paise": deposits + refunds_cash + cash_reversed,
        }
    )


@router.post("/contra", status_code=201)
async def contra(body: ContraIn, request: Request, user: dict = Depends(require("finance.roznamcha.deposit"))):
    bank = await get_or_404(db.bank_accounts, body.bank_account_id, "Bank account", {"is_active": True})
    amt = to_paise(body.amount)
    if body.kind == "DEPOSIT":
        available = await _cash_in_hand_before(user["company_id"], body.date + timedelta(days=1), {})
        if amt > available:
            raise ApiError(409, f"Cash in hand on {body.date} is only ₹{available / 100:,.2f}", "INSUFFICIENT_CASH")
    doc = {
        **base_doc(user, user["company_id"]),
        "date": body.date.isoformat(),
        "kind": body.kind,
        "amount_paise": amt,
        "bank_account_id": bank["id"],
        "bank_name": bank["bank_name"],
        "remarks": body.remarks,
        "by_name": user["name"],
    }
    await db.contra_entries.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "roznamcha.contra", "contra_entry", doc["id"], after=doc, ip=client_ip(request))
    return present_money(doc)


@router.post("/contra/{contra_id}/undo", status_code=201)
async def undo_contra(
    contra_id: str, body: UndoIn, request: Request, user: dict = Depends(require("finance.roznamcha.deposit"))
):
    """REQ-227: posts a reversing entry on the same day (same kind, minus the amount); the original stays as it was."""
    c = await get_or_404(db.contra_entries, contra_id, "Contra entry", {"company_id": user["company_id"]})
    if c.get("reversed_at") or c.get("reverses_id"):
        raise ApiError(409, "This entry is already undone", "ALREADY_REVERSED")
    if c["kind"] == "WITHDRAWAL":  # undoing a withdrawal takes that cash back out of hand
        day = Date.fromisoformat(c["date"])
        available = await _cash_in_hand_before(user["company_id"], day + timedelta(days=1), {})
        if c["amount_paise"] > available:
            raise ApiError(
                409, f"Cash in hand on {c['date']} is only ₹{available / 100:,.2f} — cannot undo", "INSUFFICIENT_CASH"
            )
    rev = {
        **base_doc(user, user["company_id"]),
        "date": c["date"],
        "kind": c["kind"],
        "amount_paise": -c["amount_paise"],
        "bank_account_id": c["bank_account_id"],
        "bank_name": c.get("bank_name"),
        "remarks": f"Undo: {body.reason}",
        "reverses_id": c["id"],
        "by_name": user["name"],
    }
    await db.contra_entries.insert_one(rev)
    rev.pop("_id", None)
    await db.contra_entries.update_one({"id": c["id"]}, {"$set": _undo_marks(user, body.reason)})
    await write_audit(
        user, "roznamcha.contra_undo", "contra_entry", c["id"], before=c, after=rev, ip=client_ip(request)
    )
    return present_money(rev)
