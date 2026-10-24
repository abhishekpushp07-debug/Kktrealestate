import os
"""Customer Portal: auth (aud=portal), scoped read APIs, service requests, notices, profile. Phase 5."""
import secrets
from datetime import UTC, date, datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from crypto import decrypt_field, mask
from services.kyc import mask_aadhaar, mask_pan
from db import db
from deps import JWT_ALG, JWT_SECRET, enforce_rate_limit, require
from routers.auth import _hash_token, hash_password, validate_password_policy, verify_password
from services.filesig import sniff
from services.money import pct_of, present_money
from storage import put_object
from utils import ApiError, StrictModel, base_doc, client_ip, now_iso, write_audit

router = APIRouter(prefix="/portal", tags=["portal"])
bearer = HTTPBearer(auto_error=False)
PORTAL_ACCESS_MIN = 30
PORTAL_REFRESH_DAYS = 30
SR_STATUSES = ["New", "In Progress", "Awaiting Customer", "Resolved", "Closed"]
SLA_DEFAULT = {"High": 24, "Medium": 72, "Low": 168}


def _mint(acc: dict, ttype="access", minutes=PORTAL_ACCESS_MIN, scope="full") -> str:
    now = datetime.now(UTC)
    return jwt.encode({"sub": acc["id"], "cust": acc["customer_id"], "cid": acc["company_id"], "aud": "portal", "type": ttype, "scope": scope, "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=minutes)).timestamp())}, JWT_SECRET, algorithm=JWT_ALG)


async def portal_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if creds is None:
        raise ApiError(401, "Not authenticated", "UNAUTHENTICATED")
    try:
        p = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG], audience="portal", leeway=30)
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "Token expired", "TOKEN_EXPIRED")
    except jwt.PyJWTError:
        raise ApiError(401, "Invalid token", "INVALID_TOKEN")
    if p.get("type") != "access":
        raise ApiError(401, "Invalid token type", "INVALID_TOKEN")
    acc = await db.portal_accounts.find_one({"id": p["sub"], "is_active": True}, {"_id": 0, "password_hash": 0})
    if not acc:
        raise ApiError(401, "Account inactive", "USER_INACTIVE")
    if p.get("scope") == "pwchange" and not request.url.path.endswith("/change-password"):
        raise ApiError(403, "Password change required", "PASSWORD_CHANGE_REQUIRED")
    cust = await db.customers.find_one({"id": acc["customer_id"]}, {"_id": 0})
    if not cust:
        raise ApiError(401, "Customer not found", "USER_INACTIVE")
    acc["customer"] = cust
    request.state.user_id = f"customer:{cust['id']}"
    if request.method in ("POST", "PATCH", "PUT", "DELETE"):
        await enforce_rate_limit(f"portal-write:{acc['id']}", 60, 60)
    return acc


def _booking_scope(acc: dict) -> dict:
    cid = acc["customer_id"]
    return {"company_id": acc["company_id"], "$or": [{"customer_id": cid}, {"co_applicant_customer_ids": cid}]}


