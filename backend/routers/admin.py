import asyncio
import re

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import require
from services import clock
from services.counters import recompute_all
from services.immutable import GuardedCollection
from services.ledger import rebuild
from services.stage_plan_migration import main as migrate_stage_plans
from utils import ApiError, StrictModel, client_ip, now_iso, write_audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/recompute-counters")
async def recompute_counters(user: dict = Depends(require("admin.data.recompute"))):
    return await recompute_all()


@router.post("/reconcile-ledgers")
async def reconcile(user: dict = Depends(require("admin.data.recompute"))):
    return await reconcile_all()


class HardPurgeIn(StrictModel):
    dry_run: bool = True
    confirm: str | None = None
    project_ids: list[str] = []
    block_ids: list[str] = []
    booking_ids: list[str] = []


@router.post("/hard-purge")
async def hard_purge_route(body: HardPurgeIn, request: Request, user: dict = Depends(require("admin.data.purge"))):
    """Phase 1 F-5: permanently delete test lineage (dry run first; confirm "HARD-PURGE"). Refuses real data with 409."""
    from services.hard_purge import hard_purge

    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if not body.dry_run and body.confirm != "HARD-PURGE":
        raise ApiError(400, 'Body must include {"confirm": "HARD-PURGE"} to delete', "CONFIRM_REQUIRED")
    extra = {"project_ids": body.project_ids, "block_ids": body.block_ids, "booking_ids": body.booking_ids}
    out = await hard_purge(body.dry_run, extra)
    if not body.dry_run:
        await write_audit(
            user,
            "admin.test_data_purged",
            "system",
            "test_data",
            after={"summary": "Test data purged", "counts": out["counts"], "numbers": out["numbers"]},
            ip=client_ip(request),
        )
    return out


@router.post("/backfill-paid-parts")
async def backfill_paid_parts_route(request: Request, user: dict = Depends(require("admin.data.backfill"))):
    """Phase 1 F-4: rebuild every booking so every demand carries its part-paid detail; second run reports 0 changed."""
    from services.backfill import backfill_paid_parts

    out = await backfill_paid_parts()
    await write_audit(
        user,
        "admin.backfill_paid_parts",
        "system",
        "paid_parts",
        after={k: v for k, v in out.items() if k != "skipped"} | {"skipped": len(out["skipped"])},
        ip=client_ip(request),
    )
    return out


class ReseedIn(StrictModel):
    confirm: str
    story: bool = False
    as_of: str | None = Field(
        default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"
    )  # strict ISO date: the only user value that reaches the seeder argv


class MarkerIn(StrictModel):
    as_of: str
    bookings: int = 0


RESEED_JOB: dict = {"status": "idle"}


BUSINESS_COLLECTIONS = [
    "construction_stages",
    "payment_plans",
    "payment_plan_assignments",
    "portal_accounts",
    "portal_refresh_tokens",
    "service_requests",
    "service_categories",
    "notices",
    "construction_photos",
    "notifications",
    "projects",
    "blocks",
    "flats",
    "rate_cards",
    "parking_slots",
    "customers",
    "leads",
    "bookings",
    "payments",
    "demands",
    "ledger_entries",
    "contra_entries",
    "documents",
    "cms_banners",
    "cms_testimonials",
    "cms_gallery",
    "cms_posts",
    "cms_pages",
    "cms_people",
    "cms_faqs",
    "cms_media",
    "site_settings",
    "counters",
    "idempotency_keys",
    "import_batches",
    "catalogue_items",
    "communications",
    "project_summaries",
    "block_summaries",
    "customer_summaries",
    "dashboard_snapshots",
    "cache",
    "report_cache",
]


@router.post("/reseed")
async def reseed(body: ReseedIn, request: Request, user: dict = Depends(require("admin.data.reseed"))):
    """Wipe everything except audit logs and re-run all seeds (Super Admin only). Seeded logins are recreated; existing sessions are invalidated."""
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if body.confirm != "RESEED":
        raise ApiError(400, 'Body must be {"confirm":"RESEED"}', "CONFIRM_REQUIRED")
    _reseed_lock_acquire()
    try:
        return await _reseed(body, request, user)
    except BaseException:
        _reseed_lock_release()
        raise


