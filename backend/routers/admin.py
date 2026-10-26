from fastapi import APIRouter, Depends, Request

from db import db
from deps import require
from services.counters import recompute_all
from services.ledger import rebuild
from utils import ApiError, StrictModel, client_ip, now_iso, write_audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/recompute-counters")
async def recompute_counters(user: dict = Depends(require("admin.data.recompute"))):
    return await recompute_all()


@router.post("/reconcile-ledgers")
async def reconcile(user: dict = Depends(require("admin.data.recompute"))):
    return await reconcile_all()


class ReseedIn(StrictModel):
    confirm: str
    story: bool = False
    as_of: str | None = None


class MarkerIn(StrictModel):
    as_of: str
    bookings: int = 0


RESEED_JOB: dict = {"status": "idle"}


BUSINESS_COLLECTIONS = ["construction_stages", "payment_plans", "payment_plan_assignments", "portal_accounts", "portal_refresh_tokens", "service_requests", "service_categories", "notices", "construction_photos", "notifications", "projects", "blocks", "flats", "rate_cards", "parking_slots", "customers", "leads", "bookings", "payments", "demands", "ledger_entries", "contra_entries", "documents",
                        "cms_banners", "cms_testimonials", "cms_gallery", "cms_posts", "cms_pages", "cms_people", "cms_faqs", "cms_media", "site_settings", "counters", "idempotency_keys", "import_batches",
                        "catalogue_items", "communications", "project_summaries", "block_summaries", "customer_summaries", "dashboard_snapshots", "cache", "report_cache"]


@router.post("/reseed")
async def reseed(body: ReseedIn, request: Request, user: dict = Depends(require("admin.data.reseed"))):
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
    await db.settings.update_one({"key": "story"}, {"$set": {"value": None}}, upsert=True)
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
    await db.settings.delete_many({"key": {"$in": ["migration_phase7_done", "seed_phase7_done", "read_models_v1", "customers_profile_v1"]}})
    from migrate_phase7 import migrate_phase7, seed_phase7
    await migrate_phase7()
    await seed_phase7()
    from routers.catalogues import seed_catalogues
    await seed_catalogues()
    await db.settings.delete_many({"key": {"$in": ["customers_profile_v1"]}})
    from startup_phase11 import startup_phase11
    await startup_phase11()
    await db.settings.delete_many({"key": {"$in": ["seed_phase9_done"]}})
    from routers.visits import seed_phase9
    await seed_phase9()
    from services.validators import backfill_price_paise
    await backfill_price_paise()
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    await recompute_all()
    if body.story:  # story mode: keep the base setup (company, users, roles, masters, projects/towers/flats, plans, stages); every business record is then driven through the API by tools/story_seed.py
        await _wipe_business_records()
        from services.owner_bootstrap import ensure_owner
        await ensure_owner()
        await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
        await recompute_all()
        await write_audit(user, "admin.reseed", "system", "seed", after={"mode": "story", "as_of": body.as_of}, ip=client_ip(request))
        import asyncio
        asyncio.get_event_loop().create_task(_run_story(body.as_of))
        return {"ok": True, "reseeded": BUSINESS_COLLECTIONS, "story": True, "status": "running"}
    await write_audit(user, "admin.reseed", "system", "seed", after={"collections": BUSINESS_COLLECTIONS}, ip=client_ip(request))
    return {"ok": True, "reseeded": BUSINESS_COLLECTIONS}


STORY_WIPE = ["customers", "leads", "site_visits", "bookings", "payments", "demands", "ledger_entries", "contra_entries", "documents", "communications", "service_requests", "portal_accounts", "portal_refresh_tokens",
              "notifications", "refunds", "cash_openings", "idempotency_keys", "cms_testimonials", "project_summaries", "block_summaries", "customer_summaries", "dashboard_snapshots", "cache", "report_cache", "notices"]


async def _wipe_business_records():
    for c in STORY_WIPE:
        await db[c].delete_many({})
    await db.counters.delete_many({"scope": {"$nin": ["project_code"]}})
    await db.flats.update_many({}, {"$set": {"status": "Available", "booking_id": None}})
    await db.parking_slots.update_many({}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None}})
    await db.blocks.update_many({}, {"$set": {"construction_percent": 0}, "$unset": {"construction_stages": "", "milestones": ""}})  # stages rebuilt lazily from the sequence by ensure_block_stages