async def portal_booking(booking_id: str, acc: dict = Depends(portal_user)) -> dict:
    b = await db.bookings.find_one({"id": booking_id, **_booking_scope(acc)}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    return b


async def _rm(b: dict | None) -> dict | None:
    if not b or not b.get("sales_user_id"):
        return None
    u = await db.users.find_one({"id": b["sales_user_id"]}, {"_id": 0, "name": 1, "phone": 1})
    return {"name": u["name"], "phone": u.get("phone")} if u else None


@router.get("/config")
async def portal_config():
    """Public branding for the portal/Expo login screen (no auth)."""
    from routers.cms import get_site
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    s = await get_site(company["id"]) if company else {}
    return {"brand_name": s.get("brand_name"), "logo_url": s.get("logo_url"), "primary_phone": s.get("phone"), "whatsapp": s.get("whatsapp"), "support_email": s.get("email"), "erp_url": os.environ.get("ERP_PUBLIC_URL"), "portal_url": s.get("portal_url") or os.environ.get("PORTAL_PUBLIC_URL")}


# ---------------- Auth ----------------
class LoginIn(StrictModel):
    phone: str
    password: str


class RefreshIn(StrictModel):
    refresh_token: str


class ChangePwIn(StrictModel):
    current_password: str
    new_password: str


async def _issue_refresh(acc: dict, request: Request) -> str:
    raw = secrets.token_urlsafe(48)
    await db.portal_refresh_tokens.insert_one({"id": secrets.token_hex(8), "account_id": acc["id"], "family": secrets.token_hex(8), "token_hash": _hash_token(raw), "revoked": False, "ip": client_ip(request), "ua": request.headers.get("user-agent", "")[:200], "created_at": now_iso(), "expires_at": (datetime.now(UTC) + timedelta(days=PORTAL_REFRESH_DAYS)).isoformat()})
    return raw


async def _login_event(phone: str, ok: bool, request: Request, reason="", account_id=None):
    await db.login_events.insert_one({"email": f"portal:{phone}", "actor_type": "customer", "account_id": account_id, "success": ok, "reason": reason, "ip": client_ip(request), "ua": request.headers.get("user-agent", "")[:300], "created_at": now_iso()})


@router.post("/auth/login")
async def login(body: LoginIn, request: Request):
    await enforce_rate_limit(f"portal-login:{client_ip(request)}", 10, 60)
    phone = body.phone.strip()[-10:]
    acc = await db.portal_accounts.find_one({"login_phone": phone}, {"_id": 0})
    if not acc or not acc.get("is_active"):
        await _login_event(phone, False, request, "no_account")
        raise ApiError(401, "Invalid phone or password", "INVALID_CREDENTIALS")
    if acc.get("locked_until") and acc["locked_until"] > now_iso():
        raise ApiError(423, "Account locked. Try again later.", "LOCKED")
    if not verify_password(body.password, acc["password_hash"]):
        fa = acc.get("failed_attempts", 0) + 1
        upd = {"failed_attempts": fa}
        if fa >= 5:
            upd.update({"locked_until": (datetime.now(UTC) + timedelta(minutes=15)).isoformat(), "failed_attempts": 0})
        await db.portal_accounts.update_one({"id": acc["id"]}, {"$set": upd})
        await _login_event(phone, False, request, "bad_password", acc["id"])
        raise ApiError(401, "Invalid phone or password", "INVALID_CREDENTIALS")
    await db.portal_accounts.update_one({"id": acc["id"]}, {"$set": {"failed_attempts": 0, "locked_until": None, "last_login_at": now_iso()}})
    await _login_event(phone, True, request, "", acc["id"])
    await write_audit({"id": f"customer:{acc['customer_id']}", "name": "Portal customer", "company_id": acc["company_id"]}, "portal.login", "portal_account", acc["id"], after={"actor_type": "customer"}, ip=client_ip(request))
    cust = await db.customers.find_one({"id": acc["customer_id"]}, {"_id": 0, "full_name": 1})
    if acc.get("must_change_password"):
        return {"must_change_password": True, "access_token": _mint(acc, minutes=10, scope="pwchange"), "name": cust["full_name"]}
    return {"must_change_password": False, "access_token": _mint(acc), "refresh_token": await _issue_refresh(acc, request), "expires_in": PORTAL_ACCESS_MIN * 60, "name": cust["full_name"]}


@router.post("/auth/refresh")
async def refresh(body: RefreshIn, request: Request):
    h = _hash_token(body.refresh_token)
    t = await db.portal_refresh_tokens.find_one({"token_hash": h})
    if not t or t["expires_at"] < now_iso():
        raise ApiError(401, "Invalid refresh token", "INVALID_TOKEN")
    if t["revoked"]:
        await db.portal_refresh_tokens.update_many({"family": t["family"]}, {"$set": {"revoked": True}})
        raise ApiError(401, "Refresh token reuse detected; all sessions revoked", "TOKEN_REUSE")
    acc = await db.portal_accounts.find_one({"id": t["account_id"], "is_active": True}, {"_id": 0, "password_hash": 0})
    if not acc:
        raise ApiError(401, "Account inactive", "USER_INACTIVE")
    await db.portal_refresh_tokens.update_one({"id": t["id"]}, {"$set": {"revoked": True}})
    raw = secrets.token_urlsafe(48)
    await db.portal_refresh_tokens.insert_one({"id": secrets.token_hex(8), "account_id": acc["id"], "family": t["family"], "token_hash": _hash_token(raw), "revoked": False, "ip": client_ip(request), "created_at": now_iso(), "expires_at": (datetime.now(UTC) + timedelta(days=PORTAL_REFRESH_DAYS)).isoformat()})
    return {"access_token": _mint(acc), "refresh_token": raw, "expires_in": PORTAL_ACCESS_MIN * 60}


@router.post("/auth/logout")
async def logout(body: RefreshIn, acc: dict = Depends(portal_user)):
    await db.portal_refresh_tokens.update_one({"token_hash": _hash_token(body.refresh_token), "account_id": acc["id"]}, {"$set": {"revoked": True}})
    return {"ok": True}


@router.post("/auth/logout-all")
async def logout_all(acc: dict = Depends(portal_user)):
    r = await db.portal_refresh_tokens.update_many({"account_id": acc["id"], "revoked": False}, {"$set": {"revoked": True}})
    return {"ok": True, "revoked": r.modified_count}


@router.post("/auth/change-password")
@router.post("/change-password")
async def change_password(body: ChangePwIn, request: Request, acc: dict = Depends(portal_user)):
    full = await db.portal_accounts.find_one({"id": acc["id"]}, {"_id": 0, "password_hash": 1})
    if not verify_password(body.current_password, full["password_hash"]):
        raise ApiError(400, "Current password is incorrect", "INVALID_CREDENTIALS")
    validate_password_policy(body.new_password)
    await db.portal_accounts.update_one({"id": acc["id"]}, {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False, "password_changed_at": now_iso()}})
    await db.portal_refresh_tokens.update_many({"account_id": acc["id"]}, {"$set": {"revoked": True}})
    await write_audit({"id": f"customer:{acc['customer_id']}", "name": acc["customer"]["full_name"], "company_id": acc["company_id"]}, "portal.change_password", "portal_account", acc["id"], after={"actor_type": "customer"}, ip=client_ip(request))
    return {"ok": True, "access_token": _mint(acc), "refresh_token": await _issue_refresh(acc, request), "expires_in": PORTAL_ACCESS_MIN * 60}


# ---------------- Profile ----------------
def _cust_public(c: dict) -> dict:
    return {"id": c["id"], "customer_code": c["customer_code"], "full_name": c["full_name"], "salutation": c.get("salutation"), "phone": c.get("phone"), "alt_phone": c.get("alt_phone"), "email": c.get("email"), "address_current": c.get("address_current"),
            "kyc_status": c.get("kyc_status"), "pan_masked": mask_pan(decrypt_field(c.get("pan_enc"))) if c.get("pan_enc") else None, "aadhaar_masked": mask_aadhaar(decrypt_field(c.get("aadhaar_enc"))) if c.get("aadhaar_enc") else None}


@router.get("/me")
@router.get("/auth/me")
async def me(acc: dict = Depends(portal_user)):
    c = acc["customer"]
    bks = await db.bookings.find(_booking_scope(acc), {"_id": 0, "id": 1, "booking_number": 1, "co_applicant_customer_ids": 1, "sales_user_id": 1}).to_list(20)
    co_ids = {x for b in bks for x in (b.get("co_applicant_customer_ids") or [])} - {c["id"]}
    cos = [{"full_name": x["full_name"], "phone": mask(x.get("phone"), 4)} for x in await db.customers.find({"id": {"$in": list(co_ids)}}, {"_id": 0, "full_name": 1, "phone": 1}).to_list(10)]
    company = await db.companies.find_one({"id": acc["company_id"]}, {"_id": 0, "name": 1, "legal_name": 1, "letterhead_phone": 1, "letterhead_email": 1})
    unread = await db.notices.count_documents({"company_id": acc["company_id"], "publish_at": {"$lte": now_iso()}, "$or": [{"expires_at": None}, {"expires_at": {"$gte": now_iso()}}], "id": {"$nin": acc.get("read_notice_ids") or []}})
    return {"customer": _cust_public(c), "co_applicants": cos, "relationship_manager": await _rm(bks[0] if bks else None), "bookings_count": len(bks), "must_change_password": acc.get("must_change_password", False), "last_login_at": acc.get("last_login_at"), "company": company, "unread_notices": unread}


class ProfileIn(StrictModel):
    email: str | None = None
    alt_phone: str | None = None
    address_current: dict | None = None