_RESEED_LOCK: list = []


def _reseed_lock_acquire():
    """Cross-worker guard: two reseeds must never interleave (each worker has its own RESEED_JOB)."""
    import fcntl

    fh = open("/tmp/kkt_reseed.lock", "w")  # noqa: SIM115 — held open until the story finishes
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fh.close()
        raise ApiError(409, "A reseed is already running — wait for it to finish", "RESEED_RUNNING") from None
    _RESEED_LOCK.append(fh)


def reseed_running() -> bool:
    """True while any worker holds the reseed lock (background jobs stand aside so the story owns the clock)."""
    import fcntl

    with open("/tmp/kkt_reseed.lock", "a") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fh, fcntl.LOCK_UN)
    return bool(_RESEED_LOCK)


def _reseed_lock_release():
    while _RESEED_LOCK:
        _RESEED_LOCK.pop().close()


async def _reseed(body: ReseedIn, request: Request, user: dict):
    if body.story and await db.companies.find_one({}) and await db.projects.find_one({}):
        return await _story_refresh_keep_setup(body, request, user)
    from seed import seed, seed_phase15
    from seed_phase2 import seed_phase2
    from seed_phase3 import seed_phase3

    # numbers are never reused (REQ-28): counters survive every wipe; job history and the demo-refresh host guard too
    keep = {"audit_logs", "login_events", "counters", "served_hosts", "job_runs"}
    ops_keys = ["last_backup", "last_backup_skip", "last_restore_drill"]  # E10: System Health keeps the backup it saw
    ops = await db.settings.find({"key": {"$in": ops_keys}}, {"_id": 0}).to_list(None)
    for c in await db.list_collection_names():
        if c not in keep and not c.startswith("system."):
            coll = db[c]
            await (coll.raw("admin reseed wipe") if isinstance(coll, GuardedCollection) else coll).delete_many({})
    for s in ops:
        await db.settings.update_one({"key": s["key"]}, {"$set": s}, upsert=True)
    await db.settings.update_one({"key": "story"}, {"$set": {"value": None}}, upsert=True)
    await db.settings.update_one({"key": "story_mode"}, {"$set": {"value": True}}, upsert=True)
    await seed()
    await seed_phase15()
    await seed_phase2()
    await seed_phase3()
    from services.pricing import (
        dedupe_charge_heads,
        ensure_area_types,
        ensure_charge_heads,
        migrate_saleable,
    )

    await ensure_charge_heads()
    await dedupe_charge_heads()
    await ensure_area_types()
    await migrate_saleable()  # Phase PS masters on a fresh seed
    from permissions import SYSTEM_ROLES
    from seed_phase3 import seed_marketing_user
    from utils import base_doc

    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    for name, spec in SYSTEM_ROLES.items():
        if not await db.roles.find_one({"name": name}):
            await db.roles.insert_one(
                {
                    **base_doc(None, company["id"]),
                    "name": name,
                    "description": spec["description"],
                    "permissions": spec["permissions"],
                    "is_system": True,
                }
            )
    await seed_marketing_user()
    from seed_phase5 import seed_phase5

    await seed_phase5()
    await db.settings.delete_many(
        {"key": {"$in": ["migration_phase7_done", "seed_phase7_done", "read_models_v1", "customers_profile_v1"]}}
    )
    from migrate_phase7 import migrate_phase7, seed_phase7

    await migrate_phase7()
    await seed_phase7()
    from routers.catalogues import seed_catalogues

    await seed_catalogues()
    await db.settings.delete_many({"key": {"$in": ["customers_profile_v1"]}})
    from startup_phase11 import startup_phase11

    await startup_phase11()
    await db.settings.delete_many({"key": {"$in": ["seed_s1_templates_done", "migration_s1_templates"]}})
    from routers.templates import migrate_templates, seed_s1_templates

    await migrate_stage_plans()  # tower stage sequences → Stage Plans (templates need them)

    await seed_s1_templates()
    await migrate_templates()  # S1.3: seeded towers/plans carry template lineage
    await db.settings.delete_many({"key": {"$in": ["seed_phase9_done"]}})
    from routers.visits import seed_phase9

    await seed_phase9()
    from services.validators import backfill_price_paise

    await backfill_price_paise()
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    await recompute_all()
    # story mode: keep the base setup (company, users, roles, masters, projects/towers/flats, plans, stages); every
    # business record is then driven through the API by tools/story_seed.py
    if body.story:
        await _wipe_business_records()
        from services.owner_bootstrap import ensure_owner

        await ensure_owner()
        await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
        await recompute_all()
        await write_audit(
            user,
            "admin.reseed",
            "system",
            "seed",
            after={"mode": "story", "as_of": body.as_of},
            ip=client_ip(request) if request else None,
        )
        asyncio.get_event_loop().create_task(_run_story(body.as_of))
        return {"ok": True, "reseeded": BUSINESS_COLLECTIONS, "story": True, "status": "running"}
    await write_audit(
        user,
        "admin.reseed",
        "system",
        "seed",
        after={"collections": BUSINESS_COLLECTIONS},
        ip=client_ip(request) if request else None,
    )
    _reseed_lock_release()
    return {"ok": True, "reseeded": BUSINESS_COLLECTIONS}


