"""Phase K.12: restore drill. Restores the latest archive into a scratch DB, runs integrity + headline checks there, records a job_run RESTORE_DRILL.
Usage: python tools/restore_drill.py [--archive PATH] [--scratch kkt_restore_drill]"""
import asyncio
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def restore_to_scratch(archive: str, scratch: str, src_db: str) -> float:
    from pymongo import MongoClient
    MongoClient(os.environ["MONGO_URL"]).drop_database(scratch)
    t0 = time.time()
    subprocess.run(["mongorestore", f"--uri={os.environ['MONGO_URL']}", f"--archive={archive}", "--gzip", f"--nsFrom={src_db}.*", f"--nsTo={scratch}.*", "--quiet"], check=True, timeout=1500)
    return round(time.time() - t0, 1)


def verify_scratch(scratch: str, src_db: str) -> dict:
    """Doc counts per collection must match the live DB (sampled on canonical collections) + checksums of ledger totals."""
    from pymongo import MongoClient
    cli = MongoClient(os.environ["MONGO_URL"])
    live, scr = cli[src_db], cli[scratch]
    out = {"collections": {}, "mismatches": []}
    for c in ("bookings", "payments", "demands", "ledger_entries", "customers", "audit_logs", "users"):
        a, b = live[c].estimated_document_count(), scr[c].count_documents({})
        out["collections"][c] = {"live": a, "restored": b}
        if abs(a - b) > max(2, a // 1000):  # live DB keeps moving; allow a sliver of drift
            out["mismatches"].append(c)
    agg = [{"$group": {"_id": "$type", "amt": {"$sum": "$amount_paise"}}}]
    out["ledger_totals_match"] = sorted(scr.ledger_entries.aggregate(agg), key=lambda x: x["_id"]) == sorted(live.ledger_entries.aggregate(agg), key=lambda x: x["_id"])
    return out


async def drill_job(archive: str | None = None, scratch: str = "kkt_restore_drill") -> dict:
    from db import db
    from services import job_runs
    from tools.backup import BACKUP_DIR, latest_manifest
    run = await job_runs.start("RESTORE_DRILL")
    src = os.environ["DB_NAME"]
    try:
        m = latest_manifest()
        archive = archive or (os.path.join(BACKUP_DIR, m["archive"]) if m else None)
        if not archive:
            raise RuntimeError("no backup archive found")
        secs = await asyncio.to_thread(restore_to_scratch, archive, scratch, src)
        v = await asyncio.to_thread(verify_scratch, scratch, src)
        # integrity on the scratch DB (same code path, pointed at scratch via a second client)
        from motor.motor_asyncio import AsyncIOMotorClient

        from services import integrity
        scratch_db = AsyncIOMotorClient(os.environ["MONGO_URL"])[scratch]
        orig = integrity.db
        integrity.db = scratch_db
        try:
            ir = await integrity.integrity_report()
        finally:
            integrity.db = orig
        result = {"archive": os.path.basename(archive), "restore_s": secs, "verify": v, "integrity_findings": len(ir.get("findings", [])), "integrity_ok": not ir.get("findings")}
        if v["mismatches"] or not v["ledger_totals_match"]:
            await job_runs.item_failed(run, "verify", f"mismatches={v['mismatches']} ledger_totals_match={v['ledger_totals_match']}")
        await db.settings.update_one({"key": "last_restore_drill"}, {"$set": {"value": {**result, "at": run["started_at"]}}}, upsert=True)
        return await job_runs.finish(run, result)
    except Exception as e:  # noqa: BLE001
        await job_runs.item_failed(run, "restore", e)
        return await job_runs.finish(run, {"error": str(e)[:300]})


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    a = sys.argv[sys.argv.index("--archive") + 1] if "--archive" in sys.argv else None
    s = sys.argv[sys.argv.index("--scratch") + 1] if "--scratch" in sys.argv else "kkt_restore_drill"
    print(json.dumps(asyncio.run(drill_job(a, s)), indent=2, default=str))