@router.patch("/me")
async def update_me(body: ProfileIn, request: Request, acc: dict = Depends(portal_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise ApiError(422, "Nothing to update", "VALIDATION_ERROR")
    if "alt_phone" in upd and not upd["alt_phone"].isdigit():
        raise ApiError(422, "Invalid phone", "VALIDATION_ERROR")
    before = {k: acc["customer"].get(k) for k in upd}
    await db.customers.update_one({"id": acc["customer_id"]}, {"$set": {**upd, "updated_via_portal_at": now_iso(), "updated_at": now_iso()}, "$inc": {"version": 1}})
    await write_audit({"id": f"customer:{acc['customer_id']}", "name": acc["customer"]["full_name"], "company_id": acc["company_id"]}, "portal.profile_update", "customer", acc["customer_id"], before=before, after={**upd, "actor_type": "customer", "via": "portal"}, ip=client_ip(request))
    return _cust_public(await db.customers.find_one({"id": acc["customer_id"]}, {"_id": 0}))


@router.get("/bank-details")
async def bank_details(acc: dict = Depends(portal_user)):
    banks = await db.bank_accounts.find({"company_id": acc["company_id"], "is_active": True}, {"_id": 0, "bank_name": 1, "account_name": 1, "branch": 1, "ifsc": 1, "account_number_enc": 1, "account_number": 1, "is_default": 1}).to_list(5)
    out = [{"bank_name": b.get("bank_name"), "account_name": b.get("account_name"), "branch": b.get("branch"), "ifsc": b.get("ifsc"), "account_number": decrypt_field(b["account_number_enc"]) if b.get("account_number_enc") else b.get("account_number"), "is_default": b.get("is_default", False)} for b in banks]
    return {"items": out, "note": "Transfer only to these company accounts for the Account bucket. Verify details with your Relationship Manager before transferring; share the UTR with them for a receipt."}


# ---------------- Bookings ----------------
def _card(b: dict, blk: dict | None, proj: dict | None) -> dict:
    s = b.get("summary") or {}
    fs = b.get("flat_snapshot") or {}
    return {"id": b["id"], "booking_number": b["booking_number"], "booking_date": b["booking_date"], "status": b["status"], "project_name": b["project_name"], "block_name": b["block_name"], "flat_number": fs.get("flat_number"), "floor": fs.get("floor"), "flat_type": fs.get("flat_type_code"), "super_builtup_sqft": fs.get("super_builtup_sqft"),
            "construction_percent": (blk or {}).get("construction_percent", 0), "current_milestone": next((m["name"] for m in reversed((blk or {}).get("milestones") or []) if m["status"] == "Completed"), None), "next_milestone": next((m["name"] for m in (blk or {}).get("milestones") or [] if m["status"] == "Pending"), None),
            "cover_image": ((proj or {}).get("website") or {}).get("hero_images", [None])[0] if proj else None, "agreement_value_paise": b["agreement_value_paise"], "cash_agreed_paise": b["cash_agreed_paise"], "account_agreed_paise": b["account_agreed_paise"],
            "paid_paise": s.get("paid_paise", 0), "cash_paid_paise": s.get("cash_paid_paise", 0), "account_paid_paise": s.get("account_paid_paise", 0), "cash_due_paise": s.get("cash_due_paise", 0), "account_due_paise": s.get("account_due_paise", 0), "other_charges_due_paise": s.get("other_charges_due_paise", 0), "total_due_paise": s.get("due_paise", 0) + s.get("other_charges_due_paise", 0), "pending_cheques_paise": s.get("pending_cheques_paise", 0),
            "is_primary": True}


@router.get("/bookings")
async def my_bookings(acc: dict = Depends(portal_user)):
    bks = await db.bookings.find(_booking_scope(acc), {"_id": 0}).sort("booking_date", -1).to_list(20)
    blocks = {b["id"]: b for b in await db.blocks.find({"id": {"$in": [x["block_id"] for x in bks]}}, {"_id": 0, "id": 1, "construction_percent": 1, "milestones": 1}).to_list(None)}
    projs = {p["id"]: p for p in await db.projects.find({"id": {"$in": [x["project_id"] for x in bks]}}, {"_id": 0, "id": 1, "website.hero_images": 1}).to_list(None)}
    out = []
    from services.dues_engine import schedule
    for b in bks:
        c = _card(b, blocks.get(b["block_id"]), projs.get(b["project_id"]))
        c["is_primary"] = b["customer_id"] == acc["customer_id"]
        nd = await db.demands.find_one({"booking_id": b["id"], "voided": False, "status": {"$in": ["Open", "Partially Paid"]}}, {"_id": 0, "due_date": 1, "total_demand_paise": 1, "paid_paise": 1, "milestone_name": 1}, sort=[("due_date", 1)])
        c["next_due"] = {"due_date": nd["due_date"], "amount_paise": nd["total_demand_paise"] - nd.get("paid_paise", 0), "milestone": nd["milestone_name"]} if nd else None
        snap = b.get("payment_plan_snapshot")
        c["payment_plan"] = {"name": snap["name"], "plan_type": snap.get("plan_type")} if snap else None
        c["next_installment"] = None
        if snap and b.get("status") == "Active":
            blk_full = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
            nxt = next((r for r in schedule(b, blk_full, await db.demands.find({"booking_id": b["id"]}, {"_id": 0}).to_list(None)) if r["status"] == "Not yet due"), None)
            c["next_installment"] = _next_installment(nxt)
        out.append(c)
    return present_money({"items": out})


def _next_installment(nxt: dict | None) -> dict | None:
    if not nxt:
        return None
    return {"name": nxt["name"], "percent": nxt["percent"], "trigger_label": nxt["trigger_label"], "expected_date": nxt["expected_date"], "due_date": nxt["expected_date"], "cash_expected_paise": nxt["cash_expected_paise"], "account_expected_paise": nxt["account_expected_paise"], "total_expected_paise": nxt["total_expected_paise"]}


@router.get("/bookings/{booking_id}")
async def booking_detail(b: dict = Depends(portal_booking), acc: dict = Depends(portal_user)):
    blk = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "construction_percent": 1, "milestones": 1})
    proj = await db.projects.find_one({"id": b["project_id"]}, {"_id": 0, "website.hero_images": 1, "address": 1, "rera_number": 1})
    flat = await db.flats.find_one({"id": b["flat_id"]}, {"_id": 0, "flat_type_id": 1, "facing": 1, "plc_ids": 1, "floor_plan_template_id": 1, "price": 1})
    ft = await db.flat_types.find_one({"id": (flat or {}).get("flat_type_id")}, {"_id": 0, "name": 1, "bhk": 1, "rooms": 1, "areas": 1, "specifications": 1, "floor_plan_image_url": 1}) or {}
    fpt = await db.floor_plan_templates.find_one({"id": (flat or {}).get("floor_plan_template_id")}, {"_id": 0, "image_url": 1, "name": 1}) if (flat or {}).get("floor_plan_template_id") else None
    rooms = {r["id"]: r["name"] for r in await db.room_types.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    areas = {a["id"]: a["name"] for a in await db.area_types.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    parking = await db.parking_slots.find({"id": {"$in": b.get("parking_slot_ids") or []}}, {"_id": 0, "slot_number": 1, "level": 1, "type": 1}).to_list(5)
    card = _card(b, blk, proj)
    card.update({"address": (proj or {}).get("address"), "rera_number": (proj or {}).get("rera_number"), "flat": {"type_name": ft.get("name"), "bhk": ft.get("bhk"), "facing": (flat or {}).get("facing"), "rooms": [{"room": rooms.get(r.get("room_type_id"), r.get("label")), "label": r.get("label"), "length_ft": r.get("length_ft"), "width_ft": r.get("width_ft")} for r in ft.get("rooms") or []],
                 "areas": [{"area": areas.get(a.get("area_type_id")), "sqft": a.get("sqft")} for a in ft.get("areas") or []], "specifications": ft.get("specifications") or {}, "floor_plan_image": (fpt or {}).get("image_url") or ft.get("floor_plan_image_url")}, "parking": parking,
                 "price_breakup": {"agreement_value_paise": b["agreement_value_paise"], "cash_paise": b["cash_agreed_paise"], "account_paise": b["account_agreed_paise"], "other_charges": [{"name": c["name"], "amount_paise": c["amount_paise"], "gst_paise": c.get("gst_paise", 0), "total_paise": c["total_paise"], "paid_paise": c.get("paid_paise", 0)} for c in b.get("other_charges") or []]},
                 "agreement_revisions": [{"at": r.get("at") or r.get("revised_at"), "reason": r.get("reason"), "new_agreement_value_paise": r.get("new_agreement_value_paise") or (r.get("after") or {}).get("agreement_value_paise")} for r in b.get("agreement_revisions") or []], "relationship_manager": await _rm(b), "co_applicant": b["customer_id"] != acc["customer_id"]})
    snap = b.get("payment_plan_snapshot")
    card["payment_plan"] = {"name": snap["name"], "plan_type": snap.get("plan_type"), "accepted_on": (b.get("plan_acceptance") or {}).get("accepted_on")} if snap else None
    card["next_installment"] = None
    if snap:
        from services.dues_engine import schedule
        blk_full = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
        rows = schedule(b, blk_full, await db.demands.find({"booking_id": b["id"]}, {"_id": 0}).to_list(None))
        nxt = next((r for r in rows if r["status"] == "Not yet due"), None)
        card["next_installment"] = _next_installment(nxt)
    return present_money(card)


def _bucket(e: dict) -> str | None:
    if e["type"] in ("OTHER_CHARGE_DEMAND", "OTHER_CHARGE_PAYMENT"):
        return "Other charges"
    if e.get("category") in ("Cash", "Account"):
        return e["category"]
    return None


@router.get("/bookings/{booking_id}/ledger")
async def booking_ledger(b: dict = Depends(portal_booking)):
    rows = await db.ledger_entries.find({"booking_id": b["id"]}, {"_id": 0}).sort("seq", 1).to_list(None)
    labels = {"DEMAND": "Demand raised", "PAYMENT": "Payment received", "OTHER_CHARGE_DEMAND": "Charge demanded", "OTHER_CHARGE_PAYMENT": "Charge paid", "REVERSAL": "Payment reversed", "REVISION": "Agreement revised", "CANCELLATION": "Booking cancelled"}
    return present_money({"items": [{"seq": e["seq"], "date": e["date"], "description": f"{labels.get(e['type'], e['type'].title())}{' — ' + e['note'] if e.get('note') else ''}", "bucket": _bucket(e), "amount_paise": e["amount_paise"], "type": e["type"], "ref": e.get("ref"), "cash_paid_cum_paise": e["cash_paid_cum_paise"], "account_paid_cum_paise": e["account_paid_cum_paise"],
                                     "cash_due_paise": e["cash_due_paise"], "account_due_paise": e["account_due_paise"], "total_due_paise": e["total_due_paise"], "other_charges_due_paise": e.get("other_charges_due_paise", 0)} for e in rows]})


@router.get("/bookings/{booking_id}/payments")
async def booking_payments(b: dict = Depends(portal_booking)):
    ps = await db.payments.find({"booking_id": b["id"]}, {"_id": 0, "id": 1, "receipt_number": 1, "payment_date": 1, "amount_paise": 1, "payment_mode_name": 1, "payment_category": 1, "against": 1, "other_charge_name": 1, "status": 1, "instrument": 1, "bounced_at": 1}).sort("payment_date", -1).to_list(None)
    return present_money({"items": ps, "pending_cheques": [p for p in ps if p["status"] == "Pending"]})


@router.get("/bookings/{booking_id}/demands")
async def booking_demands(b: dict = Depends(portal_booking)):
    ds = await db.demands.find({"booking_id": b["id"], "voided": False}, {"_id": 0, "id": 1, "demand_number": 1, "demand_date": 1, "due_date": 1, "milestone_name": 1, "cumulative_percent": 1, "cash_demand_paise": 1, "account_demand_paise": 1, "total_demand_paise": 1, "paid_paise": 1, "status": 1}).sort("milestone_seq", 1).to_list(None)
    return present_money({"items": ds})


@router.get("/bookings/{booking_id}/schedule")
async def booking_schedule(b: dict = Depends(portal_booking)):
    blk = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "milestones": 1, "construction_stages": 1}) or {}
    if b.get("payment_plan_snapshot"):
        from services.dues_engine import schedule
        rows = schedule(b, blk, await db.demands.find({"booking_id": b["id"]}, {"_id": 0}).to_list(None))
        return present_money({"plan": {"name": b["payment_plan_snapshot"]["name"], "plan_type": b["payment_plan_snapshot"].get("plan_type")}, "items": [{"seq": r["seq"], "name": r["name"], "cumulative_percent": r["cumulative_percent"], "percent": r["percent"], "cash_paise": r["cash_expected_paise"], "account_paise": r["account_expected_paise"], "total_paise": r["total_expected_paise"], "cash_expected_paise": r["cash_expected_paise"], "account_expected_paise": r["account_expected_paise"], "cash_paid_paise": r["cash_paid_paise"], "account_paid_paise": r["account_paid_paise"], "paid_paise": r["paid_paise"], "construction_status": "Completed" if r["status"] != "Not yet due" else "Pending", "completed_on": r["raised_on"], "demanded": r["status"] != "Not yet due", "due_date": r["due_date"], "demand_status": r["status"] if r["status"] != "Not yet due" else None, "status": r["status"], "trigger_label": r["trigger_label"], "expected_date": r["expected_date"]} for r in rows]})
    done = {m["seq"]: m for m in blk.get("milestones") or []}
    dem = {d["milestone_seq"]: d for d in await db.demands.find({"booking_id": b["id"], "voided": False}, {"_id": 0, "milestone_seq": 1, "paid_paise": 1, "total_demand_paise": 1, "status": 1, "due_date": 1}).to_list(None)}
    prev = 0
    rows = []
    for m in b.get("milestone_template_snapshot") or []:
        inc = m["cumulative_percent"] - prev
        prev = m["cumulative_percent"]
        d = dem.get(m["seq"])
        rows.append({"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"], "cash_paise": pct_of(b["cash_agreed_paise"], inc), "account_paise": pct_of(b["account_agreed_paise"], inc), "total_paise": pct_of(b["agreement_value_paise"], inc), "construction_status": done.get(m["seq"], {}).get("status", "Pending"), "completed_on": done.get(m["seq"], {}).get("completed_on"),
                     "demanded": bool(d), "due_date": (d or {}).get("due_date"), "paid_paise": (d or {}).get("paid_paise", 0), "demand_status": (d or {}).get("status")})
    return present_money({"items": rows})


