"""Phase P2 — Billing & Documents: deterministic PDF generation on top of the existing builders, a Document Register
(generated_documents), 15-minute signed share links, "mark as sent", and bulk merge (pypdf) with async export > 50 docs."""

import asyncio
import hmac
import io
import re
import secrets
import time
import zipfile

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from db import db
from deps import ensure_project_access, project_scope_filter, require
from services import clock
from services import pdf as _pdf
from services.documents import (  # noqa: F401
    TYPES,
    GenerateIn,
    _build,
    _ctx,
    _merge,
    _sign,
    _void_mark,
    auto_register,
    generate_internal,
)
from services.pdf_builders import build_demand_pdf, build_receipt_pdf
from storage import APP_NAME, put_object
from utils import (
    ApiError,
    StrictModel,
    base_doc,
    client_ip,
    now_iso,
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/docgen", tags=["documents"])
CHANNELS = ("hand", "post", "email", "whatsapp")


class BulkIn(StrictModel):
    demand_ids: list[str] = []
    payment_ids: list[str] = []
    mode: str = "merged"  # merged | zip


class SentIn(StrictModel):
    channel: str
    note: str | None = Field(default=None, max_length=300)


@router.get("/types")
async def types(user: dict = Depends(require("documents.document.view"))):
    return {"items": [{"code": k, "name": v} for k, v in TYPES.items()], "channels": list(CHANNELS)}


@router.get("/options")
async def options(
    project_id: str | None = None,
    block_id: str | None = None,
    q: str | None = None,
    user: dict = Depends(require("documents.document.view")),
):
    """Dependent dropdowns: projects → towers → bookings (search by customer / CUST / booking no)."""
    scope = {"company_id": user["company_id"], **project_scope_filter(user)}
    projects = (
        await db.projects.find(
            {"company_id": user["company_id"], "is_active": True, **project_scope_filter(user, "id")},
            {"_id": 0, "id": 1, "name": 1, "code": 1},
        )
        .sort("name", 1)
        .to_list(None)
    )
    towers = (
        await db.blocks.find(
            {**scope, "is_active": True, **({"project_id": project_id} if project_id else {})},
            {"_id": 0, "id": 1, "name": 1, "project_id": 1},
        )
        .sort("name", 1)
        .to_list(None)
        if project_id
        else []
    )
    bq = {**scope, **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    if q:
        rx = re.compile(re.escape(q), re.I)
        bq["$or"] = [{"customer_name": rx}, {"booking_number": rx}, {"flat_snapshot.flat_number": rx}]
    bookings = (
        await db.bookings.find(
            bq,
            {
                "_id": 0,
                "id": 1,
                "booking_number": 1,
                "customer_id": 1,
                "customer_name": 1,
                "status": 1,
                "flat_snapshot.flat_number": 1,
                "block_name": 1,
            },
        )
        .sort("booking_number", -1)
        .limit(50)
        .to_list(50)
        if (project_id or q)
        else []
    )
    return {"projects": projects, "towers": towers, "bookings": bookings}


@router.get("/booking/{booking_id}/pickers")
async def pickers(booking_id: str, user: dict = Depends(require("documents.document.view"))):
    b, c, co = await _ctx(booking_id, user)
    recs, dems, refunds = await asyncio.gather(
        db.payments.find(
            {"booking_id": booking_id},
            {"_id": 0, "id": 1, "receipt_number": 1, "payment_date": 1, "amount_paise": 1, "status": 1},
        )
        .sort("payment_date", -1)
        .to_list(200),
        db.demands.find(
            {"booking_id": booking_id, "voided": {"$ne": True}},
            {
                "_id": 0,
                "id": 1,
                "demand_number": 1,
                "demand_date": 1,
                "due_date": 1,
                "total_demand_paise": 1,
                "paid_paise": 1,
                "status": 1,
                "installment_name": 1,
            },
        )
        .sort("demand_date", -1)
        .to_list(200),
        db.refunds.find(
            {"booking_id": booking_id}, {"_id": 0, "id": 1, "refund_number": 1, "amount_paise": 1, "status": 1}
        ).to_list(20),
    )
    return {
        "receipts": recs,
        "demands": dems,
        "refunds": refunds,
        "customer": {"id": c.get("id"), "full_name": c.get("full_name"), "customer_code": c.get("customer_code")},
        "booking": {"id": b["id"], "booking_number": b["booking_number"], "status": b["status"]},
    }


@router.post("/generate")
async def generate(body: GenerateIn, request: Request, user: dict = Depends(require("documents.document.generate"))):
    if body.preview:
        await _ctx(body.booking_id, user)
        data, name, _, _ = await _build(body, user)
        return _pdf.pdf_response(data, name, False)
    return await generate_internal(body, user, ip=client_ip(request))


@router.get("/register")
async def register(
    project_id: str | None = None,
    block_id: str | None = None,
    type: str | None = None,
    customer_id: str | None = None,
    booking_id: str | None = None,
    sent: str | None = None,
    voided: str | None = None,
    q: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 100,
    format: str | None = None,
    user: dict = Depends(require("documents.document.view")),
):
    f = {"company_id": user["company_id"], **project_scope_filter(user)}
    for k, v in (
        ("project_id", project_id),
        ("block_id", block_id),
        ("type", type),
        ("customer_id", customer_id),
        ("booking_id", booking_id),
    ):
        if v:
            f[k] = v
    if voided == "yes":
        f["voided"] = True
    elif voided == "no":
        f["voided"] = {"$ne": True}
    if sent == "yes":
        f["sent"] = {"$ne": None}
    elif sent == "no":
        f["sent"] = None
    if date_from or date_to:
        f["generated_at"] = {
            **({"$gte": clock.day_start_utc(date_from)} if date_from else {}),
            **({"$lte": clock.day_end_utc(date_to)} if date_to else {}),
        }
    if q:
        rx = re.compile(re.escape(q), re.I)
        f["$or"] = [{"customer_name": rx}, {"number": rx}, {"booking_number": rx}, {"customer_code": rx}]
    items = (
        await db.generated_documents.find(f, {"_id": 0})
        .sort("generated_at", -1)
        .limit(max(1, min(limit, 500)))
        .to_list(None)
    )
    from services.documents import TYPES as _DOC_TYPES

    for d in items:  # stored label is a snapshot; show today's owner wording
        d["type_name"] = _DOC_TYPES.get(d.get("type"), d.get("type_name"))
    today = clock.today_iso()
    kp = await db.generated_documents.aggregate(
        [
            {"$match": {"company_id": user["company_id"], **project_scope_filter(user), "voided": {"$ne": True}}},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "today": {"$sum": {"$cond": [{"$gte": ["$generated_at", clock.day_start_utc(today)]}, 1, 0]}},
                    "month": {
                        "$sum": {"$cond": [{"$gte": ["$generated_at", clock.day_start_utc(today[:8] + "01")]}, 1, 0]}
                    },
                    "unsent": {"$sum": {"$cond": [{"$eq": ["$sent", None]}, 1, 0]}},
                }
            },
        ]
    ).to_list(1)
    kpis = {k: (kp[0][k] if kp else 0) for k in ("total", "today", "month", "unsent")}
    kpis["active_links"] = await db.doc_share_links.count_documents(
        {"company_id": user["company_id"], "expires_at": {"$gt": time.time()}}
    )
    if format == "csv":
        return Response(
            content=to_csv(
                [
                    {
                        "type": i["type_name"],
                        "number": i["number"],
                        "customer": i["customer_name"],
                        "booking": i["booking_number"],
                        "project": i["project_name"],
                        "tower": i["block_name"],
                        "generated_by": i["generated_by_name"],
                        "generated_at": i["generated_at"],
                        "sent_channel": (i.get("sent") or {}).get("channel"),
                        "sent_at": (i.get("sent") or {}).get("at"),
                    }
                    for i in items
                ]
            ),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="document-register.csv"'},
        )
    return {"items": items, "kpis": kpis, "types": TYPES}


