from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator

from db import db
from deps import ensure_project_access, project_scope_filter, require
from services.counters import apply_status_delta
from services.ledger import create_demand, raise_other_charges, rebuild
from services.money import pct_of, present_money, to_paise
from services.numbering import generate_number
from uow import guarded_update, unit_of_work
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    new_id,
    now_iso,
    paginate,
    search_filter,
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/bookings", tags=["bookings"])


class OtherChargeIn(StrictModel):
    charge_type_id: str
    amount: float = Field(ge=0)
    gst_percent: float = Field(default=0, ge=0, le=28)
    demand_at: Literal["on_booking", "on_possession", "manual"] = "on_booking"


class BookingIn(StrictModel):
    payment_plan_id: str | None = None
    plan_acceptance_mode: str = "In person"
    flat_id: str
    customer_id: str
    co_applicant_customer_ids: list[str] = []
    booking_date: date
    agreement_value: float = Field(gt=0)
    cash_agreed: float = Field(ge=0)
    account_agreed: float = Field(ge=0)
    other_charges: list[OtherChargeIn] = []
    parking_slot_ids: list[str] = []
    sales_user_id: str | None = None
    lead_id: str | None = None
    broker_name: str | None = None
    remarks: str | None = None

    @model_validator(mode="after")
    def _sum(self):
        if to_paise(self.cash_agreed) + to_paise(self.account_agreed) != to_paise(self.agreement_value):
            raise ValueError("cash_agreed + account_agreed must equal agreement_value exactly")
        if self.booking_date > datetime.now(UTC).date():
            raise ValueError("booking_date cannot be in the future")
        return self


class RevisionIn(StrictModel):
    cash_agreed: float = Field(ge=0)
    account_agreed: float = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)
    version: int | None = None


class CancelIn(StrictModel):
    reason: str = Field(min_length=3, max_length=500)
    deduction: float = Field(default=0, ge=0)
    refund: float = Field(default=0, ge=0)
    version: int | None = None


class CompleteIn(StrictModel):
    version: int | None = None
    notes: str | None = None


class ManualChargeDemandIn(StrictModel):
    line_id: str
    version: int | None = None


async def _load(booking_id: str, user: dict) -> dict:
    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    return b


def _present(b: dict) -> dict:
    return present_money(b)