@router.get("/bookings/{booking_id}/documents")
async def booking_documents(b: dict = Depends(portal_booking)):
    docs = await db.documents.find({"is_active": True, "shared_with_customer": True, "$or": [{"entity_type": "booking", "entity_id": b["id"]}, {"entity_type": "customer", "entity_id": b["customer_id"]}]}, {"_id": 0, "id": 1, "title": 1, "file_name": 1, "mime": 1, "size": 1, "created_at": 1, "document_type_name": 1}).sort("created_at", -1).to_list(50)
    return {"items": docs}


@router.get("/bookings/{booking_id}/documents/{doc_id}/download")
async def booking_document_download(doc_id: str, b: dict = Depends(portal_booking)):
    from storage import get_object
    d = await db.documents.find_one({"id": doc_id, "is_active": True, "shared_with_customer": True, "$or": [{"entity_type": "booking", "entity_id": b["id"]}, {"entity_type": "customer", "entity_id": b["customer_id"]}]}, {"_id": 0})
    if not d:
        raise ApiError(404, "Document not found", "NOT_FOUND")
    data, mime = await get_object(d["storage_key"])
    return Response(content=data, media_type=mime or d.get("mime"), headers={"Content-Disposition": f'inline; filename="{d["file_name"]}"'})


@router.get("/bookings/{booking_id}/construction")
async def booking_construction(b: dict = Depends(portal_booking)):
    blk = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "name": 1, "construction_percent": 1, "milestones": 1}) or {}
    photos = await db.construction_photos.find({"block_id": b["block_id"], "visible_to_customers": True, "is_active": True}, {"_id": 0, "id": 1, "milestone_seq": 1, "url": 1, "caption": 1, "taken_on": 1, "order": 1}).sort("order", 1).to_list(500)
    by = {}
    for p in photos:
        by.setdefault(p["milestone_seq"], []).append(p)
    ms = [{"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"], "status": m["status"], "completed_on": m.get("completed_on"), "update": m.get("progress_note"), "photos": by.get(m["seq"], [])} for m in blk.get("milestones") or []]
    return {"block_name": blk.get("name"), "construction_percent": blk.get("construction_percent", 0), "milestones": ms, "stages": [{"seq": m["seq"], "name": m["name"], "status": m["status"], "completed_on": m["completed_on"], "notes": m.get("update"), "photos": m["photos"]} for m in ms], "up_next": next((m["name"] for m in ms if m["status"] == "Pending"), None)}