async def _run_story(as_of: str | None):
    import asyncio
    import os
    import subprocess
    import sys
    RESEED_JOB.update({"status": "running", "as_of": as_of, "log": "/tmp/story_reseed.log"})
    env = {**os.environ, "STORY_BASE_URL": "http://127.0.0.1:8001"}
    proc = await asyncio.create_subprocess_exec(sys.executable, "tools/story_seed.py", *(["--as-of", as_of] if as_of else []), cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), env=env, stdout=open("/tmp/story_reseed.log", "w"), stderr=subprocess.STDOUT)
    rc = await proc.wait()
    RESEED_JOB.update({"status": "done" if rc == 0 else "failed", "rc": rc})


@router.get("/reseed/status")
async def reseed_status(user: dict = Depends(require("admin.data.reseed"))):
    return RESEED_JOB


@router.get("/story-marker")
async def story_marker(user: dict = Depends(require("admin.data.reseed"))):
    doc = await db.settings.find_one({"key": "story"}, {"_id": 0})
    return (doc or {}).get("value") or {}


@router.post("/story-marker")
async def set_story_marker(body: MarkerIn, user: dict = Depends(require("admin.data.reseed"))):
    from services.owner_bootstrap import ensure_owner
    val = {"as_of": body.as_of, "bookings": body.bookings, "at": now_iso()}
    await db.settings.update_one({"key": "story"}, {"$set": {"value": val}}, upsert=True)
    await ensure_owner()
    await recompute_all()
    return val


# ---------- Backup & export ----------
SENSITIVE_FIELDS = {"customers": ["pan_enc", "aadhaar_enc", "bank_account_enc", "bank_account", "pan_hash"], "users": ["password_hash", "mfa_secret_enc", "mfa_secret"], "companies": ["bank_account"], "bank_accounts": ["account_number_enc"]}
EXCLUDE = {"refresh_tokens", "idempotency_keys", "backups", "login_events"}


@router.post("/backup", status_code=201)
async def create_backup(request: Request, include_sensitive: bool = False, user: dict = Depends(require("admin.data.backup"))):
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
async def list_backups(user: dict = Depends(require("admin.data.backup"))):
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
async def erase_customer(customer_id: str, body: EraseIn, request: Request, user: dict = Depends(require("admin.data.erase"))):
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
    await db.portal_accounts.update_many({"customer_id": customer_id}, {"$set": {"is_active": False, "login_phone": f"erased-{c['customer_code']}", "password_hash": None, "erased_at": now_iso()}})
    await db.portal_refresh_tokens.delete_many({"customer_id": customer_id})
    await db.service_requests.update_many({"customer_id": customer_id}, {"$set": {"customer_name": anon, "customer_phone": pii["phone"], "thread.$[m].author_name": anon, "thread.$[m].message": "[erased]"}},
                                          array_filters=[{"m.by": "customer"}])
    await db.communications.update_many({"customer_id": customer_id}, {"$set": {"notes": "[erased]"}})
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


DOCS_DIR = "/app/docs"


def _super_admin(user: dict):
    if user.get("role_name") not in ("Super Admin",) and "settings.manage" not in (user.get("permissions") or []):
        raise ApiError(403, "Super Admin only", "FORBIDDEN")


@router.get("/docs/technical.pdf")
async def docs_pdf(user: dict = Depends(require("admin.documentation.view"))):
    from fastapi.responses import FileResponse
    import os
    path = f"{DOCS_DIR}/KKT_Technical_Documentation.pdf"
    if not os.path.exists(path):
        raise ApiError(404, "Documentation not generated yet", "NOT_FOUND")
    return FileResponse(path, media_type="application/pdf", filename="KKT_Technical_Documentation.pdf")


@router.get("/docs/technical.md")
async def docs_md(user: dict = Depends(require("admin.documentation.view"))):
    from fastapi.responses import FileResponse
    return FileResponse(f"{DOCS_DIR}/KKT_Technical_Documentation.md", media_type="text/markdown", filename="KKT_Technical_Documentation.md")


@router.post("/docs/regenerate")
async def docs_regenerate(request: Request, user: dict = Depends(require("admin.documentation.view"))):
    import asyncio, os, sys
    proc = await asyncio.create_subprocess_exec(sys.executable, "/app/backend/docs/build_docs_pdf.py", "--regen", cwd="/app/backend", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await asyncio.wait_for(proc.communicate(), timeout=240)
    if proc.returncode:
        raise ApiError(500, f"Docs build failed: {out.decode()[-400:]}", "DOCS_BUILD_FAILED")
    pages = int((out.decode().strip().split("\n")[-1].split()[1]))
    await write_audit(user, "docs.regenerate", "settings", "docs", None, {"pages": pages}, client_ip(request))
    return {"ok": True, "pages": pages, "size_bytes": os.path.getsize(f"{DOCS_DIR}/KKT_Technical_Documentation.pdf")}
