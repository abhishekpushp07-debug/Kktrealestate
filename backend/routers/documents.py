import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile

from db import db
from services.filesig import sniff
from deps import ensure_project_access, get_current_user
from storage import APP_NAME, get_object, put_object
from utils import ApiError, base_doc, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(prefix="/documents", tags=["documents"])
MAX_SIZE = 15 * 1024 * 1024
ALLOWED = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
ENTITY_PERMS = {"customer": "sales.customer.edit", "booking": "sales.booking.edit", "project": "masters.project.edit", "block": "masters.tower.edit", "flat": "masters.flat.edit", "payment": "finance.payment.create", "floor_plan_template": "masters.floor_plan.edit"}
READ_PERMS = {"customer": "sales.customer.view", "booking": "sales.booking.view", "project": "masters.project.view", "block": "masters.project.view", "flat": "masters.project.view", "payment": "finance.payment.view", "floor_plan_template": "masters.floor_plan.view"}


PARENT = {"customer": db.customers, "booking": db.bookings, "project": db.projects, "block": db.blocks, "flat": db.flats, "payment": db.payments, "floor_plan_template": db.floor_plan_templates}


def _check(user: dict, entity_type: str, write: bool):
    perms = ENTITY_PERMS if write else READ_PERMS
    if entity_type not in perms:
        raise ApiError(422, f"Unknown entity_type {entity_type}", "VALIDATION_ERROR")
    if perms[entity_type] not in user["permissions"]:
        raise ApiError(403, f"Missing permission: {perms[entity_type]}", "FORBIDDEN")


async def _check_parent(user: dict, entity_type: str, entity_id: str):
    """Tenant + project scope: the parent entity must belong to the user's company and (when project-bound) to their scope."""
    parent = await PARENT[entity_type].find_one({"id": entity_id, "company_id": user["company_id"]}, {"_id": 0, "id": 1, "project_id": 1})
    if not parent:
        raise ApiError(404, f"{entity_type.replace('_', ' ').title()} not found", "NOT_FOUND")
    pid = parent["id"] if entity_type == "project" else parent.get("project_id")
    if pid:
        ensure_project_access(user, pid)


@router.post("", status_code=201)
async def upload(request: Request, file: UploadFile = File(...), entity_type: str = Form(...), entity_id: str = Form(...),
                 document_type_id: str | None = Form(None), is_sensitive: bool = Form(False), user: dict = Depends(get_current_user)):
    _check(user, entity_type, True)
    await _check_parent(user, entity_type, entity_id)
    mime = (file.content_type or "").split(";")[0]
    if mime not in ALLOWED:
        raise ApiError(422, "Only PDF, JPG, PNG or WEBP files are allowed", "UNSUPPORTED_MEDIA")
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise ApiError(413, "File exceeds 15 MB", "PAYLOAD_TOO_LARGE")
    if not sniff(data, mime):
        raise ApiError(422, "File content does not match its type", "UNSUPPORTED_MEDIA")
    if not data:
        raise ApiError(422, "Empty file", "VALIDATION_ERROR")
    dt = None
    if document_type_id:
        dt = await db.document_types.find_one({"id": document_type_id}, {"_id": 0, "name": 1, "code": 1})
        if dt and dt["code"] in ("PAN", "AADHAAR"):
            is_sensitive = True
    path = f"{APP_NAME}/{entity_type}/{entity_id}/{uuid.uuid4()}.{ALLOWED[mime]}"
    try:
        result = await put_object(path, data, mime)
    except Exception as e:
        raise ApiError(502, f"Object storage upload failed: {e}", "STORAGE_ERROR")
    doc = {**base_doc(user, user["company_id"]), "entity_type": entity_type, "entity_id": entity_id, "document_type_id": document_type_id, "document_type_name": dt["name"] if dt else None,
           "file_name": file.filename, "mime": mime, "size": len(data), "storage_key": result["path"], "uploaded_by": user["id"], "uploaded_by_name": user["name"], "uploaded_at": now_iso(), "is_sensitive": is_sensitive}
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "document.upload", "document", doc["id"], after={k: doc[k] for k in ("id", "entity_type", "entity_id", "file_name", "size", "is_sensitive")}, ip=client_ip(request))
    await write_audit(user, "document.upload", entity_type, entity_id, after={"document_id": doc["id"], "file_name": doc["file_name"]}, ip=client_ip(request))
    return doc


@router.get("")
async def list_documents(entity_type: str = Query(...), entity_id: str = Query(...), user: dict = Depends(get_current_user)):
    _check(user, entity_type, False)
    await _check_parent(user, entity_type, entity_id)
    items = await db.documents.find({"entity_type": entity_type, "entity_id": entity_id, "is_active": True}, {"_id": 0}).sort("uploaded_at", -1).to_list(200)
    if "customer.kyc_view" not in user["permissions"]:
        for d in items:
            d["locked"] = d.get("is_sensitive", False)
    return {"items": items, "total": len(items)}


@router.get("/{doc_id}/download")
async def download(doc_id: str, request: Request, user: dict = Depends(get_current_user)):
    doc = await get_or_404(db.documents, doc_id, "Document", {"is_active": True, "company_id": user["company_id"]})
    _check(user, doc["entity_type"], False)
    await _check_parent(user, doc["entity_type"], doc["entity_id"])
    if doc.get("is_sensitive") and "customer.kyc_view" not in user["permissions"]:
        raise ApiError(403, "Sensitive document: customer.kyc_view required", "FORBIDDEN")
    try:
        data, ctype = await get_object(doc["storage_key"])
    except Exception as e:
        raise ApiError(502, f"Object storage read failed: {e}", "STORAGE_ERROR")
    if doc.get("is_sensitive"):
        await write_audit(user, "document.download", "document", doc_id, after={"file_name": doc["file_name"]}, ip=client_ip(request))
    disp = "inline" if doc["mime"].startswith("image/") or doc["mime"] == "application/pdf" else "attachment"
    return Response(content=data, media_type=doc["mime"] or ctype, headers={"Content-Disposition": f'{disp}; filename="{doc["file_name"]}"', "Cache-Control": "private, max-age=300"})


@router.delete("/{doc_id}")
async def soft_delete(doc_id: str, request: Request, user: dict = Depends(get_current_user)):
    doc = await get_or_404(db.documents, doc_id, "Document", {"is_active": True, "company_id": user["company_id"]})
    _check(user, doc["entity_type"], True)
    await _check_parent(user, doc["entity_type"], doc["entity_id"])
    await db.documents.update_one({"id": doc_id}, {"$set": {"is_active": False, "deleted_at": now_iso(), "deleted_by": user["id"]}})
    await write_audit(user, "document.delete", "document", doc_id, before={"file_name": doc["file_name"]}, ip=client_ip(request))
    return {"ok": True}