# ---------------- PDFs (reuse ERP builders with a synthetic staff context) ----------------
def _staff_ctx(acc: dict) -> dict:
    return {"id": f"customer:{acc['customer_id']}", "name": acc["customer"]["full_name"], "company_id": acc["company_id"], "permissions": set(), "role_name": "Customer", "project_scope": ["*"]}


@router.get("/bookings/{booking_id}/statement.pdf")
async def statement_pdf(b: dict = Depends(portal_booking), acc: dict = Depends(portal_user)):
    from routers.reports import statement
    return await statement(b["id"], "pdf", _staff_ctx(acc))


@router.get("/bookings/{booking_id}/allotment.pdf")
async def allotment_pdf(b: dict = Depends(portal_booking), acc: dict = Depends(portal_user)):
    from routers.reports import allotment
    return await allotment(b["id"], "pdf", _staff_ctx(acc))


@router.get("/bookings/{booking_id}/payments/{payment_id}/receipt.pdf")
async def receipt_pdf(payment_id: str, b: dict = Depends(portal_booking), acc: dict = Depends(portal_user)):
    from routers.pdfs import receipt_pdf as rp
    if not await db.payments.find_one({"id": payment_id, "booking_id": b["id"]}, {"_id": 1}):
        raise ApiError(404, "Receipt not found", "NOT_FOUND")
    return await rp(payment_id, _staff_ctx(acc))


@router.get("/bookings/{booking_id}/demands/{demand_id}/letter.pdf")
async def demand_pdf(demand_id: str, b: dict = Depends(portal_booking), acc: dict = Depends(portal_user)):
    from routers.pdfs import demand_letter_pdf as dp
    if not await db.demands.find_one({"id": demand_id, "booking_id": b["id"]}, {"_id": 1}):
        raise ApiError(404, "Demand not found", "NOT_FOUND")
    return await dp(b["id"], demand_id, _staff_ctx(acc))


# ---------------- Notices ----------------
def _nq(acc: dict, include_withdrawn: bool = False) -> dict:
    return {"user_id": f"customer:{acc['customer_id']}", **({} if include_withdrawn else {"withdrawn": {"$ne": True}})}


@router.get("/notifications")
async def portal_notifications(page: int = 1, page_size: int = 20, include_withdrawn: bool = False, acc: dict = Depends(portal_user)):
    from services.portal_notify import public_notification
    page, page_size = max(page, 1), min(max(page_size, 1), 100)
    q = _nq(acc, include_withdrawn)
    rows = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).to_list(page_size)
    return {"items": [public_notification(n) for n in rows], "unread_count": await db.notifications.count_documents({**q, "read": False}), "total": await db.notifications.count_documents(q), "page": page, "page_size": page_size}


