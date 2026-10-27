import asyncio
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field, field_validator

from services import clock
from db import db
from models_out import CustomersOut, CustomersOutPage
from deps import project_scope_filter, require
from services.kyc import (
    normalize_phone,
    seal,
    secure_hash,
    unseal,
    validate_aadhaar,
    validate_ifsc,
    validate_pan,
)
from services.numbering import generate_number
from services.money import present_money
from utils import now_iso
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    paginate,
    search_filter,
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/customers", tags=["customers"])
KYC_FIELDS = ("pan", "aadhaar")


class Address(StrictModel):
    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = Field(default=None, pattern=r"^[1-9][0-9]{5}$")


class Bank(StrictModel):
    bank_name: str | None = None
    account_number: str | None = Field(default=None, min_length=6, max_length=24)
    ifsc: str | None = None

    @field_validator("ifsc")
    @classmethod
    def _ifsc(cls, v):
        return validate_ifsc(v)


class Nominee(StrictModel):
    name: str | None = None
    relation: str | None = None
    dob: date | None = None


class CoApplicant(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    relation: str | None = None
    phone: str | None = None
    pan: str | None = None
    aadhaar: str | None = None

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)

    @field_validator("pan")
    @classmethod
    def _pan(cls, v):
        return validate_pan(v)

    @field_validator("aadhaar")
    @classmethod
    def _aad(cls, v):
        return validate_aadhaar(v)


