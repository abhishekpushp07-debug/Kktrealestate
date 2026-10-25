"""Phase 11A §4: startup migrations/backfills are idempotent against a populated pre-Phase-7 database.
Copies the seed DB into `<DB_NAME>_migtest`, strips Phase 7+ fields/settings, runs the startup path in a subprocess with
DB_NAME pointed at the copy and asserts the defaults/backfills exist. Drops the copy afterwards."""
import asyncio
import os
import subprocess
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

SRC = os.environ["DB_NAME"]
DST = f"{SRC}_migtest"
STRIP = {"bookings": ["payment_plan_snapshot", "payment_plan_id", "plan_acceptance", "raised_percent"], "demands": ["installment_seq", "installment_name", "trigger_type", "trigger_stage_id", "percent"],
         "blocks": ["construction_stages", "construction_stage_sequence", "default_cash_percent"], "projects": ["website.site_visits", "website.brochure_gate_enabled", "construction_stage_sequence", "default_cash_percent"],
         "customers": ["lifecycle_stage", "engagement_score", "segment_ids", "preferences", "consent", "profile_migrated", "occupation_id", "salutation_id"], "companies": ["demand_due_days"],
         "notifications": ["withdrawn"]}
DROP = ["payment_plans", "payment_plan_assignments", "construction_stages", "catalogue_items", "project_summaries", "block_summaries", "customer_summaries", "dashboard_snapshots", "communications", "site_visits", "brochure_downloads", "locks", "cache"]
SETTINGS_DROP = ["sla_hours", "catalogues_version", "read_models_v1", "customers_profile_v1", "seed_phase7_done", "migration_phase7_done", "seed_phase9_done", "counters_v1", "roles_version"]


async def _prepare():
    cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
    await cl.drop_database(DST)
    src, dst = cl[SRC], cl[DST]
    for name in await src.list_collection_names():
        if name in DROP:
            continue
        docs = await src[name].find({}, {"_id": 0}).to_list(None)
        if docs:
            await dst[name].insert_many(docs)
    for coll, fields in STRIP.items():
        await dst[coll].update_many({}, {"$unset": {f: "" for f in fields}})
    await dst.settings.delete_many({"key": {"$in": SETTINGS_DROP}})
    await dst.site_settings.update_many({}, {"$unset": {"portal_url": ""}})
    return cl


async def _check(cl):
    d = cl[DST]
    keys = {s["key"]: s["value"] for s in await d.settings.find({}, {"_id": 0}).to_list(None)}
    for k in ("sla_hours", "catalogues_version", "roles_version", "read_models_v1", "customers_profile_v1", "counters_v1"):
        assert k in keys, f"settings key {k} missing after startup"
    assert (await d.companies.find_one({}))["demand_due_days"] == 15
    assert await d.catalogue_items.count_documents({}) > 300
    assert await d.construction_stages.count_documents({}) > 0 and await d.payment_plans.count_documents({}) > 0
    assert await d.blocks.count_documents({"construction_stages.0": {"$exists": True}}) == await d.blocks.count_documents({})
    assert await d.projects.count_documents({"website.site_visits": {"$exists": False}}) == 0
    assert await d.customers.count_documents({"lifecycle_stage": {"$exists": False}}) == 0
    assert await d.bookings.count_documents({"status": "Active", "payment_plan_snapshot": {"$exists": False}}) == 0, "active bookings must get a plan snapshot"
    assert await d.demands.count_documents({"voided": {"$ne": True}, "installment_seq": {"$exists": False}}) == 0, "legacy demands must be mapped to installments"
    assert await d.project_summaries.count_documents({}) == await d.projects.count_documents({})
    assert await d.customer_summaries.count_documents({}) == await d.customers.count_documents({})
    ss = await d.site_settings.find_one({})
    assert "portal_url" in ss  # created (env value or None → same-origin /portal)
    assert await d.projects.count_documents({"default_cash_percent": {"$exists": False}}) == 0
    assert await d.blocks.count_documents({"default_cash_percent": {"$exists": False}}) == 0
    assert "visit_settings" in keys and keys["visit_settings"]["slot_minutes"] == 60
    assert await d.catalogue_items.count_documents({"type": "lead_source"}) > 0 and await d.catalogue_items.count_documents({"type": "locality"}) > 0


RUN = """
import asyncio, os, sys
sys.path.insert(0, %r)
from server import lifespan, app
async def main():
    async with lifespan(app):
        pass
asyncio.run(main())
"""


def _run_startup():
    env = {**os.environ, "DB_NAME": DST}
    r = subprocess.run([sys.executable, "-c", RUN % os.path.join(os.path.dirname(__file__), "..")], env=env, cwd=os.path.join(os.path.dirname(__file__), ".."), capture_output=True, text=True, timeout=240)
    assert r.returncode == 0, r.stderr[-3000:]
    return r.stderr


def test_startup_idempotent_on_pre_phase7_db():
    loop = asyncio.new_event_loop()
    cl = loop.run_until_complete(_prepare())
    try:
        log1 = _run_startup()
        assert "integrity: ok=True" in log1, log1[-2000:]
        loop.run_until_complete(_check(cl))
        before = {n: loop.run_until_complete(cl[DST][n].count_documents({})) for n in ("catalogue_items", "demands", "payment_plans", "construction_stages", "project_summaries")}
        _run_startup()  # second boot: no duplicates, no re-seeding
        after = {n: loop.run_until_complete(cl[DST][n].count_documents({})) for n in before}
        assert before == after, (before, after)
    finally:
        loop.run_until_complete(cl.drop_database(DST))
