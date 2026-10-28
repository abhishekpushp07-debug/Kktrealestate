"""Phase K.12 / Z.1: app-level backup. mongodump of the app DB (gzip archive) + SHA-256 manifest to BACKUP_DIR.
Z.1 retention policy: keep BACKUP_KEEP_PER_DB archives per database (test/scale DBs: BACKUP_KEEP_TEST_DB), global cap BACKUP_MAX_TOTAL_MB
(oldest first), and a pre-flight disk check (skip + `backup.skipped_low_disk` event when free < BACKUP_MIN_FREE_PCT or the cap would be breached).
Usage: python tools/backup.py [--out DIR]   (also run nightly as job BACKUP)."""
import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("backup")
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/app/backups")
_TEST_RE = re.compile(r"(_test|^test_|_scale|^kkt_scale)", re.I)


def policy() -> dict:
    return {"keep_per_db": int(os.environ.get("BACKUP_KEEP_PER_DB") or os.environ.get("BACKUP_RETENTION") or 7),
            "keep_test_db": int(os.environ.get("BACKUP_KEEP_TEST_DB") or 2),
            "max_total_mb": int(os.environ.get("BACKUP_MAX_TOTAL_MB") or 2048),
            "min_free_pct": float(os.environ.get("BACKUP_MIN_FREE_PCT") or 15)}


def is_test_db(name: str) -> bool:
    return bool(_TEST_RE.search(name or ""))


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def list_archives(out_dir: str = BACKUP_DIR) -> list[dict]:
    """Every *.archive.gz in the dir (oldest first): db, size, created_at (from the manifest when present, else mtime)."""
    if not os.path.isdir(out_dir):
        return []
    rows = []
    for f in os.listdir(out_dir):
        if not f.endswith(".archive.gz"):
            continue
        p = os.path.join(out_dir, f)
        m = re.match(r"(.+)-(\d{8}T\d{6}Z)\.archive\.gz$", f)
        created = None
        try:
            created = json.load(open(p + ".manifest.json")).get("created_at")
        except Exception:  # noqa: BLE001 — manifest missing/partial: fall back to the file timestamp
            created = datetime.fromtimestamp(os.path.getmtime(p), timezone.utc).isoformat()
        rows.append({"archive": f, "db": m.group(1) if m else f.split("-")[0], "bytes": os.path.getsize(p), "created_at": created, "has_manifest": os.path.exists(p + ".manifest.json")})
    return sorted(rows, key=lambda r: (r["created_at"] or "", r["archive"]))


def disk_usage(path: str = BACKUP_DIR) -> dict:
    p = path if os.path.isdir(path) else os.path.dirname(path.rstrip("/")) or "/"
    while not os.path.exists(p):
        p = os.path.dirname(p) or "/"
    u = shutil.disk_usage(p)
    return {"total_bytes": u.total, "used_bytes": u.used, "free_bytes": u.free, "free_pct": round(100 * u.free / u.total, 1) if u.total else None, "used_pct": round(100 * u.used / u.total, 1) if u.total else None}


def _remove(out_dir, f):
    for p in (f, f + ".manifest.json"):
        try:
            os.remove(os.path.join(out_dir, p))
        except FileNotFoundError:
            pass


def prune(out_dir: str = BACKUP_DIR, reserve_bytes: int = 0, pol: dict | None = None) -> dict:
    """Global policy: per-db keep-N (oldest first), then the size cap (oldest first across all DBs), leaving `reserve_bytes` headroom under the cap."""
    pol = pol or policy()
    removed = []
    rows = list_archives(out_dir)
    by_db: dict[str, list[dict]] = {}
    for r in rows:
        by_db.setdefault(r["db"], []).append(r)
    for name, items in by_db.items():
        keep = pol["keep_test_db"] if is_test_db(name) else pol["keep_per_db"]
        for r in items[:-keep] if keep > 0 else items:
            _remove(out_dir, r["archive"])
            removed.append(r["archive"])
    rows = [r for r in rows if r["archive"] not in removed]
    cap = pol["max_total_mb"] * 1024 * 1024 - reserve_bytes
    total = sum(r["bytes"] for r in rows)
    for r in rows:  # oldest first
        if total <= cap:
            break
        _remove(out_dir, r["archive"])
        removed.append(r["archive"])
        total -= r["bytes"]
    # zero-byte leftovers of a crashed dump are never worth keeping
    for r in list_archives(out_dir):
        if r["bytes"] == 0:
            _remove(out_dir, r["archive"])
            removed.append(r["archive"])
    return {"removed": removed, "remaining": len(list_archives(out_dir)), "total_bytes": sum(r["bytes"] for r in list_archives(out_dir)), "policy": pol}