async def _doc(doc_id: str, user: dict) -> dict:
    d = await db.generated_documents.find_one({"id": doc_id, "company_id": user["company_id"]}, {"_id": 0})
    if not d:
        raise ApiError(404, "Document not found", "NOT_FOUND")
    ensure_project_access(user, d["project_id"])
    return d


@router.get("/{doc_id}/download")
async def download(doc_id: str, download: int = 0, user: dict = Depends(require("documents.document.view"))):
    d = await _doc(doc_id, user)
    data, name, _, _ = await _build(
        GenerateIn(**d["params"]), user
    )  # deterministic rebuild — same builders, same bytes
    return _pdf.pdf_response(_void_mark(d, data), d["filename"] or name, bool(download))


@router.post("/{doc_id}/share")
async def share(doc_id: str, request: Request, user: dict = Depends(require("documents.document.share"))):
    d = await _doc(doc_id, user)
    if d.get("voided"):
        raise ApiError(409, "Document is voided", "DOCUMENT_VOIDED")
    exp = int(time.time()) + 15 * 60
    nonce = secrets.token_urlsafe(8)
    token = f"{doc_id}.{exp}.{nonce}.{_sign(doc_id, exp, nonce)}"
    await db.doc_share_links.insert_one(
        {
            "token": token,
            "doc_id": doc_id,
            "company_id": user["company_id"],
            "expires_at": exp,
            "created_by": user["id"],
            "created_at": now_iso(),
            "params": d["params"],
            "filename": d["filename"],
        }
    )
    await write_audit(
        user,
        "document.shared",
        "generated_document",
        doc_id,
        after={"number": d["number"], "expires_in_min": 15},
        ip=client_ip(request),
    )
    return {"url": f"/api/docgen/shared/{token}", "expires_at": exp, "expires_in_sec": 900}


