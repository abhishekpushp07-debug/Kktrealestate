"""Deployment gate: the S1–S3 startup steps (template migration, floor-plan-template → Floor Template, GridFS backups,
paid_parts projection, auto-registered letters) are idempotent and non-destructive. Runs startup twice on a copy of the
current DB and diffs per-collection counts and money sums; no collection may shrink or be dropped."""

import asyncio
import os

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests.test_startup_migrations import RUN, _run_startup  # noqa: F401 — reuse the subprocess harness

SRC = os.environ["DB_NAME"]
DST = f"{SRC}_s1s3test"
SUMS = {
    "payments": "amount_paise",
    "demands": "total_demand_paise",
    "ledger_entries": "udhar_paise",
    "bookings": "agreement_value_paise",
    "flats": "price_paise",
}


async def _clone():
    cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
    await cl.drop_database(DST)
    src, dst = cl[SRC], cl[DST]
    for name in await src.list_collection_names():
        if name.startswith("system.") or name in ("locks",):
            continue
        batch = []  # bounded memory (audit_logs > 500 MB)
        async for d in src[name].find({}).batch_size(1000):
            batch.append(d)
            if len(batch) == 1000:
                await dst[name].insert_many(batch)
                batch = []
        if batch:
            await dst[name].insert_many(batch)
    return cl


async def _snapshot(d):
    out = {}
    for name in sorted(await d.list_collection_names()):
        if name.startswith("system.") or name in (
            "locks",
            "migrations",
            "settings",
            "report_cache",
            "cache",
            "rate_limits",
            "idempotency_keys",
            "idempotency_claims",
            "dashboard_snapshots",
            "integrity_reports",
            "job_runs",
            "notifications",
            "audit_logs",
            "backup_files.chunks",
            "backup_files.files",
        ):
            continue
        row = {"n": await d[name].count_documents({})}
        if name in SUMS:
            agg = await d[name].aggregate([{"$group": {"_id": None, "s": {"$sum": f"${SUMS[name]}"}}}]).to_list(1)
            row["sum"] = agg[0]["s"] if agg else 0
        out[name] = row
    return out


@pytest.mark.timeout(900)
def test_startup_twice_on_db_copy_is_idempotent_and_non_destructive():
    loop = asyncio.new_event_loop()
    cl = loop.run_until_complete(_clone())
    d = cl[DST]
    try:
        before = loop.run_until_complete(_snapshot(d))
        _run_startup()
        after1 = loop.run_until_complete(_snapshot(d))
        _run_startup()
        after2 = loop.run_until_complete(_snapshot(d))
        dropped = [c for c in before if c not in after1]
        shrunk = [
            (c, before[c]["n"], after1[c]["n"]) for c in before if c in after1 and after1[c]["n"] < before[c]["n"]
        ]
        money = [
            (c, before[c].get("sum"), after1[c].get("sum"))
            for c in SUMS
            if c in before and before[c].get("sum") != after1[c].get("sum")
        ]
        assert not dropped and not shrunk and not money, {"dropped": dropped, "shrunk": shrunk, "money_changed": money}
        # second run changes nothing at all (template seeding, floor-template migration, paid_parts, letters are watermarked / pure projections)
        assert after1 == after2, {
            k: (after1.get(k), after2.get(k)) for k in set(after1) | set(after2) if after1.get(k) != after2.get(k)
        }
        # S1 templates exist and were not duplicated
        names = loop.run_until_complete(d.tower_templates.distinct("name"))
        assert len(names) == len(set(names))
    finally:
        loop.run_until_complete(cl.drop_database(DST))
        cl.close()
