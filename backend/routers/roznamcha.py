from datetime import date as Date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from db import db
from deps import project_scope_filter, require
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


async def _cash_refunds(company_id: str, q: dict) -> int:
    r = await db.refunds.aggregate([{"$match": {"company_id": company_id, "status": "Paid", "mode": "CASH", "parent_refund_id": None, **q}}, {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$amount_total_paise", "$amount_paise"]}}}}]).to_list(1)
    return r[0]["s"] if r else 0


async def _cash_in_hand_before(company_id: str, day: Date, scope: dict) -> int:
    """Opening cash = latest opening-balance entry on/before the day + cash receipts − deposits + withdrawals − cash refunds since that entry."""
    before = day.isoformat()
    ob = await db.cash_openings.find_one({"company_id": company_id, "date": {"$lte": before}}, {"_id": 0}, sort=[("date", -1)])
    lo = {"$gte": ob["date"]} if ob else {}
    rec = await db.payments.aggregate([{"$match": {"company_id": company_id, "payment_mode_code": "CASH", "status": {"$in": ["Cleared", "Reversed"]}, "payment_date": {**lo, "$lt": before}, **scope}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    rev = await db.payments.aggregate([{"$match": {"company_id": company_id, "payment_mode_code": "CASH", "status": "Reversed", "reversal.at": {**({"$gte": ob["date"]} if ob else {}), "$lt": before}, **scope}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    contra = await db.contra_entries.aggregate([{"$match": {"company_id": company_id, "date": {**lo, "$lt": before}}}, {"$group": {"_id": "$kind", "s": {"$sum": "$amount_paise"}}}]).to_list(None)
    cmap = {c["_id"]: c["s"] for c in contra}
    return (ob["amount_paise"] if ob else 0) + (rec[0]["s"] if rec else 0) - (rev[0]["s"] if rev else 0) - cmap.get("DEPOSIT", 0) + cmap.get("WITHDRAWAL", 0) - await _cash_refunds(company_id, {"paid_date": {**lo, "$lt": before}})


async def cash_in_hand_on(company_id: str, day: Date, scope: dict) -> int:
    """Closing cash of `day` (used by the cash payout guard)."""
    return await _cash_in_hand_before(company_id, day + timedelta(days=1), scope)


@router.get("/opening")
async def get_opening(user: dict = Depends(require("finance.roznamcha.view"))):
    items = await db.cash_openings.find({"company_id": user["company_id"]}, {"_id": 0}).sort("date", -1).to_list(50)
    return present_money({"items": items, "total": len(items)})


@router.post("/opening", status_code=201)
async def set_opening(body: OpeningIn, request: Request, user: dict = Depends(require("finance.roznamcha.opening_balance"))):
    doc = {"id": new_id(), "company_id": user["company_id"], "date": body.date.isoformat(), "amount_paise": to_paise(body.amount), "remarks": body.remarks, "created_at": now_iso(), "created_by": user["id"], "created_by_name": user["name"]}
    prev = await db.cash_openings.find_one({"company_id": user["company_id"], "date": doc["date"]}, {"_id": 0})
    await db.cash_openings.update_one({"company_id": user["company_id"], "date": doc["date"]}, {"$set": doc}, upsert=True)
    await write_audit(user, "roznamcha.opening", "roznamcha", doc["id"], before=prev, after=doc, ip=client_ip(request))
    return present_money(doc)


@router.get("")
async def day_book(date_: Date = Query(..., alias="date"), date_to: Date | None = None, user: dict = Depends(require("finance.roznamcha.view"))):
    return await _book(date_, date_to or date_, user)


@router.get("/range")
async def day_book_range(date_from: Date, date_to: Date, user: dict = Depends(require("finance.roznamcha.view"))):
    if date_to < date_from or (date_to - date_from) > timedelta(days=92):
        raise ApiError(422, "Range must be ascending and at most 92 days", "VALIDATION_ERROR")
    return await _book(date_from, date_to, user)


async def _book(d1: Date, d2: Date, user: dict) -> dict:
    cid, scope = user["company_id"], project_scope_filter(user)
    opening = await _cash_in_hand_before(cid, d1, scope)
    q = {"company_id": cid, "payment_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}, "status": {"$in": ["Cleared", "Pending", "Reversed"]}, **scope}
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
    contra = await db.contra_entries.find({"company_id": cid, "date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}}, {"_id": 0}).sort("date", 1).to_list(500)
    cash_received = sum(r["amount_paise"] for r in cleared if r["payment_mode_code"] == "CASH")
    deposits = sum(c["amount_paise"] for c in contra if c["kind"] == "DEPOSIT")
    withdrawals = sum(c["amount_paise"] for c in contra if c["kind"] == "WITHDRAWAL")
    refunds_cash = await _cash_refunds(cid, {"paid_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}})
    refunds_all = await db.refunds.aggregate([{"$match": {"company_id": cid, "status": "Paid", "parent_refund_id": None, "paid_date": {"$gte": d1.isoformat(), "$lte": d2.isoformat()}}}, {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$amount_total_paise", "$amount_paise"]}}}}]).to_list(1)
    reversals = await db.payments.find({"company_id": cid, "status": "Reversed", "reversal.at": {"$gte": d1.isoformat(), "$lte": d2.isoformat() + "T23:59:59.999999+00:00"}, **scope}, {"_id": 0}).sort("reversal.at", 1).to_list(500)
    cash_reversed = sum(r["amount_paise"] for r in reversals if r["payment_mode_code"] == "CASH")
    closing = opening + cash_received - deposits + withdrawals - refunds_cash - cash_reversed
    return present_money({
        "refunds_paise": refunds_all[0]["s"] if refunds_all else 0, "cash_refunds_paise": refunds_cash,
        "date_from": d1.isoformat(), "date_to": d2.isoformat(),
        "opening_cash_paise": opening, "cash_received_paise": cash_received, "bank_deposits_paise": deposits, "cash_withdrawals_paise": withdrawals, "closing_cash_paise": closing,
        "total_receipts_paise": sum(r["amount_paise"] for r in cleared), "pending_paise": sum(r["amount_paise"] for r in receipts if r["status"] == "Pending"),
        "by_mode": by_mode, "by_category": {k: {"amount_paise": v} for k, v in by_cat.items()}, "by_project": by_project,
        "receipts": receipts, "contra": contra, "reversals": reversals, "cash_reversed_paise": cash_reversed,
    })


@router.post("/contra", status_code=201)
async def contra(body: ContraIn, request: Request, user: dict = Depends(require("finance.roznamcha.deposit"))):
    bank = await get_or_404(db.bank_accounts, body.bank_account_id, "Bank account", {"is_active": True})
    amt = to_paise(body.amount)
    if body.kind == "DEPOSIT":
        available = await _cash_in_hand_before(user["company_id"], body.date + timedelta(days=1), {})
        if amt > available:
            raise ApiError(409, f"Cash in hand on {body.date} is only ₹{available / 100:,.2f}", "INSUFFICIENT_CASH")
    doc = {**base_doc(user, user["company_id"]), "date": body.date.isoformat(), "kind": body.kind, "amount_paise": amt, "bank_account_id": bank["id"], "bank_name": bank["bank_name"], "remarks": body.remarks, "by_name": user["name"]}
    await db.contra_entries.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "roznamcha.contra", "contra_entry", doc["id"], after=doc, ip=client_ip(request))
    return present_money(doc)
