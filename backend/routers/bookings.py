from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator

from db import db
from models_out import BookingsOut, BookingsOutPage
from deps import ensure_project_access, project_scope_filter, require
from services.counters import apply_status_delta
from services.ledger import raise_other_charges, rebuild
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


@router.get("", response_model=BookingsOutPage, response_model_exclude_unset=True)
async def list_bookings(params: ListParams = Depends(), project_id: str | None = None, block_id: str | None = None, status: str | None = None,
                        customer_id: str | None = None, user: dict = Depends(require("sales.booking.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["booking_number", "customer_name", "flat_snapshot.flat_number"])}
    for k, v in (("project_id", project_id), ("block_id", block_id), ("customer_id", customer_id)):
        if v:
            q[k] = v
    if status:
        q["status"] = {"$in": status.split(",")}
    res = await paginate(db.bookings, q, params, params.sort_spec(["booking_number", "booking_date", "created_at", "status", "customer_name"], "-booking_date"), {"agreement_revisions": 0, "milestone_template_snapshot": 0, "payment_plan_snapshot": 0})
    from services.includes import expand
    res["items"] = present_money(await expand(res["items"], params.include, "bookings"))
    if res.pop("_csv", False):
        rows = [{**i, "flat_number": i["flat_snapshot"]["flat_number"], **{k: v for k, v in i["summary"].items() if not k.endswith("_paise")}} for i in res["items"]]
        return Response(to_csv(rows, ["booking_number", "booking_date", "customer_name", "project_code", "block_code", "flat_number", "status", "agreement_value", "cash_agreed", "account_agreed", "construction_percent", "cash_paid", "account_paid", "paid", "cash_due", "account_due", "due", "other_charges_due"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=bookings.csv"})
    return res


@router.post("", status_code=201)
async def create_booking(body: BookingIn, request: Request, user: dict = Depends(require("sales.booking.create"))):
    flat = await get_or_404(db.flats, body.flat_id, "Flat")
    ensure_project_access(user, flat["project_id"])
    if flat["status"] not in ("Available", "Hold"):
        raise ApiError(409, f"Flat {flat['flat_number']} is {flat['status']}", "FLAT_NOT_AVAILABLE")
    if flat["status"] == "Hold" and flat.get("status_changed_by") not in (user["id"], None) and "sales.hold.release" not in user["permissions"]:
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
           "rate_per_sqft": flat.get("rate_per_sqft"), "flat_snapshot": {"flat_number": flat["flat_number"], "flat_type_code": flat.get("flat_type_code"), "flat_type_id": flat.get("flat_type_id"), "super_builtup_sqft": flat.get("super_builtup_sqft"), "floor": flat.get("floor"), "price": flat["price_paise"] / 100 if flat.get("price_paise") is not None else None, "price_paise": flat.get("price_paise")},
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
        await db.leads.update_one({"id": body.lead_id}, {"$set": {"booking_id": doc["id"], "status": "Converted", "converted_customer_id": customer["id"], "updated_at": now_iso()}, "$push": {"stage_history": {"status": "Converted", "at": now_iso(), "by": user["id"], "note": f"Booking {doc['booking_number']}"}}})
        await write_audit(user, "lead.convert", "lead", body.lead_id, before={"status": None}, after={"status": "Converted", "customer_id": customer["id"], "booking_id": doc["id"]}, ip=client_ip(request))
    else:  # walk-in: every booking has a lead so the funnel stays complete
        lead = {**base_doc(user, user["company_id"]), "lead_number": await generate_number("lead", company), "name": customer["full_name"], "phone": customer.get("phone"), "email": customer.get("email"), "source": "Walk-in", "project_id": flat["project_id"], "project_name": project.get("name"),
                "status": "Converted", "stage_history": [{"status": "New", "at": posted_at, "by": user["id"], "note": "Walk-in"}, {"status": "Converted", "at": posted_at, "by": user["id"], "note": f"Booking {doc['booking_number']}"}], "follow_ups": [], "next_follow_up_at": None,
                "lost_reason": None, "converted_customer_id": customer["id"], "assigned_to": user["id"], "booking_id": doc["id"], "created_at": posted_at}
        await db.leads.insert_one(lead)
        await db.bookings.update_one({"id": doc["id"]}, {"$set": {"lead_id": lead["id"]}})
        await write_audit(user, "lead.create", "lead", lead["id"], after={"lead_number": lead["lead_number"], "name": lead["name"], "source": "Walk-in", "status": "Converted"}, ip=client_ip(request))
        await write_audit(user, "lead.convert", "lead", lead["id"], before={"status": "New"}, after={"status": "Converted", "customer_id": customer["id"], "booking_id": doc["id"]}, ip=client_ip(request))
    after = await db.bookings.find_one({"id": doc["id"]}, {"_id": 0})
    await write_audit(user, "booking.create", "booking", doc["id"], after={k: after[k] for k in ("id", "booking_number", "customer_name", "flat_snapshot", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise")}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", flat["id"], before={"status": flat["status"]}, after={"status": "Booked", "booking_number": doc["booking_number"]}, ip=client_ip(request))
    return _present(after)


@router.get("/{booking_id}", response_model=BookingsOut, response_model_exclude_unset=True)
async def get_booking(booking_id: str, user: dict = Depends(require("sales.booking.view"))):
    if booking_id.startswith("BK-"):
        hit = await db.bookings.find_one({"booking_number": booking_id, "company_id": user["company_id"]}, {"_id": 0, "id": 1})
        booking_id = hit["id"] if hit else booking_id
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
async def ledger(booking_id: str, format: str | None = None, user: dict = Depends(require("finance.ledger.view"))):
    b = await _load(booking_id, user)
    rows = await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0}).sort("seq", 1).to_list(1000)
    out = present_money(rows)
    if format == "csv":
        return Response(to_csv(out, ["seq", "date", "type", "construction_percent", "category", "amount", "ref", "note", "cash_paid_cum", "account_paid_cum", "cash_order_raised", "account_order_raised", "cash_due", "account_due", "total_due"]),
                        media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=ledger-{b['booking_number'].replace('/', '-')}.csv"})
    return {"booking": _present({k: b[k] for k in ("id", "booking_number", "customer_name", "flat_snapshot", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise", "construction_percent", "status", "summary")}), "rows": out, "total": len(out)}


@router.post("/{booking_id}/agreement-revisions")
async def revise_agreement(booking_id: str, body: RevisionIn, request: Request, user: dict = Depends(require("sales.agreement.revise"))):
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
    from services.money_ops import reproportion_open_demands
    await reproportion_open_demands(after, user, body.reason, old_agreement_value_paise=b["agreement_value_paise"])
    await rebuild(booking_id)
    await write_audit(user, "booking.agreement_revision", "booking", booking_id, before=rev["before"], after={**rev["after"], "reason": body.reason, "booking_number": b["booking_number"]}, ip=client_ip(request))
    return _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))


class TransferIn(StrictModel):
    new_flat_id: str
    reason: str = Field(min_length=3, max_length=500)
    price_handling: Literal["revise_agreement", "keep_agreement"] = "revise_agreement"
    old_flat_status: Literal["Available", "Blocked", "Hold"] = "Available"
    cash_percent: float | None = Field(default=None, ge=0, le=100)
    version: int | None = None


class SwapIn(StrictModel):
    other_booking_id: str
    reason: str = Field(min_length=3, max_length=500)
    version: int | None = None


async def _policy(company_id: str, project_id: str | None = None) -> dict:
    """Project policy wins, else company, else money_ops.DEFAULT_POLICY."""
    if project_id:
        p = await db.projects.find_one({"id": project_id}, {"_id": 0, "cancellation_policy": 1})
        if (p or {}).get("cancellation_policy"):
            return p["cancellation_policy"]
    c = await db.companies.find_one({"id": company_id}, {"_id": 0, "cancellation_policy": 1})
    return (c or {}).get("cancellation_policy") or {}


@router.get("/{booking_id}/cancellation-preview")
async def cancellation_preview_ep(booking_id: str, deduction: float | None = None, user: dict = Depends(require("sales.booking.cancel"))):
    from services.money_ops import cancellation_preview
    b = await _load(booking_id, user)
    return present_money(cancellation_preview(b, await _policy(user["company_id"], b.get("project_id")), to_paise(deduction) if deduction is not None else None))


@router.get("/{booking_id}/refunds")
async def booking_refunds(booking_id: str, user: dict = Depends(require("finance.refund.view"))):
    await _load(booking_id, user)
    items = await db.refunds.find({"booking_id": booking_id, "parent_refund_id": None}, {"_id": 0}).sort("created_at", -1).to_list(None)
    return present_money({"items": items, "total": len(items)})


@router.post("/{booking_id}/cancel")
async def cancel_booking(booking_id: str, body: CancelIn, request: Request, user: dict = Depends(require("sales.booking.cancel"))):
    """Cancellation maths comes from money_ops (deduction % of agreement/received, capped at received; only demanded penalty charges deducted)."""
    from services.money_ops import cancellation_preview, create_refund
    b = await _load(booking_id, user)
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is already {b['status']}", "BOOKING_NOT_ACTIVE")
    if await db.payments.count_documents({"booking_id": booking_id, "status": "Pending"}):
        raise ApiError(409, "Clear or bounce pending cheques before cancelling", "PENDING_PAYMENTS")
    policy = await _policy(user["company_id"], b.get("project_id"))
    pv = cancellation_preview(b, policy, to_paise(body.deduction) if body.deduction else None)
    ts = now_iso()
    canc = {"at": ts, "by": user["id"], "by_name": user["name"], "reason": body.reason, **{k: pv[k] for k in ("received_paise", "deduction_paise", "charges_due_paise", "refund_paise", "forfeiture_paise")}, "lines": pv["lines"], "policy": pv["policy"]}
    ver = expected_version(request, body.version)
    pre_summary = dict(b.get("summary") or {})
    async with unit_of_work() as uow:
        after = await guarded_update(db.bookings, {"id": booking_id, "status": "Active", **({"version": ver} if ver is not None else {})}, {"$set": {"status": "Cancelled", "cancellation": canc, "updated_at": ts}, "$inc": {"version": 1}}, uow)
        if not after:
            raise ApiError(409, "Booking changed; reload and retry", "VERSION_CONFLICT")
        uow.on_rollback(lambda: db.bookings.update_one({"id": booking_id}, {"$set": {"status": "Active", "cancellation": None}}))
        flat = await db.flats.find_one_and_update({"id": b["flat_id"]}, {"$set": {"status": "Available", "booking_id": None, "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, projection={"_id": 0}, **uow.kw())
        await apply_status_delta(b["block_id"], b["project_id"], flat["status"] if flat else "Booked", "Available", uow.session)
        await db.parking_slots.update_many({"booking_id": booking_id}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None}}, **uow.kw())
        await db.demands.update_many({"booking_id": booking_id, "status": {"$ne": "Paid"}}, {"$set": {"status": "Cancelled", "cancelled_at": ts}}, **uow.kw())
    if b.get("lead_id"):
        await db.leads.update_one({"id": b["lead_id"]}, {"$set": {"status": "Lost", "lost_reason": "Booking cancelled", "updated_at": ts}})
    await rebuild(booking_id)
    rf = await create_refund({**b, "status": "Cancelled"}, pv["deduction_paise"], user, policy, preview=pv, pre_summary=pre_summary)
    await write_audit(user, "booking.cancel", "booking", booking_id, before={"status": "Active", "booking_number": b["booking_number"]}, after={"status": "Cancelled", **{k: canc[k] for k in ("reason", "received_paise", "deduction_paise", "refund_paise", "forfeiture_paise")}, "booking_number": b["booking_number"]}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", b["flat_id"], before={"status": "Booked", "flat_number": b.get("flat_number")}, after={"status": "Available", "reason": "Booking cancelled", "flat_number": b.get("flat_number")}, ip=client_ip(request))
    out = _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))
    out["refund"] = present_money(rf) if rf else None
    return out


async def _move_flat(b: dict, new_flat: dict, user: dict, ts: str, old_status: str, uow) -> None:
    await db.flats.update_one({"id": b["flat_id"]}, {"$set": {"status": old_status, "booking_id": None, "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, **uow.kw())
    await apply_status_delta(b["block_id"], b["project_id"], "Booked", old_status, uow.session)
    await db.flats.update_one({"id": new_flat["id"]}, {"$set": {"status": "Booked", "booking_id": b["id"], "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, **uow.kw())
    await apply_status_delta(new_flat["block_id"], new_flat["project_id"], new_flat["status"], "Booked", uow.session)


@router.post("/{booking_id}/transfer")
async def transfer_booking(booking_id: str, body: TransferIn, request: Request, user: dict = Depends(require("sales.booking.transfer"))):
    """Move an active booking to another available flat; money follows the customer (payments/demands re-bound), agreement optionally revised to the new price with a cash-%."""
    from services.money_ops import rebind_demands_to_block, reproportion_open_demands
    b = await _load(booking_id, user)
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    if await db.payments.count_documents({"booking_id": booking_id, "status": "Pending"}):
        raise ApiError(409, "Clear or bounce pending cheques before transferring", "PENDING_PAYMENTS")
    nf = await get_or_404(db.flats, body.new_flat_id, "Flat")
    ensure_project_access(user, nf["project_id"])
    if nf["id"] == b["flat_id"]:
        raise ApiError(400, "Already on this flat", "SAME_FLAT")
    if nf["status"] != "Available":
        raise ApiError(409, f"Target flat is {nf['status']}", "FLAT_NOT_AVAILABLE")
    nb = await db.blocks.find_one({"id": nf["block_id"]}, {"_id": 0})
    np_ = await db.projects.find_one({"id": nf["project_id"]}, {"_id": 0, "code": 1, "name": 1})
    ts = now_iso()
    old = {"agreement_value_paise": b["agreement_value_paise"], "cash_agreed_paise": b["cash_agreed_paise"], "account_agreed_paise": b["account_agreed_paise"]}
    sets = {"flat_id": nf["id"], "flat_number": nf.get("flat_number"), "block_id": nf["block_id"], "block_code": nb.get("code"), "block_name": nb.get("name"), "project_id": nf["project_id"], "project_code": np_.get("code"), "project_name": np_.get("name"),
            "construction_percent": nb.get("construction_percent", 0), "updated_at": ts}
    if body.price_handling == "revise_agreement" and nf.get("price_paise"):
        pct = body.cash_percent if body.cash_percent is not None else (b["cash_agreed_paise"] * 100 / b["agreement_value_paise"] if b["agreement_value_paise"] else 0)
        cash = pct_of(nf["price_paise"], pct)
        sets.update({"agreement_value_paise": nf["price_paise"], "cash_agreed_paise": cash, "account_agreed_paise": nf["price_paise"] - cash})
    tr = {"id": new_id(), "at": ts, "by": user["id"], "by_name": user["name"], "reason": body.reason, "from_flat_id": b["flat_id"], "from_flat": b.get("flat_number"), "from_block_id": b["block_id"], "to_flat_id": nf["id"], "to_flat": nf.get("flat_number"), "to_block_id": nf["block_id"],
          "price_handling": body.price_handling, "cash_percent": body.cash_percent, "before": old, "after": {k: sets.get(k, old[k]) for k in old}}
    ver = expected_version(request, body.version)
    async with unit_of_work() as uow:
        after = await guarded_update(db.bookings, {"id": booking_id, "status": "Active", **({"version": ver} if ver is not None else {})}, {"$set": sets, "$push": {"transfers": tr}, "$inc": {"version": 1}}, uow)
        if not after:
            raise ApiError(409, "Booking changed; reload and retry", "VERSION_CONFLICT")
        await _move_flat(b, nf, user, ts, body.old_flat_status, uow)
    rebind = await rebind_demands_to_block({**b, **sets, "id": booking_id}, nb, user)
    if tr["after"] != old:
        await reproportion_open_demands({**b, **sets, "id": booking_id}, user, f"transfer: {body.reason}", old_agreement_value_paise=old["agreement_value_paise"])
    await rebuild(booking_id)
    await write_audit(user, "booking.transfer", "booking", booking_id, before={"flat_number": b.get("flat_number"), "block_code": b.get("block_code"), **old, "booking_number": b["booking_number"]}, after={"flat_number": nf.get("flat_number"), "block_code": nb.get("code"), **tr["after"], "booking_number": b["booking_number"], "reason": body.reason}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", b["flat_id"], before={"status": "Booked", "flat_number": b.get("flat_number")}, after={"status": body.old_flat_status, "reason": f"Transferred to {nf.get('flat_number')}", "flat_number": b.get("flat_number")}, ip=client_ip(request))
    await write_audit(user, "flat.status", "flat", nf["id"], before={"status": "Available", "flat_number": nf.get("flat_number")}, after={"status": "Booked", "reason": f"Transfer of {b['booking_number']}", "flat_number": nf.get("flat_number")}, ip=client_ip(request))
    out = _present(await db.bookings.find_one({"id": booking_id}, {"_id": 0}))
    out["transfer"], out["rebind"] = tr, rebind
    return out


@router.post("/{booking_id}/swap")
async def swap_bookings(booking_id: str, body: SwapIn, request: Request, user: dict = Depends(require("sales.booking.transfer"))):
    """Two active bookings exchange flats; each keeps its own agreement values and money."""
    from services.money_ops import rebind_demands_to_block
    b1 = await _load(booking_id, user)
    b2 = await _load(body.other_booking_id, user)
    if b1["id"] == b2["id"] or b1["status"] != "Active" or b2["status"] != "Active":
        raise ApiError(409, "Both bookings must be active and different", "BOOKING_NOT_ACTIVE")
    ts = now_iso()
    f1 = await db.flats.find_one({"id": b1["flat_id"]}, {"_id": 0})
    f2 = await db.flats.find_one({"id": b2["flat_id"]}, {"_id": 0})
    blocks = {bl["id"]: bl for bl in await db.blocks.find({"id": {"$in": [f1["block_id"], f2["block_id"]]}}, {"_id": 0}).to_list(None)}
    ver = expected_version(request, body.version)

    def sets_for(f, bl):
        return {"flat_id": f["id"], "flat_number": f.get("flat_number"), "block_id": f["block_id"], "block_code": bl.get("code"), "block_name": bl.get("name"), "construction_percent": bl.get("construction_percent", 0), "updated_at": ts}
    async with unit_of_work() as uow:
        for bk, f, other in ((b1, f2, b2), (b2, f1, b1)):
            tr = {"id": new_id(), "at": ts, "by": user["id"], "by_name": user["name"], "reason": f"swap with {other['booking_number']}: {body.reason}", "from_flat_id": bk["flat_id"], "from_flat": bk.get("flat_number"), "to_flat_id": f["id"], "to_flat": f.get("flat_number"), "swap_with": other["booking_number"]}
            q = {"id": bk["id"], "status": "Active", **({"version": ver} if ver is not None and bk is b1 else {})}
            if not await guarded_update(db.bookings, q, {"$set": sets_for(f, blocks[f["block_id"]]), "$push": {"transfers": tr}, "$inc": {"version": 1}}, uow):
                raise ApiError(409, "Booking changed; reload and retry", "VERSION_CONFLICT")
            await db.flats.update_one({"id": f["id"]}, {"$set": {"booking_id": bk["id"], "status_changed_at": ts, "status_changed_by": user["id"]}, "$inc": {"version": 1}}, **uow.kw())
    for bk, f in ((b1, f2), (b2, f1)):
        await rebind_demands_to_block({**bk, **sets_for(f, blocks[f["block_id"]])}, blocks[f["block_id"]], user)
        await rebuild(bk["id"])
        await write_audit(user, "booking.transfer", "booking", bk["id"], before={"flat_number": bk.get("flat_number"), "booking_number": bk["booking_number"]}, after={"flat_number": f.get("flat_number"), "booking_number": bk["booking_number"], "reason": f"swap: {body.reason}"}, ip=client_ip(request))
    return present_money({"swapped": [await db.bookings.find_one({"id": b1["id"]}, {"_id": 0}), await db.bookings.find_one({"id": b2["id"]}, {"_id": 0})]})


@router.post("/{booking_id}/complete")
async def complete_booking(booking_id: str, body: CompleteIn, request: Request, user: dict = Depends(require("sales.booking.edit"))):
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
async def demand_other_charge(booking_id: str, body: ManualChargeDemandIn, request: Request, user: dict = Depends(require("finance.demand.create"))):
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
async def recompute(booking_id: str, user: dict = Depends(require("admin.data.recompute"))):
    await _load(booking_id, user)
    rows = await rebuild(booking_id)
    return {"rows": len(rows), "summary": present_money((await db.bookings.find_one({"id": booking_id}, {"_id": 0, "summary": 1}))["summary"])}


@router.get("/{booking_id}/demands/{demand_id}/letter")
async def demand_letter(booking_id: str, demand_id: str, user: dict = Depends(require("finance.demand.export"))):
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
