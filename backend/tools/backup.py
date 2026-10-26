"""Phase K.12: app-level backup. mongodump of the app DB (gzip archive) + SHA-256 manifest to BACKUP_DIR (local path or mounted object storage).
Managed Atlas has its own snapshots; this is an application-level export for portability + restore drills.
Usage: python tools/backup.py [--out DIR]   (also run nightly as job BACKUP)."""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/app/backups")
RETENTION = int(os.environ.get("BACKUP_RETENTION", "14"))


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_backup(out_dir: str = BACKUP_DIR, db_name: str | None = None) -> dict:
    db_name = db_name or os.environ["DB_NAME"]
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive = os.path.join(out_dir, f"{db_name}-{stamp}.archive.gz")
    t0 = time.time()
    subprocess.run(["mongodump", f"--uri={os.environ['MONGO_URL']}", f"--db={db_name}", f"--archive={archive}", "--gzip", "--quiet"], check=True, timeout=1500)
    manifest = {"db": db_name, "archive": os.path.basename(archive), "sha256": _sha(archive), "bytes": os.path.getsize(archive), "created_at": datetime.now(timezone.utc).isoformat(), "duration_s": round(time.time() - t0, 1), "tool": "mongodump --gzip --archive"}
    with open(archive + ".manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    _prune(out_dir, db_name)
    return manifest


def _prune(out_dir, db_name):
    files = sorted(f for f in os.listdir(out_dir) if f.startswith(db_name + "-") and f.endswith(".archive.gz"))
    for f in files[:-RETENTION]:
        for p in (f, f + ".manifest.json"):
            try:
                os.remove(os.path.join(out_dir, p))
            except FileNotFoundError:
                pass


def latest_manifest(out_dir: str = BACKUP_DIR, db_name: str | None = None) -> dict | None:
    db_name = db_name or os.environ["DB_NAME"]
    if not os.path.isdir(out_dir):
        return None
    files = sorted(f for f in os.listdir(out_dir) if f.startswith(db_name + "-") and f.endswith(".manifest.json"))
    return json.load(open(os.path.join(out_dir, files[-1]))) if files else None


async def backup_job():
    """Nightly BACKUP job: records a job_run, stores the manifest in settings.last_backup."""
    from db import db
    from services import job_runs
    run = await job_runs.start("BACKUP")
    try:
        m = await asyncio.to_thread(run_backup)
        await db.settings.update_one({"key": "last_backup"}, {"$set": {"value": m}}, upsert=True)
        return await job_runs.finish(run, m)
    except Exception as e:  # noqa: BLE001
        await job_runs.item_failed(run, "mongodump", e)
        return await job_runs.finish(run, {"error": str(e)[:300]})


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else BACKUP_DIR
    print(json.dumps(run_backup(out), indent=2))