async def _story_refresh_keep_setup(body: ReseedIn, request: Request, user: dict):
    """E3/E4: setup already exists → wipe transactional data only (no base re-seed, ids stay), then replay the story."""
    SETUP_SNAPSHOT.clear()
    SETUP_SNAPSHOT.update(await snapshot_setup(db))
    wiped = await wipe_transactional(db)
    # E2: a seeder-written audit row (as_of set) dated after the rebuild's day is an artifact of an earlier story run
    end = clock.day_end_utc(body.as_of or clock.today_iso())
    end = min(end, now_iso())  # E: a seeder row stamped after the real run time (pre-cap runs) is an artifact too
    al = db.audit_logs
    al = al.raw("story refresh: future seeder rows") if isinstance(al, GuardedCollection) else al
    future = await al.delete_many({"as_of": {"$nin": [None, ""]}, "created_at": {"$gt": end}})
    await db.settings.update_one({"key": "story"}, {"$set": {"value": None}}, upsert=True)
    await db.settings.update_one({"key": "story_mode"}, {"$set": {"value": True}}, upsert=True)
    from services.owner_bootstrap import ensure_owner

    await ensure_owner()
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    await recompute_all()
    await write_audit(
        user,
        "admin.reseed",
        "system",
        "seed",
        after={
            "mode": "story",
            "as_of": body.as_of,
            "setup_kept": True,
            "wiped": wiped,
            "future_seeder_audit_rows_removed": future.deleted_count,
        },
        ip=client_ip(request) if request else None,
    )
    asyncio.get_event_loop().create_task(_run_story(body.as_of))
    return {"ok": True, "reseeded": wiped, "story": True, "setup_kept": True, "status": "running"}


STORY_WIPE = [
    "customers",
    "leads",
    "site_visits",
    "bookings",
    "payments",
    "demands",
    "ledger_entries",
    "contra_entries",
    "documents",
    "communications",
    "service_requests",
    "portal_accounts",
    "portal_refresh_tokens",
    "notifications",
    "refunds",
    "cash_openings",
    "idempotency_keys",
    "cms_testimonials",
    "project_summaries",
    "block_summaries",
    "customer_summaries",
    "dashboard_snapshots",
    "cache",
    "report_cache",
    "notices",
]


async def _wipe_business_records():
    for c in STORY_WIPE:
        coll = db[c]
        await (coll.raw("story reseed wipe") if isinstance(coll, GuardedCollection) else coll).delete_many({})
    await _reset_setup_state(db)