@router.get("")
async def list_bookings(params: ListParams = Depends(), project_id: str | None = None, block_id: str | None = None, status: str | None = None,
                        customer_id: str | None = None, user: dict = Depends(require("booking.read"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["booking_number", "customer_name", "flat_snapshot.flat_number"])}
    for k, v in (("project_id", project_id), ("block_id", block_id), ("customer_id", customer_id)):
        if v:
            q[k] = v
    if status:
        q["status"] = {"$in": status.split(",")}
    res = await paginate(db.bookings, q, params, params.sort_spec(["booking_number", "booking_date", "created_at", "status", "customer_name"], "-booking_date"), {"agreement_revisions": 0, "milestone_template_snapshot": 0})
    res["items"] = present_money(res["items"])
    if res.pop("_csv", False):
        rows = [{**i, "flat_number": i["flat_snapshot"]["flat_number"], **{k: v for k, v in i["summary"].items() if not k.endswith("_paise")}} for i in res["items"]]
        return Response(to_csv(rows, ["booking_number", "booking_date", "customer_name", "project_code", "block_code", "flat_number", "status", "agreement_value", "cash_agreed", "account_agreed", "construction_percent", "cash_paid", "account_paid", "paid", "cash_due", "account_due", "due", "other_charges_due"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=bookings.csv"})
    return res


@router.post("", status_code=201)
async def create_booking(body: BookingIn, request: Request, user: dict = Depends(require("booking.create"))):
    flat = await get_or_404(db.flats, body.flat_id, "Flat")
    ensure_project_access(user, flat["project_id"])
    if flat["status"] not in ("Available", "Hold"):
        raise ApiError(409, f"Flat {flat['flat_number']} is {flat['status']}", "FLAT_NOT_AVAILABLE")
    if flat["status"] == "Hold" and flat.get("status_changed_by") not in (user["id"], None) and "settings.manage" not in user["permissions"]:
        raise ApiError(409, f"Flat {flat['flat_number']} is on Hold by another user", "FLAT_HELD_BY_OTHER")
    customer = await get_or_404(db.customers, body.customer_id, "Customer", {"company_id": user["company_id"], "is_active": True})
    if body.co_applicant_customer_ids and await db.customers.count_documents({"id": {"$in": body.co_applicant_customer_ids}}) != len(set(body.co_applicant_customer_ids)):
        raise ApiError(400, "Unknown co-applicant customer", "INVALID_CO_APPLICANT")
    block = await get_or_404(db.blocks, flat["block_id"], "Block")
    project = await get_or_404(db.projects, flat["project_id"], "Project")
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    milestones = block.get("milestones") or []
    if not milestones:
        mt = await db.milestone_templates.find_one({"id": block.get("milestone_template_id") or project.get("milestone_template_id")}, {"_id": 0})
        milestones = [{**m, "status": "Pending"} for m in (mt or {}).get("milestones", [])]
    from routers.construction import applicable_plans, build_snapshot
    plans = await applicable_plans(flat["project_id"], flat["block_id"])
    plan = next((p for p in plans if p["id"] == body.payment_plan_id), None) if body.payment_plan_id else (plans[0] if plans else None)
    if plans and not plan:
        raise ApiError(409, "Chosen payment plan is not assigned to this tower", "PLAN_NOT_APPLICABLE")
    if body.payment_plan_id and not plan:
        raise ApiError(404, "Payment plan not found", "NOT_FOUND")
    charges = []
    if body.other_charges:
        cts = {c["id"]: c for c in await db.charge_types.find({"id": {"$in": [c.charge_type_id for c in body.other_charges]}}, {"_id": 0}).to_list(None)}
        for c in body.other_charges:
            ct = cts.get(c.charge_type_id)
            if not ct:
                raise ApiError(400, "Unknown charge type", "INVALID_CHARGE_TYPE")
            amt = to_paise(c.amount)
            gst = pct_of(amt, c.gst_percent) if ct.get("is_taxable") else 0
            charges.append({"line_id": new_id(), "charge_type_id": ct["id"], "name": ct["name"], "code": ct["code"], "amount_paise": amt, "gst_percent": c.gst_percent if ct.get("is_taxable") else 0,
                            "gst_paise": gst, "total_paise": amt + gst, "demand_at": c.demand_at, "demanded_paise": 0, "paid_paise": 0, "demanded_at": None})
    if body.parking_slot_ids:
        free = await db.parking_slots.count_documents({"id": {"$in": body.parking_slot_ids}, "project_id": flat["project_id"], "status": "Available"})
        if free != len(set(body.parking_slot_ids)):
            raise ApiError(409, "One or more parking slots are not available", "PARKING_NOT_AVAILABLE")
    posted_at = now_iso()
    doc = {**base_doc(user, user["company_id"]), "booking_number": await generate_number("booking", company, body.booking_date),
           "project_id": flat["project_id"], "project_code": project["code"], "project_name": project["name"], "block_id": flat["block_id"], "block_code": block["code"], "block_name": block["name"], "flat_id": flat["id"],
           "customer_id": customer["id"], "customer_name": customer["full_name"], "customer_code": customer["customer_code"], "customer_phone": customer.get("phone"),
           "co_applicant_customer_ids": body.co_applicant_customer_ids, "booking_date": body.booking_date.isoformat(),
           "agreement_value_paise": to_paise(body.agreement_value), "cash_agreed_paise": to_paise(body.cash_agreed), "account_agreed_paise": to_paise(body.account_agreed),
           "rate_per_sqft": flat.get("rate_per_sqft"), "flat_snapshot": {"flat_number": flat["flat_number"], "flat_type_code": flat.get("flat_type_code"), "flat_type_id": flat.get("flat_type_id"), "super_builtup_sqft": flat.get("super_builtup_sqft"), "floor": flat.get("floor"), "price": flat.get("price")},
           "milestone_template_snapshot": [{"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"]} for m in milestones],
           "construction_percent": 0, "raised_percent": 0, "payment_plan_id": plan["id"] if plan else None, "payment_plan_snapshot": await build_snapshot(plan) if plan else None,
           "plan_acceptance": {"accepted_on": body.booking_date.isoformat(), "accepted_by_user_id": user["id"], "mode": body.plan_acceptance_mode} if plan else None, "other_charges": charges, "parking_slot_ids": body.parking_slot_ids, "sales_user_id": body.sales_user_id or user["id"], "lead_id": body.lead_id,
           "broker_name": body.broker_name, "remarks": body.remarks, "status": "Active", "cancellation": None, "agreement_revisions": [], "summary": {}}
    async with unit_of_work() as uow:
        upd = await guarded_update(db.flats, {"id": flat["id"], "status": {"$in": ["Available", "Hold"]}}, {"$set": {"status": "Booked", "booking_id": doc["id"], "status_changed_at": posted_at, "status_changed_by": user["id"], "updated_at": posted_at}, "$inc": {"version": 1}}, uow)
        if not upd:
            raise ApiError(409, f"Flat {flat['flat_number']} was just taken by another booking", "FLAT_NOT_AVAILABLE")
        uow.on_rollback(lambda: db.flats.update_one({"id": flat["id"]}, {"$set": {"status": flat["status"], "booking_id": None}}))
        await apply_status_delta(block["id"], project["id"], flat["status"], "Booked", uow.session)
        uow.on_rollback(lambda: apply_status_delta(block["id"], project["id"], "Booked", flat["status"]))
        if body.parking_slot_ids:
            await db.parking_slots.update_many({"id": {"$in": body.parking_slot_ids}}, {"$set": {"status": "Allotted", "booking_id": doc["id"], "customer_id": customer["id"], "updated_at": posted_at}}, **uow.kw())
            uow.on_rollback(lambda: db.parking_slots.update_many({"id": {"$in": body.parking_slot_ids}}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None}}))
        await db.bookings.insert_one(doc, **uow.kw())
        uow.on_rollback(lambda: db.bookings.delete_one({"id": doc["id"]}))
        doc.pop("_id", None)
        lines = raise_other_charges(doc, "on_booking", posted_at)
        if lines:
            doc["other_charges"] = lines
            await db.bookings.update_one({"id": doc["id"]}, {"$set": {"other_charges": lines}})
    if plan:
        from services.dues_engine import raise_due_installments
        await raise_due_installments(doc, posted_at=posted_at, actor=user)  # ON_BOOKING + catch-up on already-completed stages
    await rebuild(doc["id"])
    if body.lead_id:
        await db.leads.update_one({"id": body.lead_id}, {"$set": {"booking_id": doc["id"]}})
    after = await db.bookings.find_one({"id": doc["id"]}, {"_id": 0})
    await write_audit(user, "booking.create", "booking", doc["id"], after={k: after[k] for k in ("id", "booking_number", "customer_name", "flat_snapshot", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise")}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", flat["id"], before={"status": flat["status"]}, after={"status": "Booked", "booking_number": doc["booking_number"]}, ip=client_ip(request))
    return _present(after)


@router.get("/{booking_id}")
async def get_booking(booking_id: str, user: dict = Depends(require("booking.read"))):
    b = await _load(booking_id, user)
    import asyncio
    b["customer"], b["co_applicants"], b["parking_slots"], b["demands"], b["payments"], blk = await asyncio.gather(
        db.customers.find_one({"id": b["customer_id"]}, {"_id": 0, "id": 1, "customer_code": 1, "full_name": 1, "phone": 1, "email": 1, "address_current": 1, "kyc_status": 1}),
        db.customers.find({"id": {"$in": b.get("co_applicant_customer_ids") or []}}, {"_id": 0, "id": 1, "customer_code": 1, "full_name": 1, "phone": 1}).to_list(10),
        db.parking_slots.find({"id": {"$in": b.get("parking_slot_ids") or []}}, {"_id": 0, "id": 1, "number": 1, "type": 1, "level": 1, "status": 1}).to_list(20),
        db.demands.find({"booking_id": booking_id}, {"_id": 0}).sort("posted_at", 1).to_list(100),
        db.payments.find({"booking_id": booking_id}, {"_id": 0}).sort("posted_at", 1).to_list(500),
        db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "milestones": 1, "construction_percent": 1}))
    b["block_milestones"] = (blk or {}).get("milestones") or []
    return _present(b)


@router.get("/{booking_id}/ledger")
async def ledger(booking_id: str, format: str | None = None, user: dict = Depends(require("booking.read"))):
    b = await _load(booking_id, user)
    rows = await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0}).sort("seq", 1).to_list(1000)
    out = present_money(rows)
    if format == "csv":
        return Response(to_csv(out, ["seq", "date", "type", "construction_percent", "category", "amount", "ref", "note", "cash_paid_cum", "account_paid_cum", "cash_order_raised", "account_order_raised", "cash_due", "account_due", "total_due"]),
                        media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=ledger-{b['booking_number'].replace('/', '-')}.csv"})
    return {"booking": _present({k: b[k] for k in ("id", "booking_number", "customer_name", "flat_snapshot", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise", "construction_percent", "status", "summary")}), "rows": out, "total": len(out)}


@router.post("/{booking_id}/agreement-revisions")
async def revise_agreement(booking_id: str, body: RevisionIn, request: Request, user: dict = Depends(require("agreement.edit"))):
    b = await _load(booking_id, user)
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    new_c, new_a = to_paise(body.cash_agreed), to_paise(body.account_agreed)
    s = b.get("summary") or {}
    if new_c < s.get("cash_paid_paise", 0):
        raise ApiError(409, f"Cash agreed cannot be below cash already received ({present_money({'x_paise': s.get('cash_paid_paise', 0)})['x']})", "BELOW_PAID")
    if new_a < s.get("account_paid_paise", 0):
        raise ApiError(409, "Account agreed cannot be below account already received", "BELOW_PAID")
    if new_c == b["cash_agreed_paise"] and new_a == b["account_agreed_paise"]:
        raise ApiError(400, "No change in agreement values", "NO_CHANGES")
    rev = {"id": new_id(), "at": now_iso(), "by": user["id"], "by_name": user["name"], "reason": body.reason,
           "before": {"cash_agreed_paise": b["cash_agreed_paise"], "account_agreed_paise": b["account_agreed_paise"], "agreement_value_paise": b["agreement_value_paise"]},
           "after": {"cash_agreed_paise": new_c, "account_agreed_paise": new_a, "agreement_value_paise": new_c + new_a}}
    ver = expected_version(request, body.version)
    q = {"id": booking_id, **({"version": ver} if ver is not None else {})}
    after = await db.bookings.find_one_and_update(q, {"$set": {"cash_agreed_paise": new_c, "account_agreed_paise": new_a, "agreement_value_paise": new_c + new_a, "updated_at": now_iso()}, "$push": {"agreement_revisions": rev}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not after:
        raise ApiError(409, "Booking was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    await rebuild(booking_id)
    await write_audit(user, "booking.agreement_revision", "booking", booking_id, before=rev["before"], after={**rev["after"], "reason": body.reason, "booking_number": b["booking_number"]}, ip=client_ip(request))
    return _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))


@router.post("/{booking_id}/cancel")
async def cancel_booking(booking_id: str, body: CancelIn, request: Request, user: dict = Depends(require("booking.cancel"))):
    b = await _load(booking_id, user)
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is already {b['status']}", "BOOKING_NOT_ACTIVE")
    paid = (b.get("summary") or {}).get("paid_paise", 0) + (b.get("summary") or {}).get("other_charges_paid_paise", 0)
    refund, ded = to_paise(body.refund), to_paise(body.deduction)
    if refund > paid:
        raise ApiError(409, "Refund cannot exceed amount received", "REFUND_EXCEEDS_PAID")
    if await db.payments.count_documents({"booking_id": booking_id, "status": "Pending"}):
        raise ApiError(409, "Clear or bounce pending cheques before cancelling", "PENDING_PAYMENTS")
    ts = now_iso()
    canc = {"at": ts, "by": user["id"], "by_name": user["name"], "reason": body.reason, "refund_paise": refund, "deduction_paise": ded}
    ver = expected_version(request, body.version)
    async with unit_of_work() as uow:
        after = await guarded_update(db.bookings, {"id": booking_id, "status": "Active", **({"version": ver} if ver is not None else {})}, {"$set": {"status": "Cancelled", "cancellation": canc, "updated_at": ts}, "$inc": {"version": 1}}, uow)
        if not after:
            raise ApiError(409, "Booking changed; reload and retry", "VERSION_CONFLICT")
        uow.on_rollback(lambda: db.bookings.update_one({"id": booking_id}, {"$set": {"status": "Active", "cancellation": None}}))
        flat = await db.flats.find_one_and_update({"id": b["flat_id"]}, {"$set": {"status": "Available", "booking_id": None, "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, projection={"_id": 0}, **uow.kw())
        await apply_status_delta(b["block_id"], b["project_id"], flat["status"] if flat else "Booked", "Available", uow.session)
        await db.parking_slots.update_many({"booking_id": booking_id}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None}}, **uow.kw())
        await db.demands.update_many({"booking_id": booking_id, "status": {"$ne": "Paid"}}, {"$set": {"status": "Cancelled"}}, **uow.kw())
    await rebuild(booking_id)
    await write_audit(user, "booking.cancel", "booking", booking_id, before={"status": "Active"}, after={"status": "Cancelled", **canc, "booking_number": b["booking_number"]}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", b["flat_id"], before={"status": "Booked"}, after={"status": "Available", "reason": "Booking cancelled"}, ip=client_ip(request))
    return _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))


@router.post("/{booking_id}/complete")
async def complete_booking(booking_id: str, body: CompleteIn, request: Request, user: dict = Depends(require("booking.create"))):
    b = await _load(booking_id, user)
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    s = b.get("summary") or {}
    problems = []
    if (b.get("construction_percent") or 0) < 100:
        problems.append(f"construction at {b.get('construction_percent')}%")
    if s.get("due_paise", 0) > 0:
        problems.append("flat value due outstanding")
    if s.get("other_charges_due_paise", 0) > 0:
        problems.append("other charges due outstanding")
    if await db.payments.count_documents({"booking_id": booking_id, "status": "Pending"}):
        problems.append("pending cheques")
    if problems:
        raise ApiError(409, "Cannot complete: " + ", ".join(problems), "HANDOVER_BLOCKED", {"problems": problems})
    ts = now_iso()
    ver = expected_version(request, body.version)
    async with unit_of_work() as uow:
        after = await guarded_update(db.bookings, {"id": booking_id, "status": "Active", **({"version": ver} if ver is not None else {})}, {"$set": {"status": "Completed", "completed_at": ts, "completed_by": user["id"], "completion_notes": body.notes, "updated_at": ts}, "$inc": {"version": 1}}, uow)
        if not after:
            raise ApiError(409, "Booking changed; reload and retry", "VERSION_CONFLICT")
        await db.flats.update_one({"id": b["flat_id"]}, {"$set": {"status": "Sold", "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, **uow.kw())
        await apply_status_delta(b["block_id"], b["project_id"], "Booked", "Sold", uow.session)
    await write_audit(user, "booking.complete", "booking", booking_id, before={"status": "Active"}, after={"status": "Completed"}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", b["flat_id"], before={"status": "Booked"}, after={"status": "Sold"}, ip=client_ip(request))
    return _present(after)


@router.post("/{booking_id}/other-charges/demand")
async def demand_other_charge(booking_id: str, body: ManualChargeDemandIn, request: Request, user: dict = Depends(require("booking.create"))):
    b = await _load(booking_id, user)
    lines = b.get("other_charges") or []
    line = next((l for l in lines if l["line_id"] == body.line_id), None)
    if not line:
        raise ApiError(404, "Charge line not found", "NOT_FOUND")
    if line.get("demanded_at"):
        raise ApiError(409, "Charge already demanded", "ALREADY_DEMANDED")
    line["demanded_at"], line["demanded_paise"] = now_iso(), line["total_paise"]
    await db.bookings.update_one({"id": booking_id}, {"$set": {"other_charges": lines, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await rebuild(booking_id)
    await write_audit(user, "booking.other_charge_demand", "booking", booking_id, after={"line": line["name"], "amount_paise": line["total_paise"]}, ip=client_ip(request))
    return _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))


@router.post("/{booking_id}/recompute")
async def recompute(booking_id: str, user: dict = Depends(require("settings.manage"))):
    await _load(booking_id, user)
    rows = await rebuild(booking_id)
    return {"rows": len(rows), "summary": present_money((await db.bookings.find_one({"id": booking_id}, {"_id": 0, "summary": 1}))["summary"])}


@router.get("/{booking_id}/demands/{demand_id}/letter")
async def demand_letter(booking_id: str, demand_id: str, user: dict = Depends(require("booking.read"))):
    from services.money import amount_in_words
    b = await _load(booking_id, user)
    d = await get_or_404(db.demands, demand_id, "Demand", {"booking_id": booking_id})
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "bank_account": 0})
    bank = await db.bank_accounts.find_one({"company_id": user["company_id"], "is_default": True}, {"_id": 0, "bank_name": 1, "account_name": 1, "ifsc": 1, "branch": 1, "account_number_enc": 1})
    if bank:
        from crypto import decrypt_field
        bank["account_number"] = decrypt_field(bank.pop("account_number_enc", None))
    customer = await db.customers.find_one({"id": b["customer_id"]}, {"_id": 0, "full_name": 1, "salutation": 1, "address_current": 1, "phone": 1, "customer_code": 1})
    return present_money({"company": company, "bank": bank, "customer": customer, "booking": {k: b[k] for k in ("booking_number", "flat_snapshot", "project_name", "block_name", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise", "summary")},
                          "demand": d, "amount_in_words": amount_in_words(d["total_demand_paise"]), "cash_in_words": amount_in_words(d["cash_demand_paise"]), "account_in_words": amount_in_words(d["account_demand_paise"])})
