from fastapi import APIRouter, Depends, Request

from db import db
from deps import require
from services.counters import recompute_all
from services.ledger import rebuild
from utils import ApiError, StrictModel, client_ip, write_audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/recompute-counters")
async def recompute_counters(user: dict = Depends(require("settings.manage"))):
    return await recompute_all()


@router.post("/reconcile-ledgers")
async def reconcile(user: dict = Depends(require("settings.manage"))):
    return await reconcile_all()


class ReseedIn(StrictModel):
    confirm: str


BUSINESS_COLLECTIONS = ["construction_stages", "payment_plans", "payment_plan_assignments", "portal_accounts", "portal_refresh_tokens", "service_requests", "service_categories", "notices", "construction_photos", "notifications", "projects", "blocks", "flats", "rate_cards", "parking_slots", "customers", "leads", "bookings", "payments", "demands", "ledger_entries", "contra_entries", "documents",
                        "cms_banners", "cms_testimonials", "cms_gallery", "cms_posts", "cms_pages", "cms_people", "cms_faqs", "cms_media", "site_settings", "counters", "idempotency_keys", "import_batches"]


@router.post("/reseed")
async def reseed(body: ReseedIn, request: Request, user: dict = Depends(require("settings.manage"))):
    """Wipe everything except audit logs and re-run all seeds (Super Admin only). Seeded logins are recreated; existing sessions are invalidated."""
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if body.confirm != "RESEED":
        raise ApiError(400, 'Body must be {"confirm":"RESEED"}', "CONFIRM_REQUIRED")
    from seed import seed, seed_phase15
    from seed_phase2 import seed_phase2
    from seed_phase3 import seed_phase3
    keep = {"audit_logs", "login_events"}
    for c in await db.list_collection_names():
        if c not in keep and not c.startswith("system."):
            await db[c].delete_many({})
    await seed()
    await seed_phase15()
    await seed_phase2()
    await seed_phase3()
    from permissions import SYSTEM_ROLES
    from seed_phase3 import seed_marketing_user
    from utils import base_doc
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    for name, spec in SYSTEM_ROLES.items():
        if not await db.roles.find_one({"name": name}):
            await db.roles.insert_one({**base_doc(None, company["id"]), "name": name, "description": spec["description"], "permissions": spec["permissions"], "is_system": True})
    await seed_marketing_user()
    from seed_phase5 import seed_phase5
    await seed_phase5()
    await db.settings.delete_many({"key": {"$in": ["migration_phase7_done", "seed_phase7_done"]}})
    from migrate_phase7 import migrate_phase7, seed_phase7
    await migrate_phase7()
    await seed_phase7()
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    await recompute_all()
    await write_audit(user, "admin.reseed", "system", "seed", after={"collections": BUSINESS_COLLECTIONS}, ip=client_ip(request))
    return {"ok": True, "reseeded": BUSINESS_COLLECTIONS}


# ---------- Backup & export ----------
SENSITIVE_FIELDS = {"customers": ["pan_enc", "aadhaar_enc", "bank_account_enc", "bank_account", "pan_hash"], "users": ["password_hash", "mfa_secret_enc", "mfa_secret"], "companies": ["bank_account"], "bank_accounts": ["account_number_enc"]}
EXCLUDE = {"refresh_tokens", "idempotency_keys", "backups", "login_events"}


@router.post("/backup", status_code=201)
async def create_backup(request: Request, include_sensitive: bool = False, user: dict = Depends(require("settings.manage"))):
    """Super Admin: zip of JSON per collection; encrypted KYC/password fields stripped unless include_sensitive."""
    import io
    import json
    import secrets
    import zipfile
    from datetime import UTC, datetime, timedelta

    from utils import base_doc, now_iso
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    buf = io.BytesIO()
    counts = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for c in sorted(await db.list_collection_names()):
            if c in EXCLUDE or c.startswith("system."):
                continue
            docs = await db[c].find({}, {"_id": 0}).to_list(None)
            if not include_sensitive:
                for f in SENSITIVE_FIELDS.get(c, []):
                    for d in docs:
                        d.pop(f, None)
            counts[c] = len(docs)
            z.writestr(f"{c}.json", json.dumps(docs, default=str, ensure_ascii=False))
        z.writestr("manifest.json", json.dumps({"generated_at": now_iso(), "by": user["email"], "include_sensitive": include_sensitive, "collections": counts, "restore": "mongoimport --jsonArray --db $DB_NAME --collection <name> <name>.json (drop first); then POST /api/admin/recompute-counters and /api/admin/reconcile-ledgers"}))
    data = buf.getvalue()
    token = secrets.token_urlsafe(32)
    meta = {**base_doc(user, user["company_id"]), "size": len(data), "include_sensitive": include_sensitive, "collections": counts, "download_token": token, "expires_at": (datetime.now(UTC) + timedelta(minutes=15)).isoformat(), "by_name": user["name"]}
    await db.backups.insert_one({**meta, "data": data})
    meta.pop("_id", None)
    await write_audit(user, "admin.backup", "system", meta["id"], after={"size": len(data), "include_sensitive": include_sensitive}, ip=client_ip(request))
    return {**meta, "download_url": f"/api/admin/backups/{meta['id']}/download?token={token}"}