# E3/E4 (REQ-57): a demo refresh never touches setup — every master, Admin → Advanced catalogue, project/tower/flat (ids
# stay stable, saved links keep working), plan, user, role and setting. Only transactional data is rebuilt.
SETUP_COLLECTIONS = frozenset(
    {
        "companies", "users", "roles", "permissions", "user_direct_permissions", "user_home_layouts", "refresh_tokens",
        "settings", "site_settings", "migrations", "locks",
        "projects", "blocks", "flats", "parking_slots", "rate_cards",
        "payment_plans", "payment_plan_assignments", "payment_plan_templates",
        "construction_stage_plans", "construction_stages", "stage_plan_templates", "tower_templates",
        "floor_plan_templates", "milestone_templates",
        "block_types", "flat_types", "room_types", "area_types", "plc_types", "amenities", "spec_categories",
        "spec_items", "parking_slot_types", "charge_types", "payment_modes", "bank_accounts", "hold_reasons",
        "allocation_categories", "document_types", "service_categories", "catalogue_items", "message_templates",
        "report_presets", "cms_banners", "cms_gallery", "cms_pages", "cms_people", "cms_posts", "cms_faqs", "cms_media",
        "construction_photos",
    }
)  # fmt: skip
STORY_OWNED = frozenset({"cms_testimonials"})  # website content the story itself writes → rebuilt each refresh
ALWAYS_KEPT = frozenset(
    {"audit_logs", "audit_logs_archive", "login_events", "counters", "served_hosts", "job_runs", "backups"}
    | {"backup_files.files", "backup_files.chunks"}
)


SETUP_META = ("version", "updated_at", "updated_by")
# links from a setup row to the transactional record it is sold/held to — those records get new ids on every rebuild
SETUP_LINKS = ("booking_id", "customer_id", "flat_id", "hold")
SETUP_SNAPSHOT: dict = {}


async def snapshot_setup(dbx) -> dict:
    """Every setup doc as it stood before the refresh (C: a refresh must leave setup byte-identical)."""
    return {c: await dbx[c].find({}).to_list(None) for c in sorted(SETUP_COLLECTIONS)}


async def restore_setup_meta(dbx, snap: dict) -> dict:
    """Setup docs the story re-walked back to the same content get their exact pre-refresh bytes back (version,
    updated_at incl.) — bookings moving a flat to Booked again must not read as a setup edit."""
    restored = differ = 0
    for c, docs in snap.items():
        coll = dbx[c]
        raw = coll.raw("story refresh: restore setup") if isinstance(coll, GuardedCollection) else coll
        for d in docs:
            cur = await raw.find_one({"_id": d["_id"]})
            if cur == d:
                continue
            strip = lambda x: {k: v for k, v in (x or {}).items() if k not in SETUP_META}  # noqa: E731
            if cur is not None and strip(cur) == strip(d):
                await raw.replace_one({"_id": d["_id"]}, d)
                restored += 1
            elif cur is not None and {k: v for k, v in strip(cur).items() if k not in SETUP_LINKS} == {
                k: v for k, v in strip(d).items() if k not in SETUP_LINKS
            }:  # same setup content, re-sold to this rebuild's booking: keep the new link, restore version/updated_at
                meta = {k: d[k] for k in SETUP_META if k in d}
                await raw.update_one({"_id": d["_id"]}, {"$set": meta})
                restored += 1
            else:
                differ += 1
    return {"restored": restored, "content_changed": differ}


async def _reset_setup_state(dbx):
    """Setup rows the story moved (flat/parking status, tower progress) go back to their unsold, not-started state."""
    await dbx.flats.update_many(
        {}, {"$set": {"status": "Available", "booking_id": None}, "$unset": {"hold": "", "status_reason": ""}}
    )
    await dbx.parking_slots.update_many(
        {}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None, "flat_id": None}}
    )
    await dbx.blocks.update_many(
        {}, {"$set": {"construction_percent": 0}, "$unset": {"construction_stages": "", "milestones": ""}}
    )  # stages rebuilt lazily from the sequence by ensure_block_stages


async def wipe_transactional(dbx) -> list[str]:
    """Delete every collection that is neither setup nor always-kept; returns the wiped names."""
    wiped = []
    for c in sorted(await dbx.list_collection_names()):
        if c in SETUP_COLLECTIONS or c in ALWAYS_KEPT or c.startswith("system."):
            continue
        coll = dbx[c]
        await (coll.raw("story refresh wipe") if isinstance(coll, GuardedCollection) else coll).delete_many({})
        wiped.append(c)
    await _reset_setup_state(dbx)
    return wiped