def preflight(out_dir: str = BACKUP_DIR, expected_bytes: int | None = None, pol: dict | None = None) -> dict:
    """Prune first; then refuse when free disk is below the floor or the new archive would still breach the cap."""
    pol = pol or policy()
    os.makedirs(out_dir, exist_ok=True)
    prev = [r for r in list_archives(out_dir) if r["db"] == (os.environ.get("DB_NAME") or "")]
    expected = expected_bytes if expected_bytes is not None else (prev[-1]["bytes"] if prev else 0)
    pruned = prune(out_dir, reserve_bytes=expected, pol=pol)
    d = disk_usage(out_dir)
    total = pruned["total_bytes"]
    cap = pol["max_total_mb"] * 1024 * 1024
    reason = None
    if d["free_pct"] is not None and d["free_pct"] < pol["min_free_pct"]:
        reason = f"free disk {d['free_pct']}% < {pol['min_free_pct']}%"
    elif total + expected > cap:
        reason = f"archives {total + expected} B would exceed cap {cap} B"
    elif expected and d["free_bytes"] < expected * 2:
        reason = f"free disk {d['free_bytes']} B < 2× expected archive {expected} B"
    return {"ok": reason is None, "reason": reason, "disk": d, "pruned": pruned["removed"], "expected_bytes": expected}


def run_backup(out_dir: str = BACKUP_DIR, db_name: str | None = None, check: bool = True) -> dict:
    db_name = db_name or os.environ["DB_NAME"]
    os.makedirs(out_dir, exist_ok=True)
    if check:
        pf = preflight(out_dir)
        if not pf["ok"]:
            log.warning("backup skipped: %s", pf["reason"])
            return {"skipped": True, "reason": pf["reason"], "disk": pf["disk"], "db": db_name, "created_at": datetime.now(timezone.utc).isoformat()}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive = os.path.join(out_dir, f"{db_name}-{stamp}.archive.gz")
    t0 = time.time()
    try:
        subprocess.run(["mongodump", f"--uri={os.environ['MONGO_URL']}", f"--db={db_name}", f"--archive={archive}", "--gzip", "--quiet"], check=True, timeout=1500)
    except Exception:
        _remove(out_dir, os.path.basename(archive))  # never leave a partial archive behind
        raise
    manifest = {"db": db_name, "archive": os.path.basename(archive), "sha256": _sha(archive), "bytes": os.path.getsize(archive), "created_at": datetime.now(timezone.utc).isoformat(), "duration_s": round(time.time() - t0, 1), "tool": "mongodump --gzip --archive"}
    with open(archive + ".manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    prune(out_dir)
    return manifest


def latest_manifest(out_dir: str = BACKUP_DIR, db_name: str | None = None) -> dict | None:
    db_name = db_name or os.environ["DB_NAME"]
    if not os.path.isdir(out_dir):
        return None
    files = sorted(f for f in os.listdir(out_dir) if f.startswith(db_name + "-") and f.endswith(".manifest.json"))
    return json.load(open(os.path.join(out_dir, files[-1]))) if files else None


async def backup_job():
    """Nightly BACKUP job: records a job_run, stores the manifest in settings.last_backup; a low-disk skip is an audited system event, not a crash."""
    from db import db
    from services import job_runs
    from utils import write_audit
    run = await job_runs.start("BACKUP")
    try:
        m = await asyncio.to_thread(run_backup)
        if m.get("skipped"):
            await write_audit(None, "backup.skipped_low_disk", "system", "backup", after={"reason": m["reason"], "disk": m["disk"]})
            await db.settings.update_one({"key": "last_backup_skip"}, {"$set": {"value": m}}, upsert=True)
            return await job_runs.finish(run, m)
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