@router.get("/shared/{token}")
async def shared(token: str):
    """Signed link: `{doc_id}.{exp}.{nonce}.{hmac}` — tampered → 401 LINK_INVALID, expired → 410 LINK_EXPIRED (checked in that order)."""
    parts = token.split(".")
    if (
        len(parts) != 4
        or not parts[1].isdigit()
        or not hmac.compare_digest(parts[3], _sign(parts[0], int(parts[1]), parts[2]))
    ):
        raise ApiError(401, "This link is not valid", "LINK_INVALID")
    if int(parts[1]) < time.time():
        raise ApiError(410, "This link has expired", "LINK_EXPIRED")
    link = await db.doc_share_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise ApiError(401, "This link is not valid", "LINK_INVALID")
    await db.doc_share_links.update_one({"token": token}, {"$inc": {"opens": 1}, "$set": {"last_opened_at": now_iso()}})
    sysuser = {
        "id": link["created_by"],
        "company_id": link["company_id"],
        "permissions": ["*"],
        "name": "share-link",
        "project_scope": ["*"],
    }
    data, name, _, _ = await _build(GenerateIn(**link["params"]), sysuser)
    _d = (
        await db.generated_documents.find_one(
            {"id": link["doc_id"]}, {"_id": 0, "voided": 1, "voided_at": 1, "voided_by_name": 1, "void_reason": 1}
        )
        or {}
    )
    data = _void_mark(_d, data)
    return _pdf.pdf_response(data, link["filename"] or name, True)