async def _run_story(as_of: str | None):
    try:
        await _run_story_locked(as_of)
    finally:
        _reseed_lock_release()


async def _run_story_locked(as_of: str | None):
    import asyncio
    import os
    import subprocess
    import sys

    RESEED_JOB.update({"status": "running", "as_of": as_of, "log": "/tmp/story_reseed.log"})
    env = {
        **os.environ,
        "STORY_BASE_URL": os.environ.get("KKT_SELF_BASE", "http://127.0.0.1:8001"),
    }  # private test backends set KKT_SELF_BASE so the seeder never targets the preview
    if as_of is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        raise ValueError("as_of must be an ISO date")
    # Fixed-script subprocess (python tools/story_seed.py), not code execution: argv is constant except the validated ISO date above.
    with open("/tmp/story_reseed.log", "w") as log:  # the child keeps its own dup of the fd
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "tools/story_seed.py",
            *(["--as-of", as_of] if as_of else []),
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    rc = await proc.wait()
    if rc != 0:
        RESEED_JOB.update({"status": "failed", "rc": rc, "reason": "story seeder exited non-zero"})
        return
    from services.read_models import recompute_all as rebuild_read_models

    await rebuild_read_models()  # derived summaries for every project, incl. ones the story never writes
    if SETUP_SNAPSHOT:
        RESEED_JOB["setup"] = await restore_setup_meta(db, SETUP_SNAPSHOT)
        SETUP_SNAPSHOT.clear()
    RESEED_JOB.update(await _verify_story(as_of))


