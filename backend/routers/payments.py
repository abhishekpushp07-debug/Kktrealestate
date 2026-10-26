import asyncio
from datetime import UTC, date as Date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator

from crypto import decrypt_field, mask
from db import db
from models_out import PaymentsOut, PaymentsOutPage
from deps import require_idempotency_key, ensure_project_access, project_scope_filter, require
from services.ledger import CLEAR_IMMEDIATELY, bucket_paid, line_paid, rebuild
from services.money import amount_in_words, inr, present_money, to_paise
from services.numbering import generate_number
from uow import unit_of_work
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    base_doc,
    client_ip,
    get_or_404,
    now_iso,
    paginate,
    search_filter,
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/payments", tags=["payments"])


class Instrument(StrictModel):
    number: str | None = None
    date: Date | None = None
    bank_name: str | None = None
    branch: str | None = None


class PaymentIn(StrictModel):
    booking_id: str
    against: Literal["FLAT_VALUE", "OTHER_CHARGE"] = "FLAT_VALUE"
    payment_category: Literal["Cash", "Account"] | None = None
    other_charge_line_id: str | None = None
    amount: float = Field(gt=0)
    payment_date: Date
    payment_mode_id: str
    instrument: Instrument | None = None
    bank_account_id: str | None = None
    remarks: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _rules(self):
        if self.against == "FLAT_VALUE" and not self.payment_category:
            raise ValueError("payment_category (Cash/Account) is required for flat value payments")
        if self.against == "OTHER_CHARGE" and not self.other_charge_line_id:
            raise ValueError("other_charge_line_id is required for other-charge payments")
        if self.payment_date > datetime.now(UTC).date():
            raise ValueError("payment_date cannot be in the future")
        return self


class ReasonIn(StrictModel):
    reason: str = Field(min_length=3, max_length=500)


def _cap_error(category: str, agreed: int, paid: int, amount: int):
    return ApiError(409, f"{category} bucket agreed {inr(agreed)}; already received {inr(paid)}; cannot accept {inr(amount)}. Revise agreement first.", "BUCKET_EXCEEDS_AGREED",
                    {"category": category, "agreed_paise": agreed, "paid_paise": paid, "amount_paise": amount, "headroom_paise": agreed - paid})


async def _check_cap(booking: dict, p: dict):
    """Soft pre-check (fast, friendly error). The atomic guard is `reserve_cap`."""
    if booking["status"] != "Active":
        raise ApiError(409, f"Booking is {booking['status']}; payments are not accepted", "BOOKING_NOT_ACTIVE")
    if p["against"] == "FLAT_VALUE":
        cat = p["payment_category"]
        agreed = booking["cash_agreed_paise"] if cat == "Cash" else booking["account_agreed_paise"]
        paid = await bucket_paid(booking["id"], cat)
        if paid + p["amount_paise"] > agreed:
            raise _cap_error(cat, agreed, paid, p["amount_paise"])
    else:
        line = next((l for l in booking.get("other_charges") or [] if l["line_id"] == p["other_charge_line_id"]), None)
        if not line:
            raise ApiError(404, "Other charge line not found on booking", "NOT_FOUND")
        paid = await line_paid(booking["id"], line["line_id"])
        if paid + p["amount_paise"] > line["total_paise"]:
            raise ApiError(409, f"{line['name']}: total {inr(line['total_paise'])}; already received {inr(paid)}; cannot accept {inr(p['amount_paise'])}.", "CHARGE_EXCEEDS_TOTAL")


async def reserve_cap(booking: dict, p: dict) -> dict:
    """Atomic bucket cap: a guarded conditional update on the booking's paid counters (summary.* / other_charges.$.paid_paise)
    increments the counter only while `paid + amount <= agreed`. Two concurrent posts can never both pass. Returns the inverse
    update (compensation) to apply if the payment insert fails."""
    amt = p["amount_paise"]
    if p["against"] == "FLAT_VALUE":
        cat = p["payment_category"]
        agreed = booking["cash_agreed_paise"] if cat == "Cash" else booking["account_agreed_paise"]
        field = "summary.cash_paid_paise" if cat == "Cash" else "summary.account_paid_paise"
        inc = {field: amt, "summary.paid_paise": amt}
        res = await db.bookings.update_one({"id": booking["id"], "status": "Active", field: {"$lte": agreed - amt}}, {"$inc": inc})
        if not res.matched_count:
            fresh = await db.bookings.find_one({"id": booking["id"]}, {"_id": 0, "status": 1, "summary": 1})
            if not fresh or fresh["status"] != "Active":
                raise ApiError(409, "Booking is not active; payments are not accepted", "BOOKING_NOT_ACTIVE")
            raise _cap_error(cat, agreed, (fresh.get("summary") or {}).get(field.split(".")[1], 0), amt)
        return {"$inc": {k: -v for k, v in inc.items()}}
    line = next((l for l in booking.get("other_charges") or [] if l["line_id"] == p["other_charge_line_id"]), None)
    if not line:
        raise ApiError(404, "Other charge line not found on booking", "NOT_FOUND")
    res = await db.bookings.update_one({"id": booking["id"], "status": "Active", "other_charges": {"$elemMatch": {"line_id": line["line_id"], "paid_paise": {"$lte": line["total_paise"] - amt}}}},
                                       {"$inc": {"other_charges.$.paid_paise": amt}})
    if not res.matched_count:
        raise ApiError(409, f"{line['name']}: total {inr(line['total_paise'])}; already received {inr(await line_paid(booking['id'], line['line_id']))}; cannot accept {inr(amt)}.", "CHARGE_EXCEEDS_TOTAL")
    return {"$inc": {"other_charges.$[l].paid_paise": -amt}, "_af": [{"l.line_id": line["line_id"]}]}


