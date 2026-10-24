from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field, field_validator

from db import db
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
    salutation: Literal["Mr", "Mrs", "Ms", "Dr", "M/s"] | None = None
    full_name: str = Field(min_length=2, max_length=120)
    father_or_spouse_name: str | None = None
    dob: date | None = None
    gender: Literal["Male", "Female", "Other"] | None = None
    phone: str
    alt_phone: str | None = None
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    address_current: Address | None = None
    address_permanent: Address | None = None
    permanent_same_as_current: bool = False
    occupation: str | None = None
    company_name: str | None = None
    annual_income_band: Literal["<5L", "5-10L", "10-25L", "25-50L", "50L-1Cr", ">1Cr"] | None = None
    source: Literal["Walk-in", "Website", "Referral", "Broker", "Campaign"] | None = None
    assigned_sales_user_id: str | None = None
    pan: str | None = None
    aadhaar: str | None = None
    bank: Bank | None = None
    nominee: Nominee | None = None
    co_applicants: list[CoApplicant] = []
    notes: str | None = None
    tags: list[str] = []

    @field_validator("phone", "alt_phone")
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


@router.get("")
async def list_customers(params: ListParams = Depends(), has_overdue: bool = False, kyc_status: str | None = None, source: str | None = None,
                         assigned_sales_user_id: str | None = None, user: dict = Depends(require("customer.read"))):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["full_name", "phone", "customer_code", "email"])}
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
    today = date.today().isoformat()
    if has_overdue:
        q["id"] = {"$in": await db.demands.distinct("customer_id", {"voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}})}
    res = await paginate(db.customers, q, params, params.sort_spec(["full_name", "customer_code", "created_at", "kyc_status", "phone"], "-created_at"))
    res["items"] = [present(c) for c in res["items"]]
    ids = [c["id"] for c in res["items"]]
    dues = {d["_id"]: d["due"] for d in await db.bookings.aggregate([{"$match": {"customer_id": {"$in": ids}, "status": "Active"}}, {"$group": {"_id": "$customer_id", "due": {"$sum": {"$add": [{"$ifNull": ["$summary.due_paise", 0]}, {"$ifNull": ["$summary.other_charges_due_paise", 0]}]}}}}]).to_list(None)}
    od = {d["_id"]: d["n"] for d in await db.demands.aggregate([{"$match": {"customer_id": {"$in": ids}, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}}}, {"$group": {"_id": "$customer_id", "n": {"$sum": 1}}}]).to_list(None)}
    for c in res["items"]:
        c["total_due_paise"] = dues.get(c["id"], 0)
        c["total_due"] = round(c["total_due_paise"] / 100, 2)
        c["overdue_count"] = od.get(c["id"], 0)
    if res.pop("_csv", False):
        from fastapi import Response
        return Response(to_csv(res["items"], ["customer_code", "full_name", "phone", "email", "source", "kyc_status", "pan_masked", "created_at"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=customers.csv"})
    return res


@router.post("", status_code=201)
async def create_customer(body: CustomerIn, request: Request, user: dict = Depends(require("customer.write"))):
    await _dup_check(user["company_id"], body.phone, body.pan)
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    doc = {**base_doc(user, user["company_id"]), **_prepare(body.model_dump()), "customer_code": await generate_number("customer", company),
           "kyc_status": "Pending", "kyc_verified_by": None, "kyc_verified_at": None}
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "customer.create", "customer", doc["id"], after=present(doc), ip=client_ip(request))
    return present(doc)


@router.get("/{customer_id}")
async def get_customer(customer_id: str, request: Request, reveal: bool = Query(False), user: dict = Depends(require("customer.read"))):
    doc = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    do_reveal = reveal and "customer.kyc_view" in user["permissions"]
    if reveal and not do_reveal:
        raise ApiError(403, "Missing permission: customer.kyc_view", "FORBIDDEN")
    if do_reveal:
        await write_audit(user, "customer.kyc_reveal", "customer", customer_id, after={"revealed": ["pan", "aadhaar", "bank.account_number"]}, ip=client_ip(request))
    out = present(doc, do_reveal)
    out["bookings"] = await db.bookings.find({"$or": [{"customer_id": customer_id}, {"co_applicant_customer_ids": customer_id}]}, {"_id": 0, "id": 1, "booking_number": 1, "status": 1, "flat_snapshot": 1, "project_id": 1, "agreement_value_paise": 1, "summary": 1, "booking_date": 1, "payment_plan_snapshot": 1, "block_id": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1}).to_list(50)
    from services.dues_engine import schedule
    today = date.today().isoformat()
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
async def update_customer(customer_id: str, body: CustomerUpdate, request: Request, user: dict = Depends(require("customer.write"))):
    before = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    await _dup_check(user["company_id"], changes.get("phone"), changes.get("pan"), exclude_id=customer_id)
    changes = _prepare(changes)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    after = await apply_update(db.customers, before, changes, expected_version(request, body.version), "Customer")
    await write_audit(user, "customer.update", "customer", customer_id, before=present(before), after=present(after), ip=client_ip(request))
    return present(after)


@router.post("/{customer_id}/kyc-status")
async def set_kyc_status(customer_id: str, body: KycStatusIn, request: Request, user: dict = Depends(require("customer.kyc_view"))):
    before = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    changes = {"kyc_status": body.kyc_status, "kyc_note": body.note}
    if body.kyc_status == "Verified":
        changes.update(kyc_verified_by=user["id"], kyc_verified_at=datetime.now(UTC).isoformat())
    after = await apply_update(db.customers, before, changes, expected_version(request, body.version), "Customer")
    await write_audit(user, "customer.kyc_status", "customer", customer_id, before={"kyc_status": before.get("kyc_status")}, after=changes, ip=client_ip(request))
    return present(after)


@router.get("/{customer_id}/payments")
async def customer_payments(customer_id: str, user: dict = Depends(require("payment.read"))):
    from services.money import present_money
    rows = await db.payments.find({"customer_id": customer_id, **project_scope_filter(user)}, {"_id": 0}).sort("payment_date", -1).to_list(200)
    return {"items": present_money(rows), "total": len(rows)}