@router.get("/notifications/unread-count")
async def portal_unread(acc: dict = Depends(portal_user)):
    return {"unread_count": await db.notifications.count_documents({**_nq(acc), "read": False})}


@router.post("/notifications/read-all")
async def portal_read_all(acc: dict = Depends(portal_user)):
    r = await db.notifications.update_many({**_nq(acc), "read": False}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True, "updated": r.modified_count, "unread_count": 0}


@router.post("/notifications/{notification_id}/read")
async def portal_read_one(notification_id: str, acc: dict = Depends(portal_user)):
    r = await db.notifications.update_one({"user_id": f"customer:{acc['customer_id']}", "id": notification_id}, {"$set": {"read": True, "read_at": now_iso()}})
    if not r.matched_count:
        raise ApiError(404, "Notification not found", "NOT_FOUND")
    return {"ok": True, "unread_count": await db.notifications.count_documents({**_nq(acc), "read": False})}


@router.get("/notices")
async def notices(acc: dict = Depends(portal_user)):
    pids = {b["project_id"] for b in await db.bookings.find(_booking_scope(acc), {"_id": 0, "project_id": 1}).to_list(20)}
    now = now_iso()
    items = await db.notices.find({"company_id": acc["company_id"], "is_active": True, "publish_at": {"$lte": now}, "$and": [{"$or": [{"expires_at": None}, {"expires_at": {"$gte": now}}]}, {"$or": [{"project_ids": []}, {"project_ids": {"$in": list(pids)}}]}]}, {"_id": 0, "id": 1, "title": 1, "body": 1, "publish_at": 1, "expires_at": 1, "pinned": 1, "project_names": 1}).sort([("pinned", -1), ("publish_at", -1)]).to_list(50)
    read = set(acc.get("read_notice_ids") or [])
    return {"items": [{**n, "read": n["id"] in read} for n in items], "unread": sum(1 for n in items if n["id"] not in read)}


@router.post("/notices/{notice_id}/read")
async def read_notice(notice_id: str, acc: dict = Depends(portal_user)):
    await db.portal_accounts.update_one({"id": acc["id"]}, {"$addToSet": {"read_notice_ids": notice_id}})
    return {"ok": True}


# ---------------- Service requests (customer side) ----------------
def _sr_public(sr: dict) -> dict:
    """Customer-safe view: no storage keys, staff ids, internal notes or hidden flags."""
    idx = 0
    thread = []
    for m in sr.get("thread") or []:
        if m.get("internal"):
            continue
        atts = []
        for a in m.get("attachments") or []:
            atts.append({"idx": idx, "name": a.get("name"), "mime": a.get("mime"), "size": a.get("size"), "url": f"/api/portal/service-requests/{sr['id']}/attachments/{idx}"})
            idx += 1
        thread.append({"by": m.get("by"), "author_name": m.get("author_name"), "message": m.get("message"), "at": m.get("at"), "attachments": atts})
    out = {k: sr.get(k) for k in ("id", "ticket_number", "booking_id", "booking_number", "flat_number", "project_name", "category", "priority", "subject", "description", "status", "created_at", "updated_at", "resolved_at", "closed_at", "rating", "sla_due_at")}
    out["attachments"] = thread[0]["attachments"] if thread else []
    out["thread"] = thread
    out["can_reopen"] = sr["status"] == "Resolved" and (sr.get("resolved_at") or "") >= (datetime.now(UTC) - timedelta(days=7)).isoformat()
    return out


@router.get("/service-categories")
async def sr_categories(acc: dict = Depends(portal_user)):
    return {"items": await db.service_categories.find({"company_id": acc["company_id"], "is_active": True}, {"_id": 0, "id": 1, "name": 1}).sort("order", 1).to_list(20)}