class VoidDocIn(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/{doc_id}/void")
async def void_document(
    doc_id: str, body: VoidDocIn, request: Request, user: dict = Depends(require("documents.document.generate"))
):
    """Audited void: the document stays in the register (flagged Voided, share links revoked) but leaves KPIs."""
    d = await _doc(doc_id, user)
    if d.get("voided"):
        raise ApiError(409, "Document is already voided", "ALREADY_VOIDED")
    v = {
        "voided": True,
        "voided_at": now_iso(),
        "voided_by": user["id"],
        "voided_by_name": user["name"],
        "void_reason": body.reason,
    }
    await db.generated_documents.update_one({"id": doc_id}, {"$set": v})
    await db.doc_share_links.delete_many({"doc_id": doc_id})
    await write_audit(
        user,
        "document.voided",
        "generated_document",
        doc_id,
        before={"number": d["number"], "voided": False},
        after={"number": d["number"], **v},
        ip=client_ip(request),
    )
    return {**d, **v}


@router.post("/{doc_id}/sent")
async def mark_sent(
    doc_id: str, body: SentIn, request: Request, user: dict = Depends(require("documents.document.generate"))
):
    if body.channel not in CHANNELS:
        raise ApiError(422, f"channel must be one of {', '.join(CHANNELS)}", "VALIDATION_ERROR")
    d = await _doc(doc_id, user)
    sent = {"channel": body.channel, "note": body.note, "at": now_iso(), "by": user["id"], "by_name": user["name"]}
    await db.generated_documents.update_one({"id": doc_id}, {"$set": {"sent": sent, "updated_at": now_iso()}})
    await write_audit(
        user,
        "document.sent",
        "generated_document",
        doc_id,
        before={"sent": d.get("sent")},
        after={"sent": sent, "number": d["number"]},
        ip=client_ip(request),
    )
    return {**d, "sent": sent}


@router.post("/bulk")
async def bulk(body: BulkIn, request: Request, user: dict = Depends(require("documents.document.bulk"))):
    """Merged PDF (page break per document) or ZIP of individual PDFs; > 50 documents → async export job."""
    ids = [("demand", i) for i in body.demand_ids] + [("receipt", i) for i in body.payment_ids]
    if not ids:
        raise ApiError(422, "Select at least one demand or receipt", "VALIDATION_ERROR")
    if len(ids) > 50:
        job = {
            **base_doc(user, user["company_id"]),
            "kind": "DOC_BULK",
            "status": "QUEUED",
            "count": len(ids),
            "mode": body.mode,
            "demand_ids": body.demand_ids,
            "payment_ids": body.payment_ids,
            "requested_by": user["id"],
        }
        await db.export_jobs.insert_one(job)
        asyncio.get_running_loop().create_task(_bulk_job(job["id"], body, user))
        return Response(
            status_code=202,
            content=__import__("json").dumps({"job_id": job["id"], "count": len(ids), "status": "QUEUED"}),
            media_type="application/json",
        )
    parts, names = await _bulk_parts(body, user, build_demand_pdf, build_receipt_pdf)
    for kind, i in ids:
        await write_audit(
            user,
            "document.generated",
            "generated_document",
            i,
            after={"type": kind, "bulk": True, "mode": body.mode},
            ip=client_ip(request),
        )
    await db.generated_documents.insert_one(
        {
            **base_doc(user, user["company_id"]),
            "type": "bulk",
            "type_name": "Bulk " + ("merged PDF" if body.mode == "merged" else "ZIP"),
            "number": f"{len(parts)} documents",
            "filename": "bulk.pdf" if body.mode == "merged" else "bulk.zip",
            "bytes": sum(len(p) for p in parts),
            "params": body.model_dump(),
            "booking_id": None,
            "booking_number": None,
            "customer_id": None,
            "customer_name": f"{len(parts)} customers",
            "project_id": None,
            "project_name": None,
            "block_id": None,
            "block_name": None,
            "generated_by": user["id"],
            "generated_by_name": user["name"],
            "generated_at": now_iso(),
            "sent": None,
            "items": names,
        }
    )
    if body.mode == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for n, p in zip(names, parts):
                z.writestr(n, p)
        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="documents.zip"'},
        )
    return _pdf.pdf_response(_merge(parts), "documents-merged.pdf", True)


async def _bulk_parts(body: BulkIn, user: dict, build_demand_pdf, build_receipt_pdf):
    parts, names = [], []
    for did in body.demand_ids:
        dm = await db.demands.find_one(
            {"id": did, "company_id": user["company_id"]}, {"_id": 0, "booking_id": 1, "project_id": 1}
        )
        if not dm:
            raise ApiError(404, f"Demand {did} not found", "NOT_FOUND")
        ensure_project_access(user, dm["project_id"])
        data, name = await build_demand_pdf(dm["booking_id"], did, user)
        parts.append(data)
        names.append(name)
    for pid in body.payment_ids:
        data, name = await build_receipt_pdf(pid, user)
        parts.append(data)
        names.append(name)
    return parts, names


async def _bulk_job(job_id: str, body: BulkIn, user: dict):
    try:
        await db.export_jobs.update_one({"id": job_id}, {"$set": {"status": "RUNNING", "started_at": now_iso()}})
        parts, names = await _bulk_parts(body, user, build_demand_pdf, build_receipt_pdf)
        data = _merge(parts)
        res = await put_object(f"{APP_NAME}/exports/{job_id}.pdf", data, "application/pdf")
        await db.export_jobs.update_one(
            {"id": job_id},
            {
                "$set": {
                    "status": "DONE",
                    "finished_at": now_iso(),
                    "storage_key": res["path"],
                    "bytes": len(data),
                    "file_name": "documents-merged.pdf",
                }
            },
        )
    except Exception as e:  # noqa: BLE001
        await db.export_jobs.update_one(
            {"id": job_id}, {"$set": {"status": "FAILED", "finished_at": now_iso(), "error": str(e)[:500]}}
        )
