from datetime import date as Date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from db import db
from deps import project_scope_filter, require
from services.money import present_money, to_paise
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, write_audit

router = APIRouter(prefix="/roznamcha", tags=["roznamcha"])


class ContraIn(StrictModel):
    date: Date
    kind: Literal["DEPOSIT", "WITHDRAWAL"]
    amount: float = Field(gt=0)
    bank_account_id: str
    remarks: str | None = Field(default=None, max_length=300)


async def _cash_in_hand_before(company_id: str, day: Date, scope: dict) -> int:
    before = day.isoformat()
    rec = await db.payments.aggregate([{"$match": {"company_id": company_id, "payment_mode_code": "CASH", "status": "Cleared", "payment_date": {"$lt": before}, **scope}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    contra = await db.contra_entries.aggregate([{"$match": {"company_id": company_id, "date": {"$lt": before}}}, {"$group": {"_id": "$kind", "s": {"$sum": "$amount_paise"}}}]).to_list(None)
    cmap = {c["_id"]: c["s"] for c in contra}
    return (rec[0]["s"] if rec else 0) - cmap.get("DEPOSIT", 0) + cmap.get("WITHDRAWAL", 0)


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
    closing = opening + cash_received - deposits + withdrawals
    return present_money({
        "date_from": d1.isoformat(), "date_to": d2.isoformat(),
        "opening_cash_paise": opening, "cash_received_paise": cash_received, "bank_deposits_paise": deposits, "cash_withdrawals_paise": withdrawals, "closing_cash_paise": closing,
        "total_receipts_paise": sum(r["amount_paise"] for r in cleared), "pending_paise": sum(r["amount_paise"] for r in receipts if r["status"] == "Pending"),
        "by_mode": by_mode, "by_category": {k: {"amount_paise": v} for k, v in by_cat.items()}, "by_project": by_project,
        "receipts": receipts, "contra": contra,
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