async def _compensate(booking_id: str, comp: dict):
    af = comp.pop("_af", None)
    await db.bookings.update_one({"id": booking_id}, comp, **({"array_filters": af} if af else {}))


async def _payment_totals(q: dict) -> dict:
    agg = await db.payments.aggregate([{"$match": q}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "s": {"$sum": "$amount_paise"}}}]).to_list(None)
    return present_money({a["_id"]: {"count": a["n"], "amount_paise": a["s"]} for a in agg})


@router.get("/demands")
async def list_open_demands(params: ListParams = Depends(), status: str | None = None, project_id: str | None = None, user: dict = Depends(require("finance.demand.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), "voided": {"$ne": True}, **search_filter(params.search, ["customer_name", "demand_number", "booking_number"])}
    if status:
        q["status"] = {"$in": status.split(",")}
    if project_id:
        q["project_id"] = project_id
    res = await paginate(db.demands, q, params, params.sort_spec(["due_date", "demand_date", "total_demand_paise", "customer_name"], "due_date"))
    res["items"] = present_money(res["items"])
    return res


@router.get("/summary")
async def payments_summary(params: ListParams = Depends(), project_id: str | None = None, block_id: str | None = None, booking_id: str | None = None, customer_id: str | None = None,
                           status: str | None = None, payment_category: str | None = None, payment_mode_id: str | None = None, date_from: Date | None = None, date_to: Date | None = None,
                           user: dict = Depends(require("finance.payment.view"))):
    """Filter-wide totals by status (same filters as the list) for the totals footer."""
    return await list_payments(params, project_id, block_id, booking_id, customer_id, status, payment_category, payment_mode_id, date_from, date_to, user, summary_only=True)


@router.get("", response_model=PaymentsOutPage, response_model_exclude_unset=True)
async def list_payments(params: ListParams = Depends(), project_id: str | None = None, block_id: str | None = None, booking_id: str | None = None, customer_id: str | None = None,
                        status: str | None = None, payment_category: str | None = None, payment_mode_id: str | None = None, date_from: Date | None = None, date_to: Date | None = None,
                        user: dict = Depends(require("finance.payment.view")), summary_only: bool = False):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["receipt_number", "customer_name", "booking_number", "flat_number", "instrument.number"])}
    for k, v in (("project_id", project_id), ("block_id", block_id), ("booking_id", booking_id), ("customer_id", customer_id), ("payment_category", payment_category), ("payment_mode_id", payment_mode_id)):
        if v:
            q[k] = v
    if status:
        q["status"] = {"$in": status.split(",")}
    if date_from or date_to:
        q["payment_date"] = {**({"$gte": date_from.isoformat()} if date_from else {}), **({"$lte": date_to.isoformat()} if date_to else {})}
    if summary_only:
        return await _payment_totals(q)
    res, totals = await asyncio.gather(paginate(db.payments, q, params, params.sort_spec(["payment_date", "receipt_number", "amount_paise", "status", "created_at"], "-payment_date")), _payment_totals(q))
    res["totals"] = totals
    from services.includes import expand
    res["items"] = present_money(await expand(res["items"], params.include, "payments"))
    if res.pop("_csv", False):
        return Response(to_csv([{**i, "instrument_number": (i.get("instrument") or {}).get("number")} for i in res["items"]], ["receipt_number", "payment_date", "customer_name", "booking_number", "flat_number", "against", "payment_category", "payment_mode_name", "instrument_number", "amount", "status"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=payments.csv"})
    return res


@router.post("", status_code=201)
async def post_payment(body: PaymentIn, request: Request, user: dict = Depends(require("finance.payment.create")), _k: None = Depends(require_idempotency_key)):
    booking = await get_or_404(db.bookings, body.booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, booking["project_id"])
    if body.payment_date.isoformat() < booking["booking_date"]:
        raise ApiError(422, "payment_date cannot be before booking_date", "VALIDATION_ERROR")
    mode = await get_or_404(db.payment_modes, body.payment_mode_id, "Payment mode", {"is_active": True})
    if mode.get("requires_reference") and not (body.instrument and body.instrument.number):
        raise ApiError(422, f"{mode['name']} requires instrument/reference number", "VALIDATION_ERROR")
    bank = None
    if mode["code"] != "CASH":
        if not body.bank_account_id:
            raise ApiError(422, "bank_account_id (company account credited) is required for non-cash modes", "VALIDATION_ERROR")
        bank = await get_or_404(db.bank_accounts, body.bank_account_id, "Bank account", {"is_active": True})
    status = "Cleared" if mode["code"] in CLEAR_IMMEDIATELY else "Pending"
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    ts = now_iso()
    inst = body.instrument.model_dump() if body.instrument else None
    if inst and isinstance(inst.get("date"), Date):
        inst["date"] = inst["date"].isoformat()
    line = next((l for l in booking.get("other_charges") or [] if l["line_id"] == body.other_charge_line_id), None) if body.against == "OTHER_CHARGE" else None
    p = {**base_doc(user, user["company_id"]), "receipt_number": await generate_number("receipt", company, body.payment_date, 5), "booking_id": booking["id"], "booking_number": booking["booking_number"],
         "customer_id": booking["customer_id"], "customer_name": booking["customer_name"], "project_id": booking["project_id"], "project_code": booking.get("project_code"), "block_id": booking["block_id"], "block_code": booking.get("block_code"),
         "flat_id": booking["flat_id"], "flat_number": booking["flat_snapshot"]["flat_number"], "against": body.against, "payment_category": body.payment_category if body.against == "FLAT_VALUE" else None,
         "other_charge_line_id": body.other_charge_line_id if body.against == "OTHER_CHARGE" else None, "other_charge_name": line["name"] if line else None,
         "amount_paise": to_paise(body.amount), "payment_date": body.payment_date.isoformat(), "payment_mode_id": mode["id"], "payment_mode_code": mode["code"], "payment_mode_name": mode["name"],
         "instrument": inst, "bank_account_id": bank["id"] if bank else None, "bank_account_name": f"{bank['bank_name']} {mask(decrypt_field(bank.get('account_number_enc')))}" if bank else None,
         "remarks": body.remarks, "received_by": user["id"], "received_by_name": user["name"], "status": status, "cleared_at": ts if status == "Cleared" else None, "bounced_at": None, "reversal": None,
         "idempotency_key": request.headers.get("idempotency-key"), "posted_at": ts}
    await _check_cap(booking, p)
    comp = await reserve_cap(booking, p) if status == "Cleared" else None
    try:
        await db.payments.insert_one(p)
    except Exception:
        if comp:
            await _compensate(booking["id"], comp)
        raise
    p.pop("_id", None)
    await rebuild(booking["id"])
    await write_audit(user, "payment.post", "payment", p["id"], after={k: p[k] for k in ("id", "receipt_number", "amount_paise", "payment_category", "against", "status", "payment_mode_name")}, ip=client_ip(request))
    await write_audit(user, "payment.post", "booking", booking["id"], after={"receipt_number": p["receipt_number"], "amount_paise": p["amount_paise"], "category": p["payment_category"], "status": status}, ip=client_ip(request))
    return present_money(p)


@router.get("/cheques-in-hand")
async def cheques_in_hand(user: dict = Depends(require("finance.payment.view"))):
    q = {"company_id": user["company_id"], "status": "Pending", **project_scope_filter(user)}
    items = await db.payments.find(q, {"_id": 0}).sort("payment_date", 1).to_list(500)
    return present_money({"items": items, "total": len(items), "amount_paise": sum(i["amount_paise"] for i in items)})


@router.get("/{payment_id}", response_model=PaymentsOut, response_model_exclude_unset=True)
async def get_payment(payment_id: str, user: dict = Depends(require("finance.payment.view"))):
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    ensure_project_access(user, p["project_id"])
    return present_money(p)


@router.get("/{payment_id}/receipt")
async def receipt(payment_id: str, user: dict = Depends(require("finance.receipt.print"))):
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    ensure_project_access(user, p["project_id"])
    b = await db.bookings.find_one({"id": p["booking_id"]}, {"_id": 0, "booking_number": 1, "flat_snapshot": 1, "project_name": 1, "block_name": 1, "agreement_value_paise": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1})
    customer = await db.customers.find_one({"id": p["customer_id"]}, {"_id": 0, "full_name": 1, "salutation": 1, "address_current": 1, "phone": 1, "customer_code": 1})
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "bank_account": 0})
    row = await db.ledger_entries.find_one({"booking_id": p["booking_id"], "ref": p["receipt_number"], "type": {"$in": ["PAYMENT", "OTHER_CHARGE_PAYMENT"]}}, {"_id": 0})
    return present_money({"payment": p, "booking": b, "customer": customer, "company": company, "amount_in_words": amount_in_words(p["amount_paise"]), "after": row,
                          "cancelled": p["status"] == "Reversed", "subject_to_realisation": p["status"] == "Pending" or p.get("payment_mode_code") in ("CHEQUE", "DD")})


@router.post("/{payment_id}/clear")
async def clear_payment(payment_id: str, request: Request, user: dict = Depends(require("finance.cheque.clear"))):
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    if p["status"] != "Pending":
        raise ApiError(409, f"Payment is {p['status']}", "NOT_PENDING")
    booking = await get_or_404(db.bookings, p["booking_id"], "Booking")
    await _check_cap(booking, p)
    comp = await reserve_cap(booking, p)
    ts = now_iso()
    res = await db.payments.update_one({"id": payment_id, "status": "Pending"}, {"$set": {"status": "Cleared", "cleared_at": ts, "cleared_by": user["id"], "posted_at": ts, "updated_at": ts}, "$inc": {"version": 1}})
    if not res.matched_count:
        await _compensate(booking["id"], comp)
        raise ApiError(409, "Payment is no longer pending", "NOT_PENDING")
    await rebuild(p["booking_id"])
    await write_audit(user, "payment.clear", "payment", payment_id, before={"status": "Pending"}, after={"status": "Cleared", "receipt_number": p["receipt_number"]}, ip=client_ip(request))
    return present_money(await db.payments.find_one({"id": payment_id}, {"_id": 0}))


@router.post("/{payment_id}/bounce")
async def bounce_payment(payment_id: str, body: ReasonIn, request: Request, user: dict = Depends(require("finance.cheque.bounce"))):
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    if p["status"] != "Pending":
        raise ApiError(409, f"Payment is {p['status']}; only pending instruments can bounce", "NOT_PENDING")
    ts = now_iso()
    await db.payments.update_one({"id": payment_id}, {"$set": {"status": "Bounced", "bounced_at": ts, "bounce_reason": body.reason, "updated_at": ts}, "$inc": {"version": 1}})
    await rebuild(p["booking_id"])
    await write_audit(user, "payment.bounce", "payment", payment_id, before={"status": "Pending"}, after={"status": "Bounced", "reason": body.reason, "receipt_number": p.get("receipt_number"), "customer_name": p.get("customer_name")}, ip=client_ip(request))
    return present_money(await db.payments.find_one({"id": payment_id}, {"_id": 0}))


@router.post("/{payment_id}/reverse")
async def reverse_payment(payment_id: str, body: ReasonIn, request: Request, user: dict = Depends(require("finance.payment.reverse"))):
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    if p["status"] != "Cleared":
        raise ApiError(409, f"Only cleared payments can be reversed (status {p['status']})", "NOT_CLEARED")
    ts = now_iso()
    rev = {"reason": body.reason, "at": ts, "by": user["id"], "by_name": user["name"]}
    async with unit_of_work() as uow:
        await db.payments.update_one({"id": payment_id, "status": "Cleared"}, {"$set": {"status": "Reversed", "reversal": rev, "receipt_cancelled": True, "updated_at": ts}, "$inc": {"version": 1}}, **uow.kw())
        if p["against"] == "FLAT_VALUE":
            field = "summary.cash_paid_paise" if p["payment_category"] == "Cash" else "summary.account_paid_paise"
            await db.bookings.update_one({"id": p["booking_id"]}, {"$inc": {field: -p["amount_paise"], "summary.paid_paise": -p["amount_paise"]}}, **uow.kw())
    await rebuild(p["booking_id"])
    await write_audit(user, "payment.reverse", "payment", payment_id, before={"status": "Cleared"}, after={"status": "Reversed", **rev, "receipt_number": p["receipt_number"]}, ip=client_ip(request))
    await write_audit(user, "payment.reverse", "booking", p["booking_id"], after={"receipt_number": p["receipt_number"], "amount_paise": -p["amount_paise"], "reason": body.reason}, ip=client_ip(request))
    return present_money(await db.payments.find_one({"id": payment_id}, {"_id": 0}))