@router.get("/service-requests")
async def my_requests(acc: dict = Depends(portal_user)):
    items = await db.service_requests.find({"company_id": acc["company_id"], "customer_id": acc["customer_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"items": [_sr_public(s) for s in items]}


@router.get("/service-requests/{sr_id}")
async def my_request(sr_id: str, acc: dict = Depends(portal_user)):
    sr = await db.service_requests.find_one({"id": sr_id, "customer_id": acc["customer_id"]}, {"_id": 0})
    if not sr:
        raise ApiError(404, "Request not found", "NOT_FOUND")
    return _sr_public(sr)


async def _upload_attachments(files: list[UploadFile], prefix: str) -> list[dict]:
    out = []
    for f in files or []:
        data = await f.read()
        if not data:
            continue
        kind = sniff(data, f.content_type or "") or sniff(data, "image/jpeg") or sniff(data, "image/png") or sniff(data, "image/webp") or sniff(data, "application/pdf")
        if len(data) > 8 * 1024 * 1024 or not kind:
            raise ApiError(422, "Only JPG/PNG/WEBP/PDF up to 8 MB", "UNSUPPORTED_MEDIA")
        key = f"{prefix}/{secrets.token_hex(12)}-{f.filename}"
        res = await put_object(key, data, f.content_type)
        out.append({"name": f.filename or f"upload-{secrets.token_hex(3)}", "storage_key": res["path"], "mime": kind if kind.startswith(("image/", "application/")) else f.content_type, "size": len(data)})
    return out


async def create_service_request(company_id: str, customer: dict, booking: dict, category: str, priority: str, subject: str, description: str, attachments: list[dict], by: str, author_name: str, created_by: str | None) -> dict:
    from services.numbering import financial_year
    from utils import next_number
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "financial_year_start_month": 1}) or {}
    fy = financial_year(None, company.get("financial_year_start_month") or 4)
    seq = await next_number("service_request_number", fy)
    settings = await db.settings.find_one({"key": "sla_hours"}, {"_id": 0, "value": 1})
    hours = ((settings or {}).get("value") or SLA_DEFAULT).get(priority, 72)
    sr = {**base_doc(None, company_id), "created_by": created_by, "ticket_number": f"SR-{fy}-{str(seq).zfill(4)}", "customer_id": customer["id"], "customer_name": customer["full_name"], "customer_phone": customer.get("phone"), "booking_id": booking["id"], "booking_number": booking["booking_number"], "project_id": booking["project_id"], "project_name": booking["project_name"], "block_id": booking["block_id"], "flat_number": (booking.get("flat_snapshot") or {}).get("flat_number"),
          "category": category, "priority": priority, "subject": subject.strip(), "description": description.strip(), "attachments": attachments, "status": "New", "assigned_to": booking.get("sales_user_id"), "sla_due_at": (datetime.now(UTC) + timedelta(hours=hours)).isoformat(), "sla_breached": False, "rating": None, "resolved_at": None, "closed_at": None,
          "thread": [{"by": by, "author_name": author_name, "message": description.strip(), "attachments": attachments, "at": now_iso(), "internal": False}], "stage_history": [{"from": None, "to": "New", "at": now_iso(), "by": author_name}]}
    await db.service_requests.insert_one(sr)
    sr.pop("_id", None)
    await write_audit({"id": created_by or f"customer:{customer['id']}", "name": author_name, "company_id": company_id}, "service.create", "service_request", sr["id"], after={"ticket_number": sr["ticket_number"], "subject": sr["subject"], "customer_name": customer["full_name"], "assigned_to": sr["assigned_to"], "priority": priority, "actor_type": by}, ip=None)
    return sr


@router.get("/service-requests/{sr_id}/attachments/{idx}")
async def my_request_attachment(sr_id: str, idx: int, acc: dict = Depends(portal_user)):
    from storage import get_object
    sr = await db.service_requests.find_one({"id": sr_id, "customer_id": acc["customer_id"]}, {"_id": 0, "thread": 1})
    if not sr:
        raise ApiError(404, "Request not found", "NOT_FOUND")
    atts = [a for m in sr.get("thread") or [] if not m.get("internal") for a in (m.get("attachments") or [])]
    if idx < 0 or idx >= len(atts):
        raise ApiError(404, "Attachment not found", "NOT_FOUND")
    a = atts[idx]
    data, mime = await get_object(a["storage_key"])
    return Response(content=data, media_type=a.get("mime") or mime or "application/octet-stream", headers={"Content-Disposition": f'inline; filename="{a["name"]}"', "Cache-Control": "private, no-store"})


@router.post("/service-requests", status_code=201)
async def create_request(request: Request, booking_id: str = Form(...), category: str = Form(...), subject: str = Form(..., min_length=3, max_length=120), description: str = Form(..., min_length=3, max_length=4000), priority: str = Form("Medium"), files: list[UploadFile] = File(default=[]), file: list[UploadFile] = File(default=[]), acc: dict = Depends(portal_user)):
    files = [*files, *file]
    b = await db.bookings.find_one({"id": booking_id, **_booking_scope(acc)}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    if priority not in ("Low", "Medium", "High"):
        raise ApiError(422, "Invalid priority", "VALIDATION_ERROR")
    if not await db.service_categories.find_one({"name": category, "is_active": True}):
        raise ApiError(422, "Unknown category", "VALIDATION_ERROR")
    atts = await _upload_attachments(files, f"service/{acc['company_id']}")
    sr = await create_service_request(acc["company_id"], acc["customer"], b, category, priority, subject, description, atts, "customer", acc["customer"]["full_name"], None)
    return _sr_public(sr)


@router.post("/service-requests/{sr_id}/reply")
async def reply_request(sr_id: str, message: str = Form(..., min_length=1, max_length=4000), files: list[UploadFile] = File(default=[]), file: list[UploadFile] = File(default=[]), acc: dict = Depends(portal_user)):
    files = [*files, *file]
    sr = await db.service_requests.find_one({"id": sr_id, "customer_id": acc["customer_id"]}, {"_id": 0})
    if not sr:
        raise ApiError(404, "Request not found", "NOT_FOUND")
    if sr["status"] == "Closed":
        raise ApiError(409, "Ticket is closed", "CLOSED")
    atts = await _upload_attachments(files, f"service/{acc['company_id']}")
    msg = {"by": "customer", "author_name": acc["customer"]["full_name"], "message": message.strip(), "attachments": atts, "at": now_iso(), "internal": False}
    new_status = "In Progress" if sr["status"] == "Awaiting Customer" else sr["status"]
    await db.service_requests.update_one({"id": sr_id}, {"$push": {"thread": msg}, "$set": {"status": new_status, "updated_at": now_iso(), "last_customer_reply_at": now_iso()}})
    await write_audit({"id": f"customer:{acc['customer_id']}", "name": acc["customer"]["full_name"], "company_id": acc["company_id"]}, "service.customer_reply", "service_request", sr_id, after={"ticket_number": sr["ticket_number"], "assigned_to": sr.get("assigned_to"), "customer_name": acc["customer"]["full_name"], "actor_type": "customer"}, ip=None)
    return _sr_public(await db.service_requests.find_one({"id": sr_id}, {"_id": 0}))


class RateIn(StrictModel):
    rating: int
    comment: str | None = None


@router.post("/service-requests/{sr_id}/rate")
async def rate_request(sr_id: str, body: RateIn, acc: dict = Depends(portal_user)):
    sr = await db.service_requests.find_one({"id": sr_id, "customer_id": acc["customer_id"]}, {"_id": 0})
    if not sr:
        raise ApiError(404, "Request not found", "NOT_FOUND")
    if sr["status"] not in ("Resolved", "Closed") or not 1 <= body.rating <= 5:
        raise ApiError(422, "Rate 1-5 after resolution", "VALIDATION_ERROR")
    await db.service_requests.update_one({"id": sr_id}, {"$set": {"rating": body.rating, "rating_comment": body.comment, "status": "Closed", "closed_at": now_iso(), "updated_at": now_iso()}, "$push": {"stage_history": {"from": sr["status"], "to": "Closed", "at": now_iso(), "by": acc["customer"]["full_name"]}}})
    return _sr_public(await db.service_requests.find_one({"id": sr_id}, {"_id": 0}))


@router.post("/service-requests/{sr_id}/reopen")
async def reopen_request(sr_id: str, message: str = Form(..., min_length=1), acc: dict = Depends(portal_user)):
    sr = await db.service_requests.find_one({"id": sr_id, "customer_id": acc["customer_id"]}, {"_id": 0})
    if not sr or not _sr_public(sr)["can_reopen"]:
        raise ApiError(409, "Cannot reopen (only within 7 days of resolution)", "CANNOT_REOPEN")
    await db.service_requests.update_one({"id": sr_id}, {"$set": {"status": "In Progress", "resolved_at": None, "updated_at": now_iso()}, "$push": {"thread": {"by": "customer", "author_name": acc["customer"]["full_name"], "message": message, "attachments": [], "at": now_iso(), "internal": False}, "stage_history": {"from": "Resolved", "to": "In Progress", "at": now_iso(), "by": acc["customer"]["full_name"]}}})
    await write_audit({"id": f"customer:{acc['customer_id']}", "name": acc["customer"]["full_name"], "company_id": acc["company_id"]}, "service.customer_reply", "service_request", sr_id, after={"ticket_number": sr["ticket_number"], "assigned_to": sr.get("assigned_to"), "customer_name": acc["customer"]["full_name"], "reopened": True, "actor_type": "customer"}, ip=None)
    return _sr_public(await db.service_requests.find_one({"id": sr_id}, {"_id": 0}))


# ---------------- ERP-side portal account management (/api/customers/{id}/portal) ----------------
mgmt = APIRouter(prefix="/customers", tags=["portal-admin"])


def _temp_password() -> str:
    import string
    alphabet = string.ascii_letters + string.digits
    return "Kp" + "".join(secrets.choice(alphabet) for _ in range(8)) + "@" + str(secrets.randbelow(90) + 10)


@mgmt.get("/{customer_id}/portal")
async def portal_status(customer_id: str, user: dict = Depends(require("customer.portal_manage"))):
    acc = await db.portal_accounts.find_one({"customer_id": customer_id, "company_id": user["company_id"]}, {"_id": 0, "password_hash": 0, "read_notice_ids": 0})
    if not acc:
        return {"enabled": False}
    acc["sessions"] = await db.portal_refresh_tokens.count_documents({"account_id": acc["id"], "revoked": False, "expires_at": {"$gte": now_iso()}})
    return {"enabled": True, **acc}


@mgmt.post("/{customer_id}/portal/enable", status_code=201)
async def portal_enable(customer_id: str, request: Request, user: dict = Depends(require("customer.portal_manage"))):
    c = await db.customers.find_one({"id": customer_id, "company_id": user["company_id"]}, {"_id": 0})
    if not c:
        raise ApiError(404, "Customer not found", "NOT_FOUND")
    phone = (c.get("phone") or "")[-10:]
    if len(phone) != 10:
        raise ApiError(422, "Customer needs a valid 10-digit phone", "VALIDATION_ERROR")
    temp = _temp_password()
    existing = await db.portal_accounts.find_one({"customer_id": customer_id}, {"_id": 0, "id": 1})
    if existing:
        await db.portal_accounts.update_one({"id": existing["id"]}, {"$set": {"password_hash": hash_password(temp), "must_change_password": True, "is_active": True, "failed_attempts": 0, "locked_until": None, "updated_at": now_iso()}})
        await db.portal_refresh_tokens.update_many({"account_id": existing["id"]}, {"$set": {"revoked": True}})
        action = "portal.reset_password"
    else:
        if await db.portal_accounts.find_one({"login_phone": phone}):
            raise ApiError(409, "Phone already used by another portal account", "DUPLICATE")
        await db.portal_accounts.insert_one({**base_doc(user, user["company_id"]), "customer_id": customer_id, "login_phone": phone, "password_hash": hash_password(temp), "must_change_password": True, "failed_attempts": 0, "locked_until": None, "last_login_at": None, "read_notice_ids": []})
        action = "portal.enable"
    await write_audit(user, action, "customer", customer_id, after={"login_phone": phone}, ip=client_ip(request))
    return {"login_phone": phone, "temporary_password": temp, "must_change_password": True}


class ToggleIn(StrictModel):
    is_active: bool


@mgmt.post("/{customer_id}/portal/toggle")
async def portal_toggle(customer_id: str, body: ToggleIn, request: Request, user: dict = Depends(require("customer.portal_manage"))):
    r = await db.portal_accounts.update_one({"customer_id": customer_id, "company_id": user["company_id"]}, {"$set": {"is_active": body.is_active, "updated_at": now_iso()}})
    if not r.matched_count:
        raise ApiError(404, "No portal account", "NOT_FOUND")
    if not body.is_active:
        acc = await db.portal_accounts.find_one({"customer_id": customer_id}, {"_id": 0, "id": 1})
        await db.portal_refresh_tokens.update_many({"account_id": acc["id"]}, {"$set": {"revoked": True}})
    await write_audit(user, "portal.disable" if not body.is_active else "portal.reactivate", "customer", customer_id, after={"is_active": body.is_active}, ip=client_ip(request))
    return {"ok": True, "is_active": body.is_active}


@mgmt.post("/{customer_id}/portal/revoke-sessions")
async def portal_revoke(customer_id: str, request: Request, user: dict = Depends(require("customer.portal_manage"))):
    acc = await db.portal_accounts.find_one({"customer_id": customer_id, "company_id": user["company_id"]}, {"_id": 0, "id": 1})
    if not acc:
        raise ApiError(404, "No portal account", "NOT_FOUND")
    r = await db.portal_refresh_tokens.update_many({"account_id": acc["id"], "revoked": False}, {"$set": {"revoked": True}})
    await write_audit(user, "portal.revoke_sessions", "customer", customer_id, after={"revoked": r.modified_count}, ip=client_ip(request))
    return {"ok": True, "revoked": r.modified_count}


@mgmt.post("/portal/bulk-enable")
async def portal_bulk_enable(request: Request, user: dict = Depends(require("customer.portal_manage"))):
    """Enable portal for all customers with Active bookings that have no account yet. Temp passwords are returned ONCE."""
    ids = await db.bookings.distinct("customer_id", {"company_id": user["company_id"], "status": "Active"})
    have = set(await db.portal_accounts.distinct("customer_id", {"customer_id": {"$in": ids}}))
    out = []
    for c in await db.customers.find({"id": {"$in": [i for i in ids if i not in have]}}, {"_id": 0, "id": 1, "full_name": 1, "phone": 1}).to_list(None):
        phone = (c.get("phone") or "")[-10:]
        if len(phone) != 10 or await db.portal_accounts.find_one({"login_phone": phone}):
            continue
        temp = _temp_password()
        await db.portal_accounts.insert_one({**base_doc(user, user["company_id"]), "customer_id": c["id"], "login_phone": phone, "password_hash": hash_password(temp), "must_change_password": True, "failed_attempts": 0, "locked_until": None, "last_login_at": None, "read_notice_ids": []})
        out.append({"customer_id": c["id"], "full_name": c["full_name"], "login_phone": phone, "temporary_password": temp})
    await write_audit(user, "portal.bulk_enable", "customer", "bulk", after={"count": len(out)}, ip=client_ip(request))
    return {"enabled": out, "count": len(out)}
