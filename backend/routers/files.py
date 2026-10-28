"""Phase J4: files pipeline — resumable chunked uploads (init → 5 MB parts with sha256 → complete), magic-byte + extension allow-list,
image variants (320/1024/2048 WebP, EXIF stripped) in an isolated background job, signed URLs (15 min) for private files, immutable content-hash
variant names with long cache headers, streaming downloads, retention/legal hold. Raw storage keys never leave the API."""
import asyncio
import hashlib
import hmac
import io
import logging
import os
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse

import storage
from db import db
from deps import get_current_user, require
from services import kyc_files as kyc
from services.filesig import sniff
from utils import ApiError, client_ip, write_audit

log = logging.getLogger("files")
router = APIRouter(tags=["files"])
PART_SIZE = 5 * 1024 * 1024
MAX_SIZE = 500 * 1024 * 1024
LINK_TTL_S = 900
ALLOWED = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".heic": "image/heic",
           ".mp4": "video/mp4", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
SIGS_EXTRA = {"video/mp4": lambda b: b[4:8] == b"ftyp", "image/heic": lambda b: b[4:8] == b"ftyp", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": lambda b: b[:2] == b"PK",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": lambda b: b[:2] == b"PK"}
VARIANT_MIMES = ("image/jpeg", "image/png", "image/webp")
VARIANTS = {"thumb": 320, "medium": 1024, "large": 2048}
_SECRET = (os.environ.get("JWT_SECRET") or "files-dev").encode()


def _part_key(upload_id: str, n: int) -> str:
    return f"uploads/{upload_id}/{n:05d}.part"


