"""Phase 11A startup: settings defaults for populated (pre-Phase-7) databases, catalogue seed, customer profile migration.
Everything idempotent; runs on every boot."""
import logging
import os

from db import db
from utils import now_iso

log = logging.getLogger("kkt.p11")


async def ensure_settings_defaults():
    """Keys that production DBs seeded before these phases may lack. Only sets when missing."""
    for key, value in (("sla_hours", {"High": 24, "Medium": 72, "Low": 168}), ("roles_version", 1), ("catalogues_version", 0)):
        await db.settings.update_one({"key": key}, {"$setOnInsert": {"key": key, "value": value}}, upsert=True)
    await db.companies.update_many({"demand_due_days": {"$exists": False}}, {"$set": {"demand_due_days": 15}})
    env_portal = os.environ.get("PORTAL_PUBLIC_URL") or None
    async for s in db.site_settings.find({}, {"_id": 0, "id": 1, "portal_url": 1, "company_id": 1}):
        cur = s.get("portal_url")
        if env_portal and (not cur or "expo.preview" in cur) and cur != env_portal:
            await db.site_settings.update_one({"id": s["id"]}, {"$set": {"portal_url": env_portal}})
        elif not env_portal and cur and "expo.preview" in cur:
            await db.site_settings.update_one({"id": s["id"]}, {"$set": {"portal_url": None}})  # same-origin /portal
    await db.projects.update_many({"website": {"$exists": False}}, {"$set": {"website": {}}})
    await db.projects.update_many({"website.site_visits": {"$exists": False}}, {"$set": {"website.site_visits": {}, "website.brochure_gate_enabled": False, "website.brochure_download_count": 0}})
    await db.customers.update_many({"lifecycle_stage": {"$exists": False}}, {"$set": {"lifecycle_stage": "Customer", "engagement_score": 0, "consent": {"marketing": False, "whatsapp": False}, "segment_ids": [], "preferences": {"bhk_ids": [], "facing_ids": [], "floor_preference_id": None, "budget_band_id": None, "project_ids": []}}})


async def migrate_customer_profiles():
    """Map legacy free-text fields to catalogue ids where the label matches; keep text in legacy_*."""
    if await db.settings.find_one({"key": "customers_profile_v1"}):
        return 0
    items = await db.catalogue_items.find({"type": {"$in": ["salutation", "gender", "occupation", "income_band", "lead_source"]}}, {"_id": 0, "id": 1, "type": 1, "label": 1, "code": 1}).to_list(None)
    by = {(i["type"], i["label"].lower()): i["id"] for i in items}
    by.update({(i["type"], i["code"].lower()): i["id"] for i in items})
    income = {"<5L": "Below ₹5 L", "5-10L": "₹5–10 L", "10-25L": "₹10–25 L", "25-50L": "₹25–50 L", "50L-1Cr": "₹50 L–1 Cr", ">1Cr": "Above ₹1 Cr"}
    n = 0
    async for c in db.customers.find({"profile_migrated": {"$ne": True}}, {"_id": 0, "id": 1, "salutation": 1, "gender": 1, "occupation": 1, "annual_income_band": 1, "source": 1, "assigned_sales_user_id": 1}):
        upd = {"profile_migrated": True, "legacy_occupation": c.get("occupation"), "legacy_source": c.get("source"), "legacy_income_band": c.get("annual_income_band")}
        for field, typ, raw in (("salutation_id", "salutation", c.get("salutation")), ("gender_id", "gender", c.get("gender")), ("occupation_id", "occupation", c.get("occupation")),
                                ("income_band_id", "income_band", income.get(c.get("annual_income_band") or "")), ("source_id", "lead_source", c.get("source"))):
            if raw and by.get((typ, str(raw).lower())):
                upd[field] = by[(typ, str(raw).lower())]
        if c.get("assigned_sales_user_id"):
            upd["rm_user_id"] = c["assigned_sales_user_id"]
        await db.customers.update_one({"id": c["id"]}, {"$set": upd})
        n += 1
    await db.settings.update_one({"key": "customers_profile_v1"}, {"$set": {"value": now_iso()}}, upsert=True)
    log.info("[phase11] customer profiles migrated: %s", n)
    return n


async def startup_phase11():
    from routers.catalogues import seed_catalogues
    from services.read_models import recompute_all
    await ensure_settings_defaults()
    added = await seed_catalogues()
    await migrate_customer_profiles()
    if not await db.settings.find_one({"key": "read_models_v1"}):
        log.info("[phase11] read models: %s", await recompute_all())
    if added:
        log.info("[phase11] catalogue items seeded: %s", added)