@router.get("/backups")
async def list_backups(user: dict = Depends(require("settings.manage"))):
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    return {"items": await db.backups.find({"company_id": user["company_id"]}, {"_id": 0, "data": 0, "download_token": 0}).sort("created_at", -1).limit(20).to_list(20)}


@router.get("/backups/{backup_id}/download")
async def download_backup(backup_id: str, token: str):
    """Short-lived (15 min) tokenised link — no bearer needed so the browser can download directly."""
    from datetime import UTC, datetime

    from fastapi import Response
    b = await db.backups.find_one({"id": backup_id, "download_token": token})
    if not b or datetime.fromisoformat(b["expires_at"]) < datetime.now(UTC):
        raise ApiError(404, "Backup link expired or invalid", "NOT_FOUND")
    return Response(content=bytes(b["data"]), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="kkt-backup-{b["created_at"][:10]}.zip"'})


# ---------- Right to erasure ----------
class EraseIn(StrictModel):
    confirm: str
    reason: str


@router.post("/customers/{customer_id}/erase")
async def erase_customer(customer_id: str, body: EraseIn, request: Request, user: dict = Depends(require("settings.manage"))):
    """Anonymise PII on a customer with no Active booking; financial records (bookings/payments/ledger) are kept, keyed by customer_code."""
    from utils import get_or_404, now_iso
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if body.confirm != "ERASE":
        raise ApiError(400, 'Body must include {"confirm":"ERASE"}', "CONFIRM_REQUIRED")
    c = await get_or_404(db.customers, customer_id, "Customer", {"company_id": user["company_id"]})
    if await db.bookings.count_documents({"customer_id": customer_id, "status": {"$in": ["Active", "Completed"]}}):
        raise ApiError(409, "Customer has an active or completed booking; erasure not allowed", "ACTIVE_BOOKING")
    anon = f"Erased Customer {c['customer_code']}"
    pii = {"full_name": anon, "salutation": None, "phone": f"+91000000{c['customer_code'][-4:]}", "alt_phone": None, "email": None, "address_current": None, "address_permanent": None, "pan_enc": None, "pan_hash": None, "aadhaar_enc": None,
           "bank_account": None, "date_of_birth": None, "father_name": None, "occupation": None, "notes": None, "kyc_status": "Erased", "erased_at": now_iso(), "erased_by": user["id"], "erase_reason": body.reason, "is_active": False}
    await db.customers.update_one({"id": customer_id}, {"$set": pii, "$inc": {"version": 1}})
    await db.bookings.update_many({"customer_id": customer_id}, {"$set": {"customer_name": anon, "customer_phone": pii["phone"]}})
    await db.payments.update_many({"customer_id": customer_id}, {"$set": {"customer_name": anon}})
    await db.leads.update_many({"converted_customer_id": customer_id}, {"$set": {"name": anon, "phone": pii["phone"], "email": None}})
    await db.documents.update_many({"entity_type": "customer", "entity_id": customer_id}, {"$set": {"is_active": False, "deleted_at": now_iso()}})
    await write_audit(user, "customer.erase", "customer", customer_id, before={"customer_code": c["customer_code"]}, after={"reason": body.reason, "anonymised": True}, ip=client_ip(request))
    return {"ok": True, "customer_code": c["customer_code"], "anonymised_name": anon}


async def reconcile_all() -> dict:
    """Rebuilds every booking summary from source docs and reports which ones differed."""
    mismatches = []
    ids = [b["id"] for b in await db.bookings.find({}, {"_id": 0, "id": 1, "summary": 1}).to_list(None)]
    for bid in ids:
        before = (await db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1}) or {}).get("summary") or {}
        await rebuild(bid)
        after = (await db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1}) or {}).get("summary") or {}
        diff = {k: (before.get(k), after.get(k)) for k in after if k != "last_payment_at" and before.get(k) != after.get(k)}
        if diff:
            mismatches.append({"booking_id": bid, "diff": diff})
    return {"bookings": len(ids), "mismatches": mismatches}