def _sign(fid: str, exp: int) -> str:
    return hmac.new(_SECRET, f"file.{fid}.{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_url(fid: str) -> str:
    exp = int(time.time()) + LINK_TTL_S
    return f"/api/files/{fid}/download?exp={exp}&sig={_sign(fid, exp)}"


def present(f: dict, user: dict | None = None) -> dict:
    """Public shape: never the storage key. Variants are addressed by immutable content-hash names.
    Z.2: KYC files are masked (no url / variants, `locked`) for viewers who may not open them."""
    out = {k: v for k, v in f.items() if k not in ("_id", "storage_key")}
    out["variants"] = {k: f"/api/files/variants/{v}" for k, v in (f.get("variant_names") or {}).items()}
    out.pop("variant_names", None)
    if f.get("kind") in kyc.KYC_KINDS and user is not None and not kyc.can_open(user):
        # masked entry: id, kind, status, timestamps, links — never filename/size/hash/thumbnail/url
        keep = ("id", "kind", "entity_type", "entity_id", "customer_id", "booking_id", "created_at", "is_active", "is_sensitive", "variants_state", "version")
        return {**{k: out.get(k) for k in keep}, "filename": "Masked", "locked": True, "variants": {}, "url": None}
    out["url"] = signed_url(f["id"])
    return out


def _verify(head: bytes, filename: str, declared: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED:
        raise ApiError(415, f"File type {ext or '(none)'} is not allowed", "FILE_TYPE_NOT_ALLOWED", {"allowed": sorted(ALLOWED)})
    mime = ALLOWED[ext]
    ok = sniff(head, mime) if mime in ("image/jpeg", "image/png", "image/webp", "application/pdf") else SIGS_EXTRA[mime](head)
    if not ok:
        raise ApiError(415, "File content does not match its extension (magic bytes)", "FILE_SIGNATURE_MISMATCH")
    return mime


# ---- resumable upload ---------------------------------------------------------------------------------------------
@router.post("/uploads/init", status_code=201)
async def upload_init(body: dict, request: Request, user: dict = Depends(get_current_user)):
    size = int(body.get("size") or 0)
    if size <= 0 or size > MAX_SIZE:
        raise ApiError(413, "File must be between 1 byte and 500 MB", "FILE_TOO_LARGE")
    ext = os.path.splitext(body.get("filename") or "")[1].lower()
    if ext not in ALLOWED:
        raise ApiError(415, f"File type {ext or '(none)'} is not allowed", "FILE_TYPE_NOT_ALLOWED", {"allowed": sorted(ALLOWED)})
    uid = uuid.uuid4().hex
    kind = body.get("kind", "document")
    if kind in kyc.KYC_KINDS:  # Z.2: co-applicant KYC — same permission as adding a co-applicant, 10 MB, PDF/JPG/PNG/HEIC only
        if "sales.customer.edit" not in user["permissions"]:
            raise ApiError(403, "Missing permission: sales.customer.edit", "FORBIDDEN")
        if body.get("entity_type") != "co_applicant" or not body.get("entity_id"):
            raise ApiError(422, "KYC files attach to a co-applicant (entity_type=co_applicant, entity_id)", "VALIDATION_ERROR")
        if size > kyc.KYC_MAX:
            raise ApiError(413, "KYC file must be 10 MB or smaller", "FILE_TOO_LARGE")
        if ext not in kyc.KYC_EXT:
            raise ApiError(415, "KYC files: PDF, JPG, PNG or HEIC", "FILE_TYPE_NOT_ALLOWED", {"allowed": list(kyc.KYC_EXT)})
    parts = (size + PART_SIZE - 1) // PART_SIZE
    doc = {"id": uid, "user_id": user["id"], "company_id": user.get("company_id"), "filename": body["filename"], "size": size, "parts": parts, "part_size": PART_SIZE, "received": {},
           "entity_type": body.get("entity_type"), "entity_id": body.get("entity_id"), "project_id": body.get("project_id"), "kind": kind, "caption": body.get("caption"),
           "customer_id": body.get("customer_id"), "booking_id": body.get("booking_id"),
           "state": "uploading", "created_at": datetime.now(timezone.utc).isoformat(), "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
    await db.uploads.insert_one({**doc})
    doc.pop("_id", None)
    return {**doc, "received_parts": []}


@router.get("/uploads/{upload_id}")
async def upload_status(upload_id: str, user: dict = Depends(get_current_user)):
    u = await db.uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not u:
        raise ApiError(404, "Upload not found or expired", "NOT_FOUND")
    return {**u, "received_parts": sorted(int(k) for k in u["received"])}


@router.put("/uploads/{upload_id}/parts/{n}")
async def upload_part(upload_id: str, n: int, request: Request, x_part_sha256: str = Header(...), user: dict = Depends(get_current_user)):
    u = await db.uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not u or u["state"] != "uploading":
        raise ApiError(404, "Upload not found or already completed", "NOT_FOUND")
    if n < 1 or n > u["parts"]:
        raise ApiError(422, f"Part {n} out of range 1..{u['parts']}", "VALIDATION_ERROR")
    h = hashlib.sha256()
    buf = bytearray()
    async for chunk in request.stream():
        h.update(chunk)
        buf += chunk
        if len(buf) > PART_SIZE:
            raise ApiError(413, "Part exceeds 5 MB", "FILE_TOO_LARGE")
    size = len(buf)
    if h.hexdigest() != x_part_sha256.lower():
        raise ApiError(422, "Part hash mismatch — resend this part", "PART_HASH_MISMATCH", {"part": n})
    await storage.put_object(_part_key(upload_id, n), bytes(buf), "application/octet-stream")
    del buf
    await db.uploads.update_one({"id": upload_id}, {"$set": {f"received.{n}": {"size": size, "sha256": h.hexdigest()}}})
    return {"part": n, "size": size, "received_parts": sorted(int(k) for k in u["received"]) + [n]}


@router.post("/uploads/{upload_id}/complete", status_code=201)
async def upload_complete(upload_id: str, request: Request, user: dict = Depends(get_current_user)):
    u = await db.uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not u or u["state"] != "uploading":
        raise ApiError(404, "Upload not found or already completed", "NOT_FOUND")
    missing = [i for i in range(1, u["parts"] + 1) if str(i) not in u["received"]]
    if missing:
        raise ApiError(409, f"{len(missing)} part(s) missing", "UPLOAD_INCOMPLETE", {"missing": missing[:50]})
    first = (await storage.get_object(_part_key(upload_id, 1)))[0]
    mime = _verify(first[:4096], u["filename"], None)
    ext = os.path.splitext(u["filename"])[1].lower()
    key = f"files/{upload_id[:2]}/{upload_id}{ext}"
    total = hashlib.sha256()
    size = 0
    with tempfile.TemporaryFile() as spool:  # request-scoped spool: parts live in object storage; the final object is PUT with exact length
        for i in range(1, u["parts"] + 1):
            for chunk in storage.iter_object(_part_key(upload_id, i)):
                total.update(chunk)
                size += len(chunk)
                spool.write(chunk)
        if size != u["size"]:
            raise ApiError(422, f"Assembled size {size} ≠ declared {u['size']}", "VALIDATION_ERROR")
        spool.seek(0)
        await storage.put_stream(key, spool, mime, size)
    sha = total.hexdigest()
    fid = str(uuid.uuid4())
    is_kyc = u.get("kind") in kyc.KYC_KINDS
    doc = {"id": fid, "company_id": u["company_id"], "entity_type": u["entity_type"], "entity_id": u["entity_id"], "project_id": u["project_id"], "kind": u["kind"], "caption": u.get("caption"),
           "customer_id": u.get("customer_id"), "booking_id": u.get("booking_id"), "is_sensitive": is_kyc,
           "filename": u["filename"], "content_type": mime, "size": size, "sha256": sha, "storage_key": key, "is_image": mime in VARIANT_MIMES, "variant_names": {}, "variants_state": "pending" if mime in VARIANT_MIMES else "n/a",
           "legal_hold": False, "retention_until": None, "uploaded_by": user["id"], "created_at": datetime.now(timezone.utc).isoformat(), "version": 1, "is_active": True}
    await db.files.insert_one({**doc})
    if is_kyc:  # one live file per co-applicant + kind: a re-upload replaces (soft) the previous one
        await db.files.update_many({"entity_type": "co_applicant", "entity_id": u["entity_id"], "kind": u["kind"], "is_active": True, "id": {"$ne": fid}},
                                   {"$set": {"is_active": False, "deleted_at": doc["created_at"], "replaced_by": fid}})
    await db.uploads.update_one({"id": upload_id}, {"$set": {"state": "completed", "file_id": fid}})
    for i in range(1, u["parts"] + 1):
        await storage.delete_object(_part_key(upload_id, i))
    await write_audit(user, "kyc.upload" if is_kyc else "file.upload", u["entity_type"] or "file", u["entity_id"] or fid, after={"file_id": fid, "filename": u["filename"], "size": size, "sha256": sha, "kind": u["kind"]}, ip=client_ip(request))
    if doc["is_image"]:
        asyncio.create_task(variants_job([fid]))
    return present(doc, user)


# ---- variants job -----------------------------------------------------------------------------------------------------
def _make_variants(data: bytes) -> dict:
    """PIL: decode, drop EXIF (re-encode without metadata), resize, WebP → object storage under immutable content-hash names."""
    from PIL import Image, ImageOps
    names = {}
    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")  # orientation applied, then EXIF discarded
        for name, px in VARIANTS.items():
            v = im.copy()
            v.thumbnail((px, px))
            buf = io.BytesIO()
            v.save(buf, "WEBP", quality=82, method=4)
            out = buf.getvalue()
            fname = f"{hashlib.sha256(out).hexdigest()}.webp"
            storage._put(f"variants/{fname}", out, "image/webp")
            names[name] = fname
    return names


async def variants_job(file_ids: list[str]) -> dict:
    """Per-file isolation: a corrupt image marks that file failed and the batch continues (job_runs record)."""
    from services import job_runs

    async def gen():
        for fid in file_ids:
            f = await db.files.find_one({"id": fid}, {"_id": 0})
            if f:
                yield f

    async def one(f):
        data, _ = await storage.get_object(f["storage_key"])  # bounded by one image, not by collection size
        try:
            names = await asyncio.to_thread(_make_variants, data)
            await db.files.update_one({"id": f["id"]}, {"$set": {"variant_names": names, "variants_state": "ready"}})
        except Exception:
            await db.files.update_one({"id": f["id"]}, {"$set": {"variants_state": "failed"}})
            raise
        return 1
    return await job_runs.run_isolated("IMAGE_VARIANTS", gen(), one, item_id=lambda f: f["id"])


# ---- read / serve -------------------------------------------------------------------------------------------------------
@router.get("/files")
async def list_files(entity_type: str | None = None, entity_id: str | None = None, project_id: str | None = None, kind: str | None = None, customer_id: str | None = None, cursor: str | None = None, limit: int = 60,
                     user: dict = Depends(get_current_user)):
    q = {"company_id": user.get("company_id"), "is_active": True}
    for k, v in (("entity_type", entity_type), ("entity_id", entity_id), ("project_id", project_id), ("kind", kind)):
        if v:
            q[k] = {"$in": v.split(",")} if "," in v else v
    if customer_id:
        q["customer_id"] = customer_id
    if kind == "kyc" or (kind and set(kind.split(",")) <= set(kyc.KYC_KINDS)):
        q["kind"] = {"$in": list(kyc.KYC_KINDS)} if kind == "kyc" else q["kind"]
        if "sales.customer.view" not in user["permissions"]:
            raise ApiError(403, "Missing permission: sales.customer.view", "FORBIDDEN")
    if cursor:
        q["created_at"] = {"$lt": cursor}
    limit = max(1, min(limit, 200))
    rows = await db.files.find(q, {"_id": 0}).sort([("created_at", -1)]).limit(limit + 1).to_list(limit + 1)
    more = len(rows) > limit
    rows = rows[:limit]
    return {"items": [present(f, user) for f in rows], "next_cursor": rows[-1]["created_at"] if more and rows else None}


@router.get("/files/variants/{name}")
async def variant(name: str):
    """Immutable content-hash name → cache forever. Variants carry no EXIF and are public-safe renditions."""
    if not name.endswith(".webp") or len(name) != 69 or "/" in name:
        raise ApiError(404, "Not found", "NOT_FOUND")
    return StreamingResponse(storage.iter_object(f"variants/{name}"), media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/files/{file_id}")
async def file_meta(file_id: str, request: Request, user: dict = Depends(get_current_user)):
    f = await db.files.find_one({"id": file_id, "company_id": user.get("company_id"), "is_active": {"$ne": False}}, {"_id": 0})
    if not f:
        raise ApiError(404, "File not found", "NOT_FOUND")
    if f.get("kind") in kyc.KYC_KINDS and kyc.can_open(user):
        await kyc.gate(user, f, client_ip(request))
    return present(f, user)  # non-reveal users get the masked shape (kind / status / completeness only)


@router.get("/files/{file_id}/url")
async def file_url(file_id: str, request: Request, user: dict = Depends(get_current_user)):
    f = await db.files.find_one({"id": file_id, "company_id": user.get("company_id")}, {"_id": 0, "id": 1, "kind": 1, "entity_id": 1, "customer_id": 1})
    if not f:
        raise ApiError(404, "File not found", "NOT_FOUND")
    if f.get("kind") in kyc.KYC_KINDS:  # signed links for KYC files are issued only to permitted users, every issue audited
        await kyc.gate(user, f, client_ip(request))
    return {"url": signed_url(file_id), "expires_in_s": LINK_TTL_S}


@router.get("/files/{file_id}/download")
async def download(file_id: str, exp: int | None = None, sig: str | None = None):
    if not exp or not sig or exp < time.time() or not hmac.compare_digest(sig, _sign(file_id, exp)):
        raise ApiError(401 if not sig else 403, "Link expired or invalid; request a fresh one", "FILE_LINK_INVALID")
    f = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise ApiError(404, "File not found", "NOT_FOUND")
    safe = f["filename"].replace('"', "")
    return StreamingResponse(storage.iter_object(f["storage_key"]), media_type=f["content_type"],
                             headers={"Content-Disposition": f'attachment; filename="{safe}"', "Content-Length": str(f["size"]), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.patch("/files/{file_id}")
async def patch_file(file_id: str, body: dict, request: Request, user: dict = Depends(require("construction.photo.upload"))):
    f = await db.files.find_one({"id": file_id, "company_id": user.get("company_id")}, {"_id": 0})
    if not f:
        raise ApiError(404, "File not found", "NOT_FOUND")
    allowed = {k: body[k] for k in ("caption", "legal_hold", "retention_until", "kind") if k in body}
    await db.files.update_one({"id": file_id}, {"$set": allowed, "$inc": {"version": 1}})
    await write_audit(user, "file.update", "file", file_id, before={k: f.get(k) for k in allowed}, after=allowed, ip=client_ip(request))
    return present({**f, **allowed})


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, request: Request, user: dict = Depends(require("construction.photo.upload"))):
    f = await db.files.find_one({"id": file_id, "company_id": user.get("company_id")}, {"_id": 0})
    if not f:
        raise ApiError(404, "File not found", "NOT_FOUND")
    if f.get("legal_hold") or (f.get("retention_until") and f["retention_until"] > datetime.now(timezone.utc).date().isoformat()):
        raise ApiError(409, "File is under legal hold / retention and cannot be deleted", "FILE_RETAINED")
    await db.files.update_one({"id": file_id}, {"$set": {"is_active": False, "deleted_at": datetime.now(timezone.utc).isoformat()}})
    await write_audit(user, "file.delete", "file", file_id, before={"filename": f["filename"]}, ip=client_ip(request))
    return {"ok": True}


async def storage_usage() -> list[dict]:
    """System Health: per-project bytes/files (active files)."""
    rows = await db.files.aggregate([{"$match": {"is_active": True}}, {"$group": {"_id": "$project_id", "files": {"$sum": 1}, "bytes": {"$sum": "$size"}}}, {"$sort": {"bytes": -1}}, {"$limit": 50}]).to_list(50)
    names = {p["id"]: p["name"] for p in await db.projects.find({"id": {"$in": [r["_id"] for r in rows if r["_id"]]}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    return [{"project_id": r["_id"], "project": names.get(r["_id"], "—"), "files": r["files"], "bytes": r["bytes"]} for r in rows]
