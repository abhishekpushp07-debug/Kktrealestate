"""Phase J3 / K#17: async large exports. Reports with > EXPORT_SYNC_MAX rows become an export job (job_runs) that writes CSV to EXPORT_DIR
(Emergent Object Storage mount in production; local dir in dev), served via a signed link (15 min), retained 7 days, max 3 in flight per user."""
import asyncio
import csv
import hashlib
import hmac
import io
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse

from db import db
from deps import get_current_user
from utils import ApiError, csv_safe

router = APIRouter(prefix="/exports", tags=["exports"])
EXPORT_DIR = os.environ.get("EXPORT_DIR", "/app/exports")
EXPORT_SYNC_MAX = int(os.environ.get("EXPORT_SYNC_MAX", "10000"))
MAX_INFLIGHT_PER_USER = 3
RETENTION_DAYS = 7
LINK_TTL_S = 900
_SECRET = (os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY") or "export-dev").encode()


def _sign(export_id: str, exp: int) -> str:
    return hmac.new(_SECRET, f"{export_id}.{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_link(export_id: str) -> str:
    exp = int(time.time()) + LINK_TTL_S
    return f"/api/exports/{export_id}/download?exp={exp}&sig={_sign(export_id, exp)}"


def write_csv(path: str, header_line: str, headers: list[str], rows_iter, totals_row: list | None = None) -> int:
    n = 0
    with open(path, "w", newline="") as f:
        f.write(f"# {header_line}\n")
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows_iter:
            w.writerow([csv_safe(v) for v in r])
            n += 1
        if totals_row:
            w.writerow(totals_row)
    return n


async def start_export(user: dict, report_key: str, title: str, header_line: str, headers: list[str], produce_rows, totals_row=None) -> dict:
    """produce_rows: async callable returning an iterable of row lists (already budgeted / cursor-streamed by the caller)."""
    inflight = await db.exports.count_documents({"user_id": user["id"], "status": {"$in": ["QUEUED", "RUNNING"]}})
    if inflight >= MAX_INFLIGHT_PER_USER:
        raise ApiError(429, f"You already have {MAX_INFLIGHT_PER_USER} exports in progress; wait for one to finish", "EXPORT_LIMIT", {"retry_after": 30})
    eid = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    doc = {"id": eid, "user_id": user["id"], "company_id": user.get("company_id"), "report": report_key, "title": title, "status": "QUEUED", "rows": 0, "bytes": 0,
           "created_at": now.isoformat(), "expires_at": (now + timedelta(days=RETENTION_DAYS)).isoformat(), "finished_at": None, "error": None, "file": f"{eid}.csv"}
    await db.exports.insert_one({**doc})
    asyncio.create_task(_run(eid, header_line, headers, produce_rows, totals_row))
    return {**doc, "download_url": None}


async def _run(eid: str, header_line, headers, produce_rows, totals_row):
    from services import job_runs
    run = await job_runs.start("EXPORT", {"export_id": eid})
    await db.exports.update_one({"id": eid}, {"$set": {"status": "RUNNING"}})
    os.makedirs(EXPORT_DIR, exist_ok=True)
    path = os.path.join(EXPORT_DIR, f"{eid}.csv")
    try:
        rows = await produce_rows()
        n = await asyncio.to_thread(write_csv, path, header_line, headers, rows, totals_row)
        await db.exports.update_one({"id": eid}, {"$set": {"status": "DONE", "rows": n, "bytes": os.path.getsize(path), "finished_at": datetime.now(timezone.utc).isoformat()}})
        await job_runs.finish(run, {"rows": n})
    except Exception as e:  # noqa: BLE001
        await db.exports.update_one({"id": eid}, {"$set": {"status": "FAILED", "error": str(e)[:300], "finished_at": datetime.now(timezone.utc).isoformat()}})
        await job_runs.item_failed(run, eid, e)
        await job_runs.finish(run)


async def purge_expired():
    cutoff = datetime.now(timezone.utc).isoformat()
    async for e in db.exports.find({"expires_at": {"$lt": cutoff}}, {"_id": 0, "id": 1, "file": 1}):
        try:
            os.remove(os.path.join(EXPORT_DIR, e["file"]))
        except FileNotFoundError:
            pass
        await db.exports.delete_one({"id": e["id"]})


def _present(e: dict) -> dict:
    return {k: v for k, v in e.items() if k != "_id"} | {"download_url": signed_link(e["id"]) if e["status"] == "DONE" else None}


@router.get("")
async def list_exports(user: dict = Depends(get_current_user)):
    items = await db.exports.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return {"items": [_present(e) for e in items], "limits": {"sync_max_rows": EXPORT_SYNC_MAX, "max_in_flight": MAX_INFLIGHT_PER_USER, "retention_days": RETENTION_DAYS, "link_ttl_s": LINK_TTL_S}}


@router.get("/{export_id}")
async def get_export(export_id: str, user: dict = Depends(get_current_user)):
    e = await db.exports.find_one({"id": export_id, "user_id": user["id"]}, {"_id": 0})
    if not e:
        raise ApiError(404, "Export not found", "NOT_FOUND")
    return _present(e)


@router.get("/{export_id}/download")
async def download(export_id: str, exp: int, sig: str, request: Request):
    if exp < time.time() or not hmac.compare_digest(sig, _sign(export_id, exp)):
        raise ApiError(403, "Download link expired or invalid; open the Exports page for a fresh link", "EXPORT_LINK_INVALID")
    e = await db.exports.find_one({"id": export_id}, {"_id": 0})
    if not e or e["status"] != "DONE":
        raise ApiError(404, "Export not ready", "NOT_FOUND")
    path = os.path.join(EXPORT_DIR, e["file"])
    if not os.path.exists(path):
        raise ApiError(410, "Export file has been purged (7-day retention)", "EXPORT_EXPIRED")
    return FileResponse(path, media_type="text/csv", filename=f"{e['report']}-{e['created_at'][:10]}.csv", headers={"X-Export-Rows": str(e["rows"]), "Cache-Control": "private, no-store"})
