from datetime import UTC
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from crypto import decrypt_field, encrypt_field, mask
from db import db
from deps import require_any, get_current_user, require
from utils import (
    ApiError,
    StrictModel,
    apply_update,
    client_ip,
    expected_version,
    write_audit,
)

router = APIRouter(prefix="/settings", tags=["settings"])


class Address(StrictModel):
    line1: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None


class BankAccount(StrictModel):
    bank_name: str | None = None
    account_name: str | None = None
    account_number: str | None = Field(default=None, min_length=4, max_length=34)
    ifsc: str | None = None
    branch: str | None = None


class CompanyUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    legal_name: str | None = None
    address: Address | None = None
    gstin: str | None = None
    rera_registration: str | None = None
    logo_url: str | None = None
    financial_year_start_month: int | None = Field(default=None, ge=1, le=12)
    receipt_prefix: str | None = Field(default=None, max_length=10)
    booking_number_format: str | None = Field(default=None, max_length=40, description="Tokens: {FY} {PREFIX} {SEQ}")
    receipt_number_format: str | None = Field(default=None, max_length=40)
    customer_number_format: str | None = Field(default=None, max_length=40)
    demand_number_format: str | None = Field(default=None, max_length=40)
    demand_due_days: int | None = Field(default=None, ge=1, le=120)
    authorised_signatory_name: str | None = Field(default=None, max_length=120)
    letterhead_tagline: str | None = Field(default=None, max_length=200)
    letterhead_phone: str | None = Field(default=None, max_length=40)
    letterhead_email: str | None = Field(default=None, max_length=120)
    letterhead_footer_note: str | None = Field(default=None, max_length=300)
    authorised_signatory_designation: str | None = Field(default=None, max_length=120)
    logo_file_id: str | None = Field(default=None, description="File id from the upload pipeline; its 320px WebP variant prints on every PDF")
    default_gst_percent: float | None = Field(default=None, ge=0, le=28)
    mfa_required_for_admin_roles: bool | None = None
    accent: Literal["gold", "teal"] | None = None
    bank_account: BankAccount | None = None
    audit_retention_months: int | None = Field(default=None, ge=1, le=120, description="Hot audit window; older rows move to audit_logs_archive monthly")
    version: int | None = None


@router.get("/numbering/preview")
async def numbering_preview(user: dict = Depends(require("admin.settings.view"))):
    """Shows what the next booking/receipt numbers would look like using atomic counters (peek, no increment)."""
    c = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    from datetime import datetime
    now = datetime.now(UTC)
    start = c.get("financial_year_start_month") or 4
    y = now.year if now.month >= start else now.year - 1
    fy = f"{str(y)[-2:]}{str(y + 1)[-2:]}"
    out = {}
    from services.numbering import DEFAULT_FORMATS
    for kind in ("booking", "receipt", "customer", "demand"):
        fmt = c.get(f"{kind}_number_format") or DEFAULT_FORMATS[kind]
        cnt = await db.counters.find_one({"scope": f"{kind}_number", "key": fy}, {"_id": 0, "seq": 1})
        out[kind] = fmt.replace("{FY}", fy).replace("{PREFIX}", c.get("receipt_prefix") or "RC").replace("{SEQ}", str((cnt or {}).get("seq", 0) + 1).zfill(5 if kind == "receipt" else 4))
    return {"financial_year": fy, "next": out}


def present(company: dict) -> dict:
    c = dict(company)
    ba = dict(c.get("bank_account") or {})
    enc = ba.pop("account_number_enc", None)
    ba["account_number_masked"] = mask(decrypt_field(enc))
    c["bank_account"] = ba
    return c


@router.get("/company")
async def get_company(user: dict = Depends(get_current_user)):
    """Letterhead fields (name, address, GSTIN, RERA, logo_file_id, signatory, footer note) feed every generated PDF."""
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    if not company:
        raise ApiError(404, "Company not found", "NOT_FOUND")
    out = present(company)
    if "admin.settings.view" not in user["permissions"] and "masters.company.view" not in user["permissions"] and "*" not in user["permissions"]:
        out = {k: out[k] for k in ("id", "name", "brand", "legal_name", "logo_url", "financial_year_start_month", "accent") if k in out}
    return out


@router.patch("/company")
async def update_company(body: CompanyUpdate, request: Request, user: dict = Depends(require_any("admin.settings.edit", "masters.company.edit"))):
    before = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    if "mfa_required_for_admin_roles" in changes:
        await db.settings.update_one({"key": "mfa_required_for_admin_roles"}, {"$set": {"value": changes["mfa_required_for_admin_roles"]}}, upsert=True)
    if "bank_account" in changes:
        ba = {**(before.get("bank_account") or {})}
        incoming = changes["bank_account"] or {}
        for k, v in incoming.items():
            if k == "account_number":
                if v:
                    ba["account_number_enc"] = encrypt_field(v)
            else:
                ba[k] = v
        changes["bank_account"] = ba
    after = await apply_update(db.companies, before, changes, expected_version(request, body.version), "Company")
    await write_audit(user, "company.update", "company", user["company_id"], before=present(before), after=present(after), ip=client_ip(request))
    return present(after)