async def _verify_story(as_of: str | None) -> dict:
    """REQ-37: a rebuild is only 'done' when chronology and integrity are both clean."""
    import os
    import subprocess
    import sys

    from services.integrity import integrity_report

    chk = await asyncio.create_subprocess_exec(
        sys.executable,
        "tools/story_logic_check.py",
        *(["--today", as_of] if as_of else []),
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    out, _ = await chk.communicate()
    if chk.returncode != 0:
        first = next((ln for ln in out.decode().splitlines() if ln.startswith("PROBLEM")), "chronology check failed")
        return {"status": "failed", "rc": 0, "reason": first}
    rep = await integrity_report()
    if rep.get("findings"):
        f = rep["findings"][0]
        return {"status": "failed", "rc": 0, "reason": f"integrity: {f.get('booking_number')} {f.get('kind')}"}
    tie = await asyncio.create_subprocess_exec(
        sys.executable,
        "tools/tieout.py",
        "--base",
        os.environ.get("KKT_SELF_BASE", "http://127.0.0.1:8001"),
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    out, _ = await tie.communicate()
    if tie.returncode != 0:
        first = next((ln for ln in out.decode().splitlines() if ln.startswith("FAIL")), "tie-outs failed")
        return {"status": "failed", "rc": 0, "reason": f"tieout: {first[:200]}"}
    return {"status": "done", "rc": 0, "reason": None}


@router.get("/reseed/status")
async def reseed_status(user: dict = Depends(require("admin.data.reseed"))):
    return RESEED_JOB


@router.post("/audit/archive")
async def run_audit_archive(request: Request, user: dict = Depends(require("admin.audit.archive"))):
    from services.audit_archive import archive_old_rows

    res = await archive_old_rows()
    await write_audit(user, "admin.audit_archive", "system", "audit", after=res, ip=client_ip(request))
    return res


@router.get("/audit/archive/status")
async def audit_archive_status(user: dict = Depends(require("admin.audit.view"))):
    from services.audit_archive import retention_months

    last = await db.settings.find_one({"key": "audit_archive_last_run"}, {"_id": 0, "value": 1})
    return {
        "retention_months": await retention_months(),
        "last_run": (last or {}).get("value"),
        "hot": await db.audit_logs.count_documents({}),
        "archived": await db.audit_logs_archive.count_documents({}),
    }


@router.get("/story-marker")
async def story_marker(user: dict = Depends(require("admin.data.reseed"))):
    doc = await db.settings.find_one({"key": "story"}, {"_id": 0})
    return (doc or {}).get("value") or {}


@router.post("/story-marker")
async def set_story_marker(body: MarkerIn, request: Request, user: dict = Depends(require("admin.data.reseed"))):
    from services.owner_bootstrap import ensure_owner

    val = {"as_of": body.as_of, "bookings": body.bookings, "at": now_iso()}
    await db.settings.update_one({"key": "story"}, {"$set": {"value": val}}, upsert=True)
    await write_audit(user, "admin.story_marker", "system", "story", after=val, ip=client_ip(request))
    await ensure_owner()
    await recompute_all()
    return val


# ---------- Backup & export ----------
SENSITIVE_FIELDS = {
    "customers": ["pan_enc", "aadhaar_enc", "bank_account_enc", "bank_account", "pan_hash"],
    "users": ["password_hash", "mfa_secret_enc", "mfa_secret"],
    "companies": ["bank_account"],
    "bank_accounts": ["account_number_enc"],
}
EXCLUDE = {"refresh_tokens", "idempotency_keys", "backups", "backup_files.files", "backup_files.chunks", "login_events"}


@router.post("/backup", status_code=201)
async def create_backup(
    request: Request, include_sensitive: bool = False, user: dict = Depends(require("admin.data.backup"))
):
    """Super Admin: zip of JSON per collection; encrypted KYC/password fields stripped unless include_sensitive."""
    import json
    import secrets
    import tempfile
    import zipfile
    from datetime import UTC, datetime, timedelta

    from utils import base_doc, now_iso

    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    counts = {}
    tmp = tempfile.TemporaryFile()  # D0: streamed to disk one batch at a time (was: whole DB in RAM, several copies)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for c in sorted(await db.list_collection_names()):
            if c in EXCLUDE or c.startswith("system."):
                continue
            drop = [] if include_sensitive else SENSITIVE_FIELDS.get(c, [])
            n = 0
            with z.open(f"{c}.json", "w", force_zip64=True) as fh:
                fh.write(b"[")
                async for d in db[c].find({}, {"_id": 0}).batch_size(500):
                    for f in drop:
                        d.pop(f, None)
                    fh.write((b", " if n else b"") + json.dumps(d, default=str, ensure_ascii=False).encode())
                    n += 1
                fh.write(b"]")
            counts[c] = n
        z.writestr(
            "manifest.json",
            json.dumps(
                {
                    "generated_at": now_iso(),
                    "by": user["email"],
                    "include_sensitive": include_sensitive,
                    "collections": counts,
                    "restore": (
                        "mongoimport --jsonArray --db $DB_NAME --collection <name> <name>.json (drop first); then POST /api/admin/recompute-counters and "
                        "/api/admin/reconcile-ledgers"
                    ),
                }
            ),
        )
    size = tmp.tell()
    tmp.seek(0)
    token = secrets.token_urlsafe(32)
    meta = {
        **base_doc(user, user["company_id"]),
        "size": size,
        "include_sensitive": include_sensitive,
        "collections": counts,
        "download_token": token,
        "expires_at": (datetime.now(UTC) + timedelta(minutes=15)).isoformat(),
        "by_name": user["name"],
    }
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket

    from db import _db_raw

    bucket = AsyncIOMotorGridFSBucket(_db_raw, bucket_name="backup_files")
    live = {
        b["gridfs_id"]
        for b in await db.backups.find({"gridfs_id": {"$exists": True}}, {"_id": 0, "gridfs_id": 1}).to_list(None)
    }
    async for f in bucket.find({}):  # the meta doc expires by TTL after a day; drop the orphaned file bodies here
        if f._id not in live:
            await bucket.delete(f._id)
    with tmp:  # GridFS: a backup is bigger than one 16 MB document once audit logs grow
        gid = await bucket.upload_from_stream(f"{meta['id']}.zip", tmp)
    await db.backups.insert_one({**meta, "gridfs_id": gid})
    meta.pop("_id", None)
    await write_audit(
        user,
        "admin.backup",
        "system",
        meta["id"],
        after={"size": size, "include_sensitive": include_sensitive},
        ip=client_ip(request),
    )
    return {**meta, "download_url": f"/api/admin/backups/{meta['id']}/download?token={token}"}


@router.get("/backups")
async def list_backups(user: dict = Depends(require("admin.data.backup"))):
    """Super Admin: in-app JSON exports (`items`) + Z.1 mongodump archives on disk, disk usage and the retention policy."""
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    from tools import backup as bk

    items, archives, lb, skip = await asyncio.gather(
        db.backups.find({"company_id": user["company_id"]}, {"_id": 0, "data": 0, "download_token": 0, "gridfs_id": 0})
        .sort("created_at", -1)
        .limit(20)
        .to_list(20),
        asyncio.to_thread(bk.list_archives),
        db.settings.find_one({"key": "last_backup"}, {"_id": 0, "value": 1}),
        db.settings.find_one({"key": "last_backup_skip"}, {"_id": 0, "value": 1}),
    )
    disk = bk.disk_usage()
    return {
        "items": items,
        "archives": list(reversed(archives)),
        "archives_total_bytes": sum(a["bytes"] for a in archives),
        "disk": disk,
        "policy": bk.policy(),
        "last_backup": (lb or {}).get("value"),
        "last_skip": (skip or {}).get("value"),
        "warning": disk["used_pct"] is not None and disk["used_pct"] >= 80,
    }


@router.post("/backups/prune")
async def prune_backups(request: Request, user: dict = Depends(require("admin.data.backup"))):
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    from tools import backup as bk

    res = await asyncio.to_thread(bk.prune)
    await write_audit(
        user,
        "backup.prune",
        "system",
        "backup",
        after={"removed": res["removed"], "remaining": res["remaining"], "total_bytes": res["total_bytes"]},
        ip=client_ip(request),
    )
    return {**res, "disk": bk.disk_usage()}


@router.get("/backups/{backup_id}/download")
async def download_backup(backup_id: str, token: str):
    """Short-lived (15 min) tokenised link — no bearer needed so the browser can download directly."""
    from datetime import UTC, datetime

    from fastapi import Response
    from fastapi.responses import StreamingResponse

    b = await db.backups.find_one({"id": backup_id, "download_token": token})
    if not b or datetime.fromisoformat(b["expires_at"]) < datetime.now(UTC):
        raise ApiError(404, "Backup link expired or invalid", "NOT_FOUND")
    headers = {"Content-Disposition": f'attachment; filename="kkt-backup-{clock.day_of(b["created_at"])}.zip"'}
    if b.get("gridfs_id") is not None:
        from motor.motor_asyncio import AsyncIOMotorGridFSBucket

        from db import _db_raw

        stream = await AsyncIOMotorGridFSBucket(_db_raw, bucket_name="backup_files").open_download_stream(
            b["gridfs_id"]
        )

        async def chunks():  # D0: one GridFS chunk at a time, never the whole archive in RAM
            while part := await stream.readchunk():
                yield part

        return StreamingResponse(chunks(), media_type="application/zip", headers=headers)
    return Response(content=bytes(b["data"]), media_type="application/zip", headers=headers)  # pre-GridFS backups


# ---------- Right to erasure ----------
class EraseIn(StrictModel):
    confirm: str
    reason: str


@router.post("/customers/{customer_id}/erase")
async def erase_customer(
    customer_id: str, body: EraseIn, request: Request, user: dict = Depends(require("admin.data.erase"))
):
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
    pii = {
        "full_name": anon,
        "salutation": None,
        "phone": f"+91000000{c['customer_code'][-4:]}",
        "alt_phone": None,
        "email": None,
        "address_current": None,
        "address_permanent": None,
        "pan_enc": None,
        "pan_hash": None,
        "aadhaar_enc": None,
        "bank_account": None,
        "date_of_birth": None,
        "father_name": None,
        "occupation": None,
        "notes": None,
        "kyc_status": "Erased",
        "erased_at": now_iso(),
        "erased_by": user["id"],
        "erase_reason": body.reason,
        "is_active": False,
    }
    await db.customers.update_one({"id": customer_id}, {"$set": pii, "$inc": {"version": 1}})
    await db.bookings.update_many(
        {"customer_id": customer_id}, {"$set": {"customer_name": anon, "customer_phone": pii["phone"]}}
    )
    await db.payments.update_many({"customer_id": customer_id}, {"$set": {"customer_name": anon}})
    await db.leads.update_many(
        {"converted_customer_id": customer_id}, {"$set": {"name": anon, "phone": pii["phone"], "email": None}}
    )
    await db.documents.update_many(
        {"entity_type": "customer", "entity_id": customer_id}, {"$set": {"is_active": False, "deleted_at": now_iso()}}
    )
    await db.portal_accounts.update_many(
        {"customer_id": customer_id},
        {
            "$set": {
                "is_active": False,
                "login_phone": f"erased-{c['customer_code']}",
                "password_hash": None,
                "erased_at": now_iso(),
            }
        },
    )
    await db.portal_refresh_tokens.delete_many({"customer_id": customer_id})
    await db.service_requests.update_many(
        {"customer_id": customer_id},
        {
            "$set": {
                "customer_name": anon,
                "customer_phone": pii["phone"],
                "thread.$[m].author_name": anon,
                "thread.$[m].message": "[erased]",
            }
        },
        array_filters=[{"m.by": "customer"}],
    )
    await db.communications.update_many({"customer_id": customer_id}, {"$set": {"notes": "[erased]"}})
    await write_audit(
        user,
        "customer.erase",
        "customer",
        customer_id,
        before={"customer_code": c["customer_code"]},
        after={"reason": body.reason, "anonymised": True},
        ip=client_ip(request),
    )
    return {"ok": True, "customer_code": c["customer_code"], "anonymised_name": anon}


async def reconcile_all() -> dict:
    """Rebuilds every booking summary from source docs and reports which ones differed."""
    mismatches = []
    ids = [b["id"] for b in await db.bookings.find({}, {"_id": 0, "id": 1, "summary": 1}).to_list(None)]
    for bid in ids:
        before = (await db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1}) or {}).get("summary") or {}
        await rebuild(bid)
        after = (await db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1}) or {}).get("summary") or {}
        diff = {
            k: (before.get(k), after.get(k)) for k in after if k != "last_payment_at" and before.get(k) != after.get(k)
        }
        if diff:
            mismatches.append({"booking_id": bid, "diff": diff})
    return {"bookings": len(ids), "mismatches": mismatches}


