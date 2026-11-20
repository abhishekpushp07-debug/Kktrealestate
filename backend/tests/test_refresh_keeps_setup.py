"""E3/E4 (REQ-57, JRN-37): a demo refresh keeps EVERY setup collection (masters, Admin → Advanced catalogues, projects,
towers, flats with their ids) and only rebuilds transactional data. Runs the real wipe on a scratch database."""

import asyncio
import os
import re
import uuid

from motor.motor_asyncio import AsyncIOMotorClient

from routers.admin import ALWAYS_KEPT, SETUP_COLLECTIONS, STORY_OWNED, wipe_transactional

MASTERISH = re.compile(
    r"(types|reasons|modes|templates|categories|catalogue|plans|bank_accounts|amenities|^spec_|^cms_)"
)


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def test_every_master_and_catalogue_collection_is_setup():
    async def go():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        names = await cl[os.environ["DB_NAME"]].list_collection_names()
        cl.close()
        return names

    missing = [c for c in _run(go()) if MASTERISH.search(c) and c not in SETUP_COLLECTIONS | ALWAYS_KEPT | STORY_OWNED]
    assert missing == [], f"classify these as setup (or always-kept): {missing}"


def test_refresh_wipe_keeps_a_custom_entry_in_every_setup_collection():
    name = f"kkt_scratch_e3_{uuid.uuid4().hex[:8]}"

    async def go():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        dbx = cl[name]
        try:
            for c in SETUP_COLLECTIONS:
                await dbx[c].insert_one({"id": f"custom-{c}", "name": "Token received (custom)", "status": "Hold"})
            for c in ("bookings", "payments", "demands", "customers", "leads", "notifications"):
                await dbx[c].insert_one({"id": f"tx-{c}"})
            wiped = await wipe_transactional(dbx)
            kept = {c: await dbx[c].find_one({"id": f"custom-{c}"}) for c in SETUP_COLLECTIONS}
            left = {c: await dbx[c].count_documents({}) for c in ("bookings", "payments", "demands", "customers")}
            flat = await dbx.flats.find_one({"id": "custom-flats"})
            return wiped, kept, left, flat
        finally:
            await cl.drop_database(name)
            cl.close()

    wiped, kept, left, flat = _run(go())
    assert [c for c, d in kept.items() if not d] == []  # every setup entry survived, same id
    assert not set(wiped) & SETUP_COLLECTIONS
    assert left == {"bookings": 0, "payments": 0, "demands": 0, "customers": 0}
    assert flat["status"] == "Available"  # setup row survives; only its sold/held state is reset


def test_refresh_leaves_owner_setup_byte_identical():
    """REQ (root C): a refresh never writes owner-created setup — same doc incl. version / updated_at."""
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
    from story_seed import STORY_PROJECT_CODES

    from routers.admin import _reset_setup_state

    assert "YE" not in STORY_PROJECT_CODES and STORY_PROJECT_CODES == {"SGH", "GGV"}
    name = f"kkt_scratch_e3b_{uuid.uuid4().hex[:8]}"
    owner = {
        "projects": {
            "id": "p-ye",
            "code": "YE",
            "name": "Ye",
            "status": "Planning",
            "version": 6,
            "updated_at": "2026-11-16T07:22:37+00:00",
        },
        "blocks": {
            "id": "b-ye",
            "project_id": "p-ye",
            "name": "Tower 1",
            "construction_percent": 0,
            "version": 3,
            "updated_at": "2026-11-16T07:23:00+00:00",
        },
        "flats": {
            "id": "f-ye",
            "project_id": "p-ye",
            "status": "Available",
            "booking_id": None,
            "version": 2,
            "updated_at": "2026-11-16T07:24:00+00:00",
        },
        "payment_plans": {
            "id": "pp-ye",
            "project_id": "p-ye",
            "name": "Ye CLP",
            "version": 4,
            "updated_at": "2026-11-16T07:25:00+00:00",
        },
    }

    async def go():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        dbx = cl[name]
        try:
            for c, d in owner.items():
                await dbx[c].insert_one(dict(d))
            await wipe_transactional(dbx)
            await _reset_setup_state(dbx)
            return {c: await dbx[c].find_one({"id": d["id"]}, {"_id": 0}) for c, d in owner.items()}
        finally:
            await cl.drop_database(name)
            cl.close()

    after = _run(go())
    assert after == owner


def test_refresh_restores_setup_bytes():
    """C: a setup doc the story walks back to the same content keeps its exact pre-refresh bytes (version/updated_at)."""
    import asyncio

    from motor.motor_asyncio import AsyncIOMotorClient

    from routers.admin import restore_setup_meta

    async def run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = cli[f"{os.environ['DB_NAME']}_setup_bytes_test"]
        try:
            await d.flats.insert_one({"id": "f1", "status": "Booked", "version": 6, "updated_at": "2026-01-01"})
            await d.projects.insert_one({"id": "p1", "name": "Ye", "version": 6, "updated_at": "2026-01-01"})
            snap = {c: await d[c].find({}).to_list(None) for c in ("flats", "projects")}
            await d.flats.update_one({"id": "f1"}, {"$set": {"status": "Available"}, "$inc": {"version": 1}})
            await d.flats.update_one(
                {"id": "f1"}, {"$set": {"status": "Booked", "updated_at": "2026-11-17"}, "$inc": {"version": 1}}
            )
            await d.projects.update_one({"id": "p1"}, {"$inc": {"version": 4}, "$set": {"updated_at": "x"}})
            await d.parking_slots.insert_one({"id": "s1", "status": "Allotted", "booking_id": "b-old", "version": 3})
            snap["parking_slots"] = await d.parking_slots.find({}).to_list(None)
            await d.parking_slots.update_one({"id": "s1"}, {"$set": {"booking_id": "b-new"}, "$inc": {"version": 2}})
            out = await restore_setup_meta(d, snap)
            assert out == {"restored": 3, "content_changed": 0}
            s1 = await d.parking_slots.find_one({"id": "s1"}, {"_id": 0})
            assert s1 == {"id": "s1", "status": "Allotted", "booking_id": "b-new", "version": 3}
            del snap["parking_slots"]
            for c in ("flats", "projects"):
                assert await d[c].find({}).to_list(None) == snap[c]  # byte-identical incl. version/updated_at
        finally:
            await cli.drop_database(d.name)

    asyncio.run(run())