class CustomerIn(StrictModel):
    salutation: str | None = Field(default=None, max_length=20)
    full_name: str = Field(min_length=2, max_length=120)
    father_or_spouse_name: str | None = None
    dob: date | None = None
    gender: str | None = Field(default=None, max_length=30)
    phone: str
    alt_phone: str | None = None
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    address_current: Address | None = None
    address_permanent: Address | None = None
    permanent_same_as_current: bool = False
    occupation: str | None = None
    company_name: str | None = None
    annual_income_band: str | None = Field(default=None, max_length=60)
    source: str | None = Field(default=None, max_length=60)
    source_id: str | None = None
    residency_id: str | None = None
    occupation_id: str | None = None
    income_band_id: str | None = None
    segment_ids: list[str] | None = None
    assigned_sales_user_id: str | None = None
    pan: str | None = None
    aadhaar: str | None = None
    bank: Bank | None = None
    nominee: Nominee | None = None
    co_applicants: list[CoApplicant] = []
    notes: str | None = None
    tags: list[str] = []
    whatsapp_phone: str | None = Field(default=None, description="Defaults to phone")
    preferred_channel: Literal["email", "whatsapp", "sms"] | None = None
    consent: dict | None = Field(default=None, description="{email, whatsapp, sms, marketing}: email defaults true when an email is given")
    language: Literal["en", "hi"] | None = None

    @field_validator("phone", "alt_phone", "whatsapp_phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)

    @field_validator("pan")
    @classmethod
    def _pan(cls, v):
        return validate_pan(v)

    @field_validator("aadhaar")
    @classmethod
    def _aad(cls, v):
        return validate_aadhaar(v)


class CustomerUpdate(CustomerIn):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    co_applicants: list[CoApplicant] | None = None
    tags: list[str] | None = None
    permanent_same_as_current: bool | None = None
    is_active: bool | None = None
    version: int | None = None


class KycStatusIn(StrictModel):
    kyc_status: Literal["Pending", "Submitted", "Verified", "Rejected"]
    note: str | None = None
    version: int | None = None


def _prepare(data: dict) -> dict:
    data = {k: v for k, v in data.items() if k != "version"}
    for k in ("dob",):
        if isinstance(data.get(k), date):
            data[k] = data[k].isoformat()
    if data.get("nominee") and isinstance(data["nominee"].get("dob"), date):
        data["nominee"]["dob"] = data["nominee"]["dob"].isoformat()
    if data.get("permanent_same_as_current") and data.get("address_current"):
        data["address_permanent"] = data["address_current"]
    if "bank" in data and data["bank"] is not None:
        data["bank"] = seal(data["bank"], ("account_number",))
    if "co_applicants" in data and data["co_applicants"] is not None:
        data["co_applicants"] = [seal(c) for c in data["co_applicants"]]
    return seal(data)


def present(doc: dict, reveal: bool = False) -> dict:
    out = unseal(doc, reveal)
    if out.get("bank"):
        out["bank"] = unseal(out["bank"], reveal, ("account_number",))
    out["co_applicants"] = [unseal(c, reveal) for c in out.get("co_applicants") or []]
    return out


async def _dup_check(company_id: str, phone: str | None, pan: str | None, exclude_id: str | None = None):
    if phone:
        q = {"company_id": company_id, "phone": phone, "is_active": True}
        if exclude_id:
            q["id"] = {"$ne": exclude_id}
        if dup := await db.customers.find_one(q, {"_id": 0, "customer_code": 1, "full_name": 1}):
            raise ApiError(409, f"Phone already registered to {dup['full_name']} ({dup['customer_code']})", "DUPLICATE_PHONE")
    if pan:
        q = {"company_id": company_id, "pan_hash": secure_hash(pan)}
        if exclude_id:
            q["id"] = {"$ne": exclude_id}
        if dup := await db.customers.find_one(q, {"_id": 0, "customer_code": 1, "full_name": 1}):
            raise ApiError(409, f"PAN already registered to {dup['full_name']} ({dup['customer_code']})", "DUPLICATE_PAN")


@router.get("", response_model=CustomersOutPage, response_model_exclude_unset=True)
async def list_customers(params: ListParams = Depends(), has_overdue: bool = False, kyc_status: str | None = None, source: str | None = None,
                         assigned_sales_user_id: str | None = None, segment_id: str | None = None, lifecycle_stage: str | None = None, city_id: str | None = None,
                         user: dict = Depends(require("sales.customer.view"))):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["full_name", "phone", "customer_code", "email"])}
    if segment_id:
        q["segment_ids"] = segment_id
    if lifecycle_stage:
        q["lifecycle_stage"] = lifecycle_stage
    if city_id:
        q["city_id"] = city_id
    if params.search and params.search.replace(" ", "").isalnum() and len(params.search) == 10:
        q = {"company_id": user["company_id"], "$or": [*q["$or"], {"pan_hash": secure_hash(params.search.upper())}]}
    if not params.include_inactive:
        q["is_active"] = True
    if kyc_status:
        q["kyc_status"] = kyc_status
    if source:
        q["source"] = source
    if assigned_sales_user_id:
        q["assigned_sales_user_id"] = assigned_sales_user_id
    today = clock.today().isoformat()
    if has_overdue:
        q["id"] = {"$in": await db.demands.distinct("customer_id", {"voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}})}
    res = await paginate(db.customers, q, params, params.sort_spec(["full_name", "customer_code", "created_at", "kyc_status", "phone", "engagement_score", "lifecycle_stage"], "-created_at"))
    from services.includes import expand
    res["items"] = await expand([present(c) for c in res["items"]], params.include, "customers")
    ids = [c["id"] for c in res["items"]]
    dues = {d["_id"]: d["due"] for d in await db.bookings.aggregate([{"$match": {"customer_id": {"$in": ids}, "status": "Active"}}, {"$group": {"_id": "$customer_id", "due": {"$sum": {"$add": [{"$ifNull": ["$summary.due_paise", 0]}, {"$ifNull": ["$summary.other_charges_due_paise", 0]}]}}}}]).to_list(None)}
    od = {d["_id"]: d["n"] for d in await db.demands.aggregate([{"$match": {"customer_id": {"$in": ids}, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}}}, {"$group": {"_id": "$customer_id", "n": {"$sum": 1}}}]).to_list(None)}
    bk = {d["_id"]: d for d in await db.bookings.aggregate([{"$match": {"customer_id": {"$in": ids}, "status": {"$in": ["Active", "Completed"]}}}, {"$group": {"_id": "$customer_id", "n": {"$sum": 1}, "agreement": {"$sum": "$agreement_value_paise"}}}]).to_list(None)}
    for c in res["items"]:
        c["bookings_count"] = bk.get(c["id"], {}).get("n", 0)
        c["agreement_paise"] = bk.get(c["id"], {}).get("agreement", 0)
    for c in res["items"]:
        c["total_due_paise"] = dues.get(c["id"], 0)
        c["total_due"] = round(c["total_due_paise"] / 100, 2)
        c["overdue_count"] = od.get(c["id"], 0)
    if res.pop("_csv", False):
        from fastapi import Response
        return Response(to_csv(res["items"], ["customer_code", "full_name", "phone", "email", "source", "kyc_status", "pan_masked", "created_at"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=customers.csv"})
    return res


@router.post("", status_code=201)
async def create_customer(body: CustomerIn, request: Request, user: dict = Depends(require("sales.customer.create"))):
    await _dup_check(user["company_id"], body.phone, body.pan)
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    doc = {**base_doc(user, user["company_id"]), **_prepare(body.model_dump()), "customer_code": await generate_number("customer", company),
           "kyc_status": "Pending", "kyc_verified_by": None, "kyc_verified_at": None}
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "customer.create", "customer", doc["id"], after=present(doc), ip=client_ip(request))
    return present(doc)


@router.get("/rm-options")
async def rm_options(user: dict = Depends(require("sales.customer.view"))):
    rows = await db.users.find({"company_id": user["company_id"], "is_active": True}, {"_id": 0, "id": 1, "name": 1, "role_id": 1}).sort("name", 1).to_list(200)
    roles = {r["id"]: r["name"] for r in await db.roles.find({"id": {"$in": list({u.get("role_id") for u in rows})}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    return {"items": [{"id": u["id"], "name": u["name"], "role_name": roles.get(u.get("role_id"))} for u in rows]}


@router.get("/{customer_id}/panels")
async def customer_panels(customer_id: str, include_cancelled: bool = Query(False, description="Tiles/ledgers/bookings_count exclude Cancelled bookings by default (refunds/forfeiture shown separately)"), user: dict = Depends(require("sales.customer.view"))):
    """Composite for Customer 360 (one round trip): communications, documents, key numbers (two-sided ledgers), next due,
    demands, receipts, generated documents, open tickets, construction of their towers."""
    from services.definitions import LIVE_BOOKING_STATUSES
    from services.dues_engine import schedule
    from services.ledgers import customer_ledgers
    cid = user["company_id"]
    today = now_iso()[:10]
    statuses = None if include_cancelled else LIVE_BOOKING_STATUSES
    comms, docs, types, ledg, dems, recs, gdocs, tickets, bookings, portal = await asyncio.gather(
        db.communications.find({"company_id": cid, "customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).limit(8).to_list(8),
        db.documents.find({"entity_type": "customer", "entity_id": customer_id, "is_active": True}, {"_id": 0}).sort("uploaded_at", -1).to_list(200),
        db.document_types.find({"is_active": True}, {"_id": 0, "id": 1, "name": 1, "code": 1}).sort("name", 1).to_list(100),
        customer_ledgers(customer_id, cid, statuses),
        db.demands.find({"company_id": cid, "customer_id": customer_id}, {"_id": 0}).sort("demand_date", -1).to_list(300),
        db.payments.find({"company_id": cid, "customer_id": customer_id}, {"_id": 0, "id": 1, "receipt_number": 1, "payment_date": 1, "amount_paise": 1, "status": 1, "payment_mode_name": 1, "payment_category": 1, "booking_id": 1, "booking_number": 1, "against": 1}).sort("payment_date", -1).to_list(300),
        db.generated_documents.find({"company_id": cid, "customer_id": customer_id}, {"_id": 0}).sort("generated_at", -1).to_list(100),
        db.support_tickets.find({"company_id": cid, "customer_id": customer_id, "status": {"$nin": ["Closed", "Resolved"]}}, {"_id": 0, "id": 1, "ticket_number": 1, "subject": 1, "status": 1, "priority": 1, "created_at": 1, "sla_due_at": 1}).sort("created_at", -1).limit(20).to_list(20),
        db.bookings.find({"company_id": cid, "customer_id": customer_id}, {"_id": 0, "id": 1, "booking_number": 1, "block_id": 1, "block_name": 1, "project_id": 1, "project_name": 1, "status": 1, "payment_plan_snapshot": 1, "flat_snapshot.flat_number": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "agreement_value_paise": 1, "booking_date": 1, "milestone_template_snapshot": 1}).to_list(50),
        db.portal_accounts.find_one({"customer_id": customer_id}, {"_id": 0, "is_active": 1, "last_login_at": 1}))
    T = (ledg.get("totals") or {}).get("combined") or {}
    live_bk = {b["id"] for b in bookings if statuses is None or b["status"] in statuses}
    live = [d for d in dems if not d.get("voided") and d.get("status") != "Cancelled" and d["booking_id"] in live_bk]
    overdue = [d for d in live if d["status"] != "Paid" and d["due_date"] < today]
    cancelled = [b for b in bookings if b["status"] == "Cancelled"]
    refunds = await db.refunds.find({"booking_id": {"$in": [b["id"] for b in cancelled]}}, {"_id": 0, "booking_id": 1, "amount_paise": 1, "status": 1}).to_list(50) if cancelled else []
    canc_rows = await db.bookings.find({"id": {"$in": [b["id"] for b in cancelled]}}, {"_id": 0, "id": 1, "cancellation.forfeiture_paise": 1, "cancellation.refund_paise": 1, "cancellation.received_paise": 1}).to_list(50) if cancelled else []
    oldest = max(((date.fromisoformat(today) - date.fromisoformat(d["due_date"])).days for d in overdue), default=0)
    summary = {"agreement_paise": T.get("agreed_paise", 0), "udhar_paise": T.get("total_udhar_paise", 0), "jama_paise": T.get("total_jama_paise", 0), "balance_paise": T.get("balance_paise", 0), "advance_paise": T.get("advance_paise", 0),
               "overdue_paise": sum(d["total_demand_paise"] - (d.get("paid_paise") or 0) for d in overdue), "overdue_count": len(overdue), "overdue_oldest_days": oldest, "pending_cheques_paise": T.get("pending_cheques_paise", 0),
               "include_cancelled": include_cancelled, "rule": "Tiles, ledgers and bookings_count use live bookings (Active/Completed) unless include_cancelled=1",
               "cancelled": {"count": len(cancelled), "received_paise": sum((r.get("cancellation") or {}).get("received_paise") or 0 for r in canc_rows), "forfeiture_paise": sum((r.get("cancellation") or {}).get("forfeiture_paise") or 0 for r in canc_rows), "refund_paise": sum((r.get("cancellation") or {}).get("refund_paise") or 0 for r in canc_rows), "refunds": refunds}}
    # next due: earliest unpaid demand, else next planned installment of an active booking
    nxt = None
    unpaid = sorted([d for d in live if d["status"] != "Paid"], key=lambda d: d["due_date"])
    if unpaid:
        d = unpaid[0]
        nxt = {"kind": "demand", "what": d.get("installment_name") or d.get("milestone_name"), "when": d["due_date"], "amount_paise": d["total_demand_paise"] - (d.get("paid_paise") or 0), "why": " · ".join(str(x) for x in [d.get("milestone_name"), f"{d.get('percent')}%" if d.get("percent") is not None else None, d.get("trigger")] if x), "booking_number": d.get("booking_number"), "demand_id": d["id"], "booking_id": d["booking_id"], "overdue": d["due_date"] < today}
    blocks = {b["id"]: b for b in await db.blocks.find({"id": {"$in": list({b["block_id"] for b in bookings if b.get("block_id")})}}, {"_id": 0, "id": 1, "name": 1, "project_id": 1, "construction_percent": 1, "stages": 1, "stage_plan_name": 1, "planned_completion": 1}).to_list(None)}
    plans = []
    for b in bookings:
        blk = blocks.get(b.get("block_id")) or {}
        rows = schedule(b, blk, [d for d in dems if d["booking_id"] == b["id"]]) if b.get("payment_plan_snapshot") else []
        raised = [r for r in rows if r.get("demand_id")]
        plans.append({"booking_id": b["id"], "booking_number": b["booking_number"], "plan_name": (b.get("payment_plan_snapshot") or {}).get("name"), "installments_total": len(rows), "installments_raised": len(raised), "installments_paid": sum(1 for r in raised if r["status"] == "Paid"), "next": next((r for r in rows if not r.get("demand_id")), None), "rows": rows})
        if not nxt and b["status"] == "Active":
            n = next((r for r in rows if not r.get("demand_id")), None)
            if n:
                nxt = {"kind": "planned", "what": n["name"], "when": n.get("expected_date"), "amount_paise": n.get("total_paise"), "why": n.get("trigger_label"), "booking_number": b["booking_number"], "booking_id": b["id"]}
    construction = [{"block_id": bid, "block_name": blk.get("name"), "construction_percent": blk.get("construction_percent", 0), "stage_plan_name": blk.get("stage_plan_name"), "planned_completion": blk.get("planned_completion"),
                     "stages": [{"name": s.get("name"), "status": s.get("status"), "completed_on": s.get("completed_on"), "planned_on": s.get("planned_on")} for s in (blk.get("stages") or [])][:12]} for bid, blk in blocks.items()]
    photos = await db.files.find({"company_id": cid, "entity_type": "block", "entity_id": {"$in": list(blocks)}, "kind": "construction_photo", "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "entity_id": 1, "created_at": 1, "caption": 1}).sort("created_at", -1).limit(12).to_list(12)
    return {"communications": {"items": comms}, "documents": {"items": docs}, "document_types": {"items": types}, "summary": summary, "next_due": nxt, "ledgers": ledg,
            "demands": {"items": present_money(dems)}, "receipts": {"items": present_money(recs)}, "generated_documents": {"items": gdocs}, "tickets": {"items": tickets}, "plans": present_money(plans), "construction": construction, "photos": photos,
            "portal_enabled": bool(portal and portal.get("is_active")), "portal_last_login_at": (portal or {}).get("last_login_at"),
            "counts": {"bookings": len(live_bk), "bookings_all": len(bookings), "demands": len(live), "receipts": len(recs), "documents": len(gdocs) + len(docs), "tickets": len(tickets), "construction": len(construction)}}


@router.get("/{customer_id}", response_model=CustomersOut, response_model_exclude_unset=True)
async def get_customer(customer_id: str, request: Request, reveal: bool = Query(False), user: dict = Depends(require("sales.customer.view"))):
    if customer_id.startswith("CUST-"):
        hit = await db.customers.find_one({"customer_code": customer_id, "company_id": user["company_id"]}, {"_id": 0, "id": 1})
        customer_id = hit["id"] if hit else customer_id
    doc = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    do_reveal = reveal and "sales.kyc.reveal" in user["permissions"]
    if reveal and not do_reveal:
        raise ApiError(403, "Missing permission: sales.kyc.reveal", "PERMISSION_DENIED", {"missing": "sales.kyc.reveal", "any_of": ["sales.kyc.reveal"]})
    if do_reveal:
        await write_audit(user, "customer.kyc_reveal", "customer", customer_id, after={"revealed": ["pan", "aadhaar", "bank.account_number"]}, ip=client_ip(request))
    out = present(doc, do_reveal)
    out["bookings"] = await db.bookings.find({"$or": [{"customer_id": customer_id}, {"co_applicant_customer_ids": customer_id}]}, {"_id": 0, "id": 1, "booking_number": 1, "status": 1, "flat_snapshot": 1, "project_id": 1, "agreement_value_paise": 1, "summary": 1, "booking_date": 1, "payment_plan_snapshot": 1, "block_id": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1}).to_list(50)
    from services.dues_engine import schedule
    today = clock.today().isoformat()
    for bk in out["bookings"]:
        snap = bk.pop("payment_plan_snapshot", None)
        bk["plan_name"] = (snap or {}).get("name")
        bk["next_installment"] = None
        bk["overdue_count"] = await db.demands.count_documents({"booking_id": bk["id"], "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}})
        if snap and bk.get("status") == "Active":
            blk = await db.blocks.find_one({"id": bk["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
            rows = schedule({**bk, "payment_plan_snapshot": snap}, blk, await db.demands.find({"booking_id": bk["id"]}, {"_id": 0}).to_list(None))
            nxt = next((r for r in rows if r["status"] == "Not yet due"), None)
            bk["next_installment"] = {"name": nxt["name"], "trigger_label": nxt["trigger_label"], "expected_date": nxt["expected_date"], "total_paise": nxt["total_expected_paise"]} if nxt else None
        sm = bk.get("summary") or {}
        bk["plan_summary"] = {"plan_name": bk["plan_name"], "next_installment": bk["next_installment"], "overdue_count": bk["overdue_count"],
                              "raised": {"cash_paise": sm.get("cash_order_raised_paise", 0), "account_paise": sm.get("account_order_raised_paise", 0), "total_paise": sm.get("total_order_raised_paise", 0)},
                              "paid": {"cash_paise": sm.get("cash_paid_paise", 0), "account_paise": sm.get("account_paid_paise", 0), "total_paise": sm.get("paid_paise", 0)},
                              "due": {"cash_paise": sm.get("cash_due_paise", 0), "account_paise": sm.get("account_due_paise", 0), "total_paise": sm.get("due_paise", 0)}}
    out["leads"] = await db.leads.find({"converted_customer_id": customer_id}, {"_id": 0, "id": 1, "lead_number": 1, "status": 1, "stage_history": 1}).to_list(20)
    return out


@router.patch("/{customer_id}")
async def update_customer(customer_id: str, body: CustomerUpdate, request: Request, user: dict = Depends(require("sales.customer.edit"))):
    before = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    await _dup_check(user["company_id"], changes.get("phone"), changes.get("pan"), exclude_id=customer_id)
    changes = _prepare(changes)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    after = await apply_update(db.customers, before, changes, expected_version(request, body.version), "Customer")
    if {"full_name", "phone"} & set(changes):
        from services.money_ops import fan_out_customer
        await fan_out_customer(after, user)
    await write_audit(user, "customer.update", "customer", customer_id, before=present(before), after=present(after), ip=client_ip(request))
    return present(after)


@router.post("/{customer_id}/kyc-status")
async def set_kyc_status(customer_id: str, body: KycStatusIn, request: Request, user: dict = Depends(require("sales.kyc.edit"))):
    before = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    changes = {"kyc_status": body.kyc_status, "kyc_note": body.note}
    if body.kyc_status == "Verified":
        changes.update(kyc_verified_by=user["id"], kyc_verified_at=datetime.now(UTC).isoformat())
    after = await apply_update(db.customers, before, changes, expected_version(request, body.version), "Customer")
    await write_audit(user, "customer.kyc_status", "customer", customer_id, before={"kyc_status": before.get("kyc_status")}, after=changes, ip=client_ip(request))
    return present(after)


@router.get("/{customer_id}/payments")
async def customer_payments(customer_id: str, user: dict = Depends(require("finance.payment.view"))):
    from services.money import present_money
    rows = await db.payments.find({"customer_id": customer_id, **project_scope_filter(user)}, {"_id": 0}).sort("payment_date", -1).to_list(200)
    return {"items": present_money(rows), "total": len(rows)}
