"""ERP side: Service Requests, Notices, Construction Photos, document sharing flag. Phase 5."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from db import db
from deps import project_scope_filter, require
from services.filesig import sniff
from storage import put_object
from utils import ApiError, ListParams, StrictModel, base_doc, client_ip, get_or_404, now_iso, paginate, search_filter, write_audit

router = APIRouter(tags=["support"])
SR_STATUSES = ["New", "In Progress", "Awaiting Customer", "Resolved", "Closed"]


# ---------- Service requests ----------
@router.get("/service-requests")
async def list_sr(params: ListParams = Depends(), status: str | None = None, priority: str | None = None, assigned_to: str | None = None, project_id: str | None = None, customer_id: str | None = None, category: str | None = None, overdue: bool = False, user: dict = Depends(require("service.read"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["ticket_number", "subject", "customer_name", "booking_number", "flat_number"])}
    for k, v in (("status", status), ("priority", priority), ("assigned_to", assigned_to), ("project_id", project_id), ("customer_id", customer_id), ("category", category)):
        if v:
            q[k] = v
    if overdue:
        q.update({"status": {"$in": ["New", "In Progress"]}, "sla_due_at": {"$lt": now_iso()}})
    res = await paginate(db.service_requests, q, params, params.sort_spec(["created_at", "sla_due_at", "priority", "status", "ticket_number"], default="-created_at"))
    counts = await db.service_requests.aggregate([{"$match": {"company_id": user["company_id"], **project_scope_filter(user)}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
    res["status_counts"] = {c["_id"]: c["n"] for c in counts}
    return res


@router.get("/service-requests/categories")
async def sr_categories(user: dict = Depends(require("service.read"))):
    return {"items": await db.service_categories.find({"company_id": user["company_id"], "is_active": True}, {"_id": 0}).sort("order", 1).to_list(50)}


@router.get("/service-requests/{sr_id}")
async def get_sr(sr_id: str, user: dict = Depends(require("service.read"))):
    return await get_or_404(db.service_requests, sr_id, "Service request", {"company_id": user["company_id"], **project_scope_filter(user)})


@router.get("/service-requests/{sr_id}/attachments/{idx}")
async def sr_attachment(sr_id: str, idx: int, user: dict = Depends(require("service.read"))):
    from fastapi import Response
    from storage import get_object
    sr = await get_or_404(db.service_requests, sr_id, "Service request", {"company_id": user["company_id"], **project_scope_filter(user)})
    atts = [a for m in sr.get("thread") or [] for a in (m.get("attachments") or [])]
    if idx < 0 or idx >= len(atts):
        raise ApiError(404, "Attachment not found", "NOT_FOUND")
    a = atts[idx]
    data, mime = await get_object(a["storage_key"])
    return Response(content=data, media_type=a.get("mime") or mime, headers={"Content-Disposition": f'inline; filename="{a["name"]}"'})


class SRCreateIn(StrictModel):
    customer_id: str
    booking_id: str
    category: str
    priority: str = "Medium"
    subject: str
    description: str


@router.post("/service-requests", status_code=201)
async def create_sr(body: SRCreateIn, request: Request, user: dict = Depends(require("service.write"))):
    from routers.portal import create_service_request
    c = await get_or_404(db.customers, body.customer_id, "Customer", {"company_id": user["company_id"]})
    b = await get_or_404(db.bookings, body.booking_id, "Booking", {"company_id": user["company_id"]})
    sr = await create_service_request(user["company_id"], c, b, body.category, body.priority, body.subject, body.description, [], "staff", user["name"], user["id"])
    return sr


class SRReplyIn(StrictModel):
    message: str
    internal: bool = False
    status: str | None = None


@router.post("/service-requests/{sr_id}/reply")
async def reply_sr(sr_id: str, body: SRReplyIn, request: Request, user: dict = Depends(require("service.write"))):
    sr = await get_or_404(db.service_requests, sr_id, "Service request", {"company_id": user["company_id"]})
    msg = {"by": "staff", "author_name": user["name"], "author_id": user["id"], "message": body.message.strip(), "attachments": [], "at": now_iso(), "internal": body.internal}
    upd = {"updated_at": now_iso()}
    push = {"thread": msg}
    if body.status and body.status in SR_STATUSES and body.status != sr["status"]:
        upd["status"] = body.status
        if body.status == "Resolved":
            upd["resolved_at"] = now_iso()
        if body.status == "Closed":
            upd["closed_at"] = now_iso()
        push["stage_history"] = {"from": sr["status"], "to": body.status, "at": now_iso(), "by": user["name"]}
    elif not body.internal and sr["status"] == "New":
        upd["status"] = "In Progress"
        push["stage_history"] = {"from": "New", "to": "In Progress", "at": now_iso(), "by": user["name"]}
    await db.service_requests.update_one({"id": sr_id}, {"$push": push, "$set": upd, "$inc": {"version": 1}})
    if not body.internal:
        from services.portal_notify import notify_customer
        await notify_customer(sr["company_id"], sr["customer_id"], "ticket.reply", f"Reply on {sr['ticket_number']}", f"{sr.get('subject', '')} · {user['name']} replied", sr.get("booking_id"), "service_request", sr_id)
    await write_audit(user, "service.internal_note" if body.internal else "service.reply", "service_request", sr_id, after={"ticket_number": sr["ticket_number"], "status": upd.get("status", sr["status"]), "customer_id": sr["customer_id"]}, ip=client_ip(request))
    return await db.service_requests.find_one({"id": sr_id}, {"_id": 0})


class SRAssignIn(StrictModel):
    assigned_to: str | None
    priority: str | None = None


@router.post("/service-requests/{sr_id}/assign")
async def assign_sr(sr_id: str, body: SRAssignIn, request: Request, user: dict = Depends(require("service.assign"))):
    sr = await get_or_404(db.service_requests, sr_id, "Service request", {"company_id": user["company_id"]})
    upd = {"assigned_to": body.assigned_to, "updated_at": now_iso()}
    if body.priority in ("Low", "Medium", "High"):
        upd["priority"] = body.priority
    await db.service_requests.update_one({"id": sr_id}, {"$set": upd, "$inc": {"version": 1}})
    await write_audit(user, "service.assign", "service_request", sr_id, after={"ticket_number": sr["ticket_number"], "assigned_to": body.assigned_to, "subject": sr["subject"], "customer_name": sr["customer_name"]}, ip=client_ip(request))
    return await db.service_requests.find_one({"id": sr_id}, {"_id": 0})


class SRStatusIn(StrictModel):
    status: str


@router.post("/service-requests/{sr_id}/status")
async def status_sr(sr_id: str, body: SRStatusIn, request: Request, user: dict = Depends(require("service.write"))):
    if body.status not in SR_STATUSES:
        raise ApiError(422, "Invalid status", "VALIDATION_ERROR")
    sr = await get_or_404(db.service_requests, sr_id, "Service request", {"company_id": user["company_id"]})
    upd = {"status": body.status, "updated_at": now_iso()}
    if body.status == "Resolved":
        upd["resolved_at"] = now_iso()
    if body.status == "Closed":
        upd["closed_at"] = now_iso()
    await db.service_requests.update_one({"id": sr_id}, {"$set": upd, "$push": {"stage_history": {"from": sr["status"], "to": body.status, "at": now_iso(), "by": user["name"]}}, "$inc": {"version": 1}})
    await write_audit(user, "service.status", "service_request", sr_id, before={"status": sr["status"]}, after={"status": body.status, "ticket_number": sr["ticket_number"], "customer_id": sr["customer_id"]}, ip=client_ip(request))
    return await db.service_requests.find_one({"id": sr_id}, {"_id": 0})


async def sla_breach_job():
    now = now_iso()
    async for sr in db.service_requests.find({"status": {"$in": ["New", "In Progress"]}, "sla_due_at": {"$lt": now}, "sla_breached": {"$ne": True}}, {"_id": 0}):
        await db.service_requests.update_one({"id": sr["id"]}, {"$set": {"sla_breached": True}})
        await write_audit({"id": "system", "name": "SLA job", "company_id": sr["company_id"]}, "service.sla_breach", "service_request", sr["id"], after={"ticket_number": sr["ticket_number"], "assigned_to": sr.get("assigned_to"), "subject": sr["subject"], "customer_name": sr["customer_name"]}, ip=None)


# ---------- Notices ----------
class NoticeIn(StrictModel):
    title: str
    body: str
    version: int | None = None
    project_ids: list[str] = []
    publish_at: str | None = None
    expires_at: str | None = None
    pinned: bool = False
    is_active: bool = True


@router.get("/notices")
async def list_notices(user: dict = Depends(require("cms.read"))):
    return {"items": await db.notices.find({"company_id": user["company_id"]}, {"_id": 0}).sort([("pinned", -1), ("publish_at", -1)]).to_list(200)}


async def _notice_doc(body: NoticeIn, user: dict) -> dict:
    names = [p["name"] for p in await db.projects.find({"id": {"$in": body.project_ids}}, {"_id": 0, "name": 1}).to_list(None)] if body.project_ids else []
    return {**body.model_dump(exclude={"version"}), "publish_at": body.publish_at or now_iso(), "project_names": names}


@router.post("/notices", status_code=201)
async def create_notice(body: NoticeIn, request: Request, user: dict = Depends(require("cms.write"))):
    doc = {**base_doc(user, user["company_id"]), **await _notice_doc(body, user)}
    await db.notices.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "notice.create", "notice", doc["id"], after={"title": doc["title"]}, ip=client_ip(request))
    from services.portal_notify import notify_customer
    bq = {"company_id": user["company_id"], "status": "Active", **({"project_id": {"$in": body.project_ids}} if body.project_ids else {})}
    seen = set()
    async for b in db.bookings.find(bq, {"_id": 0, "customer_id": 1, "co_applicant_customer_ids": 1}):
        for cid in [b["customer_id"], *(b.get("co_applicant_customer_ids") or [])]:
            if cid not in seen:
                seen.add(cid)
                await notify_customer(user["company_id"], cid, "notice.published", f"Notice: {doc['title']}", ", ".join(doc.get("project_names") or []) or "All projects", None, "notice", doc["id"])
    return doc


@router.patch("/notices/{notice_id}")
async def update_notice(notice_id: str, body: NoticeIn, request: Request, user: dict = Depends(require("cms.write"))):
    await get_or_404(db.notices, notice_id, "Notice", {"company_id": user["company_id"]})
    await db.notices.update_one({"id": notice_id}, {"$set": {**await _notice_doc(body, user), "updated_at": now_iso()}, "$inc": {"version": 1}})
    await write_audit(user, "notice.update", "notice", notice_id, after={"title": body.title}, ip=client_ip(request))
    return await db.notices.find_one({"id": notice_id}, {"_id": 0})


@router.delete("/notices/{notice_id}")
async def delete_notice(notice_id: str, request: Request, user: dict = Depends(require("cms.write"))):
    r = await db.notices.delete_one({"id": notice_id, "company_id": user["company_id"]})
    if not r.deleted_count:
        raise ApiError(404, "Notice not found", "NOT_FOUND")
    await write_audit(user, "notice.delete", "notice", notice_id, ip=client_ip(request))
    return {"ok": True}


# ---------- Construction photos ----------
@router.get("/blocks/{block_id}/photos")
async def list_photos(block_id: str, user: dict = Depends(require("project.read"))):
    return {"items": await db.construction_photos.find({"block_id": block_id, "is_active": True}, {"_id": 0}).sort([("milestone_seq", 1), ("order", 1)]).to_list(500)}


@router.post("/blocks/{block_id}/milestones/{seq}/photos", status_code=201)
async def upload_photos(block_id: str, seq: int, request: Request, files: list[UploadFile] = File(...), caption: str = Form(""), taken_on: str | None = Form(None), visible_to_customers: bool = Form(True), show_on_website: bool = Form(False), user: dict = Depends(require("milestone.update"))):
    blk = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    out = []
    n = await db.construction_photos.count_documents({"block_id": block_id, "milestone_seq": seq})
    for f in files:
        data = await f.read()
        if not data or len(data) > 10 * 1024 * 1024 or not (f.content_type or "").startswith("image/") or not sniff(data, f.content_type):
            raise ApiError(422, "Images only (JPG/PNG/WEBP), max 10 MB", "UNSUPPORTED_MEDIA")
        import secrets
        key = f"construction/{blk['project_id']}/{block_id}/{seq}/{secrets.token_hex(10)}-{f.filename}"
        res = await put_object(key, data, f.content_type)
        n += 1
        doc = {**base_doc(user, user["company_id"]), "project_id": blk["project_id"], "block_id": block_id, "milestone_seq": seq, "storage_key": res["path"], "mime": f.content_type, "size": len(data), "caption": caption, "taken_on": taken_on, "visible_to_customers": visible_to_customers, "show_on_website": show_on_website, "order": n}
        doc["url"] = f"/api/public/media/photo/{doc['id']}"
        await db.construction_photos.insert_one(doc)
        doc.pop("_id", None)
        out.append(doc)
    await write_audit(user, "construction.photo_upload", "block", block_id, after={"milestone_seq": seq, "count": len(out)}, ip=client_ip(request))
    return {"items": out}


class PhotoPatchIn(StrictModel):
    caption: str | None = None
    version: int | None = None
    taken_on: str | None = None
    visible_to_customers: bool | None = None
    show_on_website: bool | None = None
    order: int | None = None


@router.patch("/photos/{photo_id}")
async def patch_photo(photo_id: str, body: PhotoPatchIn, request: Request, user: dict = Depends(require("milestone.update"))):
    p = await get_or_404(db.construction_photos, photo_id, "Photo", {"company_id": user["company_id"]})
    upd = {k: v for k, v in body.model_dump(exclude={"version"}).items() if v is not None}
    await db.construction_photos.update_one({"id": photo_id}, {"$set": {**upd, "updated_at": now_iso()}})
    await write_audit(user, "construction.photo_update", "block", p["block_id"], before={k: p.get(k) for k in upd}, after=upd, ip=client_ip(request))
    return await db.construction_photos.find_one({"id": photo_id}, {"_id": 0})


@router.delete("/photos/{photo_id}")
async def delete_photo(photo_id: str, request: Request, user: dict = Depends(require("milestone.update"))):
    p = await get_or_404(db.construction_photos, photo_id, "Photo", {"company_id": user["company_id"]})
    await db.construction_photos.update_one({"id": photo_id}, {"$set": {"is_active": False, "deleted_at": now_iso()}})
    await write_audit(user, "construction.photo_delete", "block", p["block_id"], ip=client_ip(request))
    return {"ok": True}


class NoteIn(StrictModel):
    progress_note: str
    version: int | None = None


@router.patch("/blocks/{block_id}/milestones/{seq}/note")
async def milestone_note(block_id: str, seq: int, body: NoteIn, request: Request, user: dict = Depends(require("milestone.update"))):
    blk = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ms = blk.get("milestones") or []
    for m in ms:
        if m["seq"] == seq:
            m["progress_note"] = body.progress_note
    await db.blocks.update_one({"id": block_id}, {"$set": {"milestones": ms, "updated_at": now_iso()}})
    await write_audit(user, "construction.progress_note", "block", block_id, after={"milestone_seq": seq, "progress_note": body.progress_note}, ip=client_ip(request))
    return {"ok": True}


# ---------- Document sharing flag ----------
class ShareIn(StrictModel):
    shared_with_customer: bool
    version: int | None = None


@router.patch("/documents/{doc_id}/share")
async def share_document(doc_id: str, body: ShareIn, request: Request, user: dict = Depends(require("customer.write"))):
    d = await get_or_404(db.documents, doc_id, "Document", {"company_id": user["company_id"]})
    if body.shared_with_customer and d.get("is_sensitive"):
        raise ApiError(409, "Sensitive KYC documents cannot be shared with the portal", "SENSITIVE_DOCUMENT")
    await db.documents.update_one({"id": doc_id}, {"$set": {"shared_with_customer": body.shared_with_customer, "updated_at": now_iso()}})
    await write_audit(user, "document.share", "document", doc_id, after={"shared_with_customer": body.shared_with_customer}, ip=client_ip(request))
    return {"ok": True, "shared_with_customer": body.shared_with_customer}