DOCS_DIR = "/app/docs"


def _super_admin(user: dict):
    if user.get("role_name") not in ("Super Admin",) and "admin.settings.edit" not in (user.get("permissions") or []):
        raise ApiError(403, "Super Admin only", "FORBIDDEN")


@router.get("/docs/technical.pdf")
async def docs_pdf(user: dict = Depends(require("admin.documentation.view"))):
    import os

    from fastapi.responses import FileResponse

    path = f"{DOCS_DIR}/KKT_Technical_Documentation.pdf"
    if not os.path.exists(path):
        raise ApiError(404, "Documentation not generated yet", "NOT_FOUND")
    return FileResponse(path, media_type="application/pdf", filename="KKT_Technical_Documentation.pdf")


@router.get("/docs/technical.md")
async def docs_md(user: dict = Depends(require("admin.documentation.view"))):
    from fastapi.responses import FileResponse

    return FileResponse(
        f"{DOCS_DIR}/KKT_Technical_Documentation.md",
        media_type="text/markdown",
        filename="KKT_Technical_Documentation.md",
    )


@router.post("/docs/regenerate")
async def docs_regenerate(request: Request, user: dict = Depends(require("admin.documentation.view"))):
    import asyncio
    import os
    import sys

    # Fixed-script subprocess (python docs/build_docs_pdf.py --regen) with constant argv — not code execution.
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "/app/backend/docs/build_docs_pdf.py",
        "--regen",
        cwd="/app/backend",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await asyncio.wait_for(proc.communicate(), timeout=240)
    if proc.returncode:
        raise ApiError(500, f"Docs build failed: {out.decode()[-400:]}", "DOCS_BUILD_FAILED")
    pages = int(out.decode().strip().split("\n")[-1].split()[1])
    await write_audit(user, "docs.regenerate", "settings", "docs", None, {"pages": pages}, client_ip(request))
    return {"ok": True, "pages": pages, "size_bytes": os.path.getsize(f"{DOCS_DIR}/KKT_Technical_Documentation.pdf")}
