"""Phase P2 — Billing & Documents: deterministic PDF generation on top of the existing builders, a Document Register
(generated_documents), 15-minute signed share links, "mark as sent", and bulk merge (pypdf) with async export > 50 docs."""
import asyncio
import hashlib
import hmac
import io
import os
import time
import zipfile

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field
from pypdf import PdfWriter

from db import db
from deps import ensure_project_access, project_scope_filter, require
from services import pdf as _pdf
from utils import ApiError, StrictModel, base_doc, client_ip, now_iso, write_audit

router = APIRouter(prefix="/docgen", tags=["documents"])
TYPES = {"receipt": "Payment receipt", "demand": "Demand letter / Bill", "statement": "Statement of account", "allotment": "Allotment letter", "reminder": "Reminder letter", "schedule": "Payment schedule letter", "cancellation": "Cancellation / Refund letter"}
CHANNELS = ("hand", "post", "email", "whatsapp")


class GenerateIn(StrictModel):
    type: str
    booking_id: str
    payment_id: str | None = None
    demand_ids: list[str] | None = None
    period_from: str | None = None
    period_to: str | None = None
    refund_id: str | None = None
    note: str | None = Field(default=None, max_length=300)
    preview: bool = False


class BulkIn(StrictModel):
    demand_ids: list[str] = []
    payment_ids: list[str] = []
    mode: str = "merged"  # merged | zip


class SentIn(StrictModel):
    channel: str
    note: str | None = Field(default=None, max_length=300)


def _addr(a):
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


async def _ctx(booking_id: str, user: dict):
    b = await db.bookings.find_one({"id": booking_id, "company_id": user["company_id"]}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    ensure_project_access(user, b["project_id"])
    c, co = await asyncio.gather(db.customers.find_one({"id": b["customer_id"]}, {"_id": 0}), db.companies.find_one({"id": user["company_id"]}, {"_id": 0}))
    return b, c or {}, co or {}


async def build_reminder_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, c, co = await _ctx(booking_id, user)
    today = now_iso()[:10]
    dems = await db.demands.find({"booking_id": booking_id, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today}}, {"_id": 0}).sort("due_date", 1).to_list(None)
    policy = (co.get("interest_policy") or {})
    d = _pdf.BrandedDoc("Payment Reminder", co, number=f"RM-{b['booking_number']}", date=today, subtitle=f"Booking {b['booking_number']}")
    fs = b.get("flat_snapshot") or {}
    d.p(f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}<br/>Phone: {c.get('phone') or '-'}")
    d.spacer(3)
    d.p(f"<b>Subject: Reminder — overdue payment(s) for Unit {fs.get('flat_number')}, {b.get('block_name')}, {b.get('project_name')}</b>")
    d.spacer(2)
    if not dems:
        d.p("Our records show no overdue demand on this booking as of today. Please treat this letter as informational.")
    else:
        d.p(f"Dear Sir/Madam,<br/><br/>Our records show the following demand(s) on Booking No. <b>{b['booking_number']}</b> remain unpaid beyond their due date. Kindly arrange payment at the earliest.")
        rows, tot = [], 0
        for x in dems:
            bal = x["total_demand_paise"] - (x.get("paid_paise") or 0)
            tot += bal
            days = (__import__("datetime").date.fromisoformat(today) - __import__("datetime").date.fromisoformat(x["due_date"])).days
            rows.append([x["demand_number"], x.get("installment_name") or x.get("milestone_name") or "-", _pdf.fmt_date(x["due_date"]), str(days), _pdf.inr(x["total_demand_paise"]), _pdf.inr(bal)])
        d.h2("Overdue demands")
        d.table(["Demand", "Installment", "Due on", "Days", "Demanded", "Balance"], rows, widths=[1.2, 1.6, 1, 0.6, 1.1, 1.1], align_right=[3, 4, 5], totals=["Total overdue", "", "", "", "", _pdf.inr(tot)])
        if policy.get("rate_percent_pa"):
            d.small(f"Interest on delayed payment as per Agreement for Sale: {policy['rate_percent_pa']}% p.a. from the due date until realisation.")
    d.signature(co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory")
    return await asyncio.to_thread(d.build), f"reminder-{b['booking_number'].replace('/', '-')}.pdf"


async def build_schedule_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    from services.dues_engine import schedule
    b, c, co = await _ctx(booking_id, user)
    block = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0}) or {}
    dems = await db.demands.find({"booking_id": booking_id}, {"_id": 0}).to_list(None)
    rows = schedule(b, block, dems)
    d = _pdf.BrandedDoc("Payment Schedule", co, number=b["booking_number"], date=now_iso()[:10], subtitle=(b.get("payment_plan_snapshot") or {}).get("name") or "Payment plan")
    d.kv([("Customer", c.get("full_name")), ("Unit", f"{b.get('project_name', '')} · {b.get('block_name', '')} · {(b.get('flat_snapshot') or {}).get('flat_number', '')}"), ("Agreement value", _pdf.inr(b.get("agreement_value_paise") or 0)), ("Plan", (b.get("payment_plan_snapshot") or {}).get("name"))])
    d.h2("Installments")
    d.table(["#", "Installment", "Trigger", "%", "Amount", "Expected", "Status"], [[str(r["seq"]), r["name"], r.get("trigger_label") or "-", f"{r['percent']}%", _pdf.inr(r.get("total_paise") or 0), _pdf.fmt_date(r["expected_date"]) if r.get("expected_date") else "-", r["status"]] for r in rows],
            widths=[0.4, 1.6, 1.6, 0.6, 1.2, 1, 1], align_right=[3, 4])
    d.signature(co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory")
    return await asyncio.to_thread(d.build), f"schedule-{b['booking_number'].replace('/', '-')}.pdf"


async def build_cancellation_pdf(booking_id: str, refund_id: str | None, user: dict) -> tuple[bytes, str]:
    b, c, co = await _ctx(booking_id, user)
    q = {"booking_id": booking_id, **({"id": refund_id} if refund_id else {})}
    r = await db.refunds.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    if not r:
        raise ApiError(404, "No refund record for this booking — process the cancellation first", "NOT_FOUND")
    d = _pdf.BrandedDoc("Cancellation & Refund", co, number=r.get("refund_number") or b["booking_number"], date=(r.get("created_at") or now_iso())[:10], subtitle=f"Booking {b['booking_number']}")
    d.p(f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}")
    d.spacer(2)
    d.p(f"This is to confirm that Booking No. <b>{b['booking_number']}</b> for Unit {(b.get('flat_snapshot') or {}).get('flat_number')} stands cancelled{(' on ' + _pdf.fmt_date(b['cancelled_at'][:10])) if b.get('cancelled_at') else ''}. The refund position is as under.")
    d.h2("Refund")
    d.totals([("Amount received", _pdf.inr(r.get("paid_total_paise") or 0)), ("Cancellation charges", _pdf.inr(r.get("deduction_paise") or 0)), ("Refund payable", _pdf.inr(r.get("amount_paise") or 0))])
    d.kv([("Status", r.get("status")), ("Mode", r.get("mode") or "-"), ("Reference", r.get("reference") or "-"), ("Reason", b.get("cancel_reason") or r.get("reason") or "-")])
    d.signature(co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory")
    return await asyncio.to_thread(d.build), f"cancellation-{b['booking_number'].replace('/', '-')}.pdf"


async def _build(body: GenerateIn, user: dict) -> tuple[bytes, str, str, str | None]:
    """→ (bytes, filename, number, entity_id)"""
    from routers.pdfs import build_demand_pdf, build_receipt_pdf
    from routers.reports import build_allotment_pdf, build_statement_pdf
    if body.type == "receipt":
        if not body.payment_id:
            raise ApiError(422, "Pick a receipt", "VALIDATION_ERROR")
        p = await db.payments.find_one({"id": body.payment_id, "booking_id": body.booking_id}, {"_id": 0, "receipt_number": 1})
        if not p:
            raise ApiError(404, "Receipt not found on this booking", "NOT_FOUND")
        data, name = await build_receipt_pdf(body.payment_id, user)
        return data, name, p["receipt_number"], body.payment_id
    if body.type == "demand":
        if not body.demand_ids:
            raise ApiError(422, "Pick at least one demand", "VALIDATION_ERROR")
        parts, nums = [], []
        for did in body.demand_ids:
            dm = await db.demands.find_one({"id": did, "booking_id": body.booking_id}, {"_id": 0, "demand_number": 1})
            if not dm:
                raise ApiError(404, "Demand not found on this booking", "NOT_FOUND")
            data, _ = await build_demand_pdf(body.booking_id, did, user)
            parts.append(data)
            nums.append(dm["demand_number"])
        return (parts[0] if len(parts) == 1 else _merge(parts)), f"demand-{nums[0].replace('/', '-')}{'-plus' if len(parts) > 1 else ''}.pdf", ", ".join(nums), body.demand_ids[0]
    if body.type == "statement":
        data, name = await build_statement_pdf(body.booking_id, user)
        return data, name, f"SOA · {body.period_from or 'start'} → {body.period_to or 'today'}", None
    if body.type == "allotment":
        data, name = await build_allotment_pdf(body.booking_id, user)
        return data, name, "Allotment", None
    if body.type == "reminder":
        data, name = await build_reminder_pdf(body.booking_id, user)
        return data, name, "Reminder", None
    if body.type == "schedule":
        data, name = await build_schedule_pdf(body.booking_id, user)
        return data, name, "Schedule", None
    if body.type == "cancellation":
        data, name = await build_cancellation_pdf(body.booking_id, body.refund_id, user)
        return data, name, "Cancellation", body.refund_id
    raise ApiError(422, f"Unknown document type {body.type}", "VALIDATION_ERROR")


def _merge(parts: list[bytes]) -> bytes:
    w = PdfWriter()
    for p in parts:
        w.append(io.BytesIO(p))
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


@router.get("/types")
async def types(user: dict = Depends(require("documents.document.view"))):
    return {"items": [{"code": k, "name": v} for k, v in TYPES.items()], "channels": list(CHANNELS)}


@router.get("/options")
async def options(project_id: str | None = None, block_id: str | None = None, q: str | None = None, user: dict = Depends(require("documents.document.view"))):
    """Dependent dropdowns: projects → towers → bookings (search by customer / CUST / booking no)."""
    scope = {"company_id": user["company_id"], **project_scope_filter(user)}
    projects = await db.projects.find({"company_id": user["company_id"], "is_active": True, **project_scope_filter(user, "id")}, {"_id": 0, "id": 1, "name": 1, "code": 1}).sort("name", 1).to_list(None)
    towers = await db.blocks.find({**scope, "is_active": True, **({"project_id": project_id} if project_id else {})}, {"_id": 0, "id": 1, "name": 1, "project_id": 1}).sort("name", 1).to_list(None) if project_id else []
    bq = {**scope, **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    if q:
        import re
        rx = re.compile(re.escape(q), re.I)
        bq["$or"] = [{"customer_name": rx}, {"booking_number": rx}, {"flat_snapshot.flat_number": rx}]
    bookings = await db.bookings.find(bq, {"_id": 0, "id": 1, "booking_number": 1, "customer_id": 1, "customer_name": 1, "status": 1, "flat_snapshot.flat_number": 1, "block_name": 1}).sort("booking_number", -1).limit(50).to_list(50) if (project_id or q) else []
    return {"projects": projects, "towers": towers, "bookings": bookings}


@router.get("/booking/{booking_id}/pickers")
async def pickers(booking_id: str, user: dict = Depends(require("documents.document.view"))):
    b, c, co = await _ctx(booking_id, user)
    recs, dems, refunds = await asyncio.gather(
        db.payments.find({"booking_id": booking_id}, {"_id": 0, "id": 1, "receipt_number": 1, "payment_date": 1, "amount_paise": 1, "status": 1}).sort("payment_date", -1).to_list(200),
        db.demands.find({"booking_id": booking_id, "voided": {"$ne": True}}, {"_id": 0, "id": 1, "demand_number": 1, "demand_date": 1, "due_date": 1, "total_demand_paise": 1, "paid_paise": 1, "status": 1, "installment_name": 1}).sort("demand_date", -1).to_list(200),
        db.refunds.find({"booking_id": booking_id}, {"_id": 0, "id": 1, "refund_number": 1, "amount_paise": 1, "status": 1}).to_list(20))
    return {"receipts": recs, "demands": dems, "refunds": refunds, "customer": {"id": c.get("id"), "full_name": c.get("full_name"), "customer_code": c.get("customer_code")}, "booking": {"id": b["id"], "booking_number": b["booking_number"], "status": b["status"]}}


@router.post("/generate")
async def generate(body: GenerateIn, request: Request, user: dict = Depends(require("documents.document.generate"))):
    b, c, co = await _ctx(body.booking_id, user)
    data, name, number, entity_id = await _build(body, user)
    if body.preview:
        return _pdf.pdf_response(data, name, False)
    doc = {**base_doc(user, user["company_id"]), "type": body.type, "type_name": TYPES[body.type], "number": number, "filename": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "pages": None,
           "booking_id": b["id"], "booking_number": b["booking_number"], "customer_id": b["customer_id"], "customer_name": c.get("full_name"), "customer_code": c.get("customer_code"), "project_id": b["project_id"], "project_name": b.get("project_name"), "block_id": b.get("block_id"), "block_name": b.get("block_name"),
           "params": {k: v for k, v in body.model_dump().items() if k not in ("preview",) and v not in (None, [], False)}, "generated_by": user["id"], "generated_by_name": user["name"], "generated_at": now_iso(), "sent": None, "note": body.note}
    await db.generated_documents.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "document.generated", "generated_document", doc["id"], after={"type": body.type, "number": number, "booking_number": b["booking_number"], "customer_name": c.get("full_name"), "bytes": len(data)}, ip=client_ip(request))
    await write_audit(user, "document.generated", "booking", b["id"], after={"type": body.type, "number": number, "document_id": doc["id"]}, ip=client_ip(request))
    return doc


@router.get("/register")
async def register(project_id: str | None = None, block_id: str | None = None, type: str | None = None, customer_id: str | None = None, booking_id: str | None = None, sent: str | None = None, q: str | None = None, date_from: str | None = None, date_to: str | None = None, limit: int = 100, format: str | None = None, user: dict = Depends(require("documents.document.view"))):
    f = {"company_id": user["company_id"], **project_scope_filter(user)}
    for k, v in (("project_id", project_id), ("block_id", block_id), ("type", type), ("customer_id", customer_id), ("booking_id", booking_id)):
        if v:
            f[k] = v
    if sent == "yes":
        f["sent"] = {"$ne": None}
    elif sent == "no":
        f["sent"] = None
    if date_from or date_to:
        f["generated_at"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to + "T23:59:59"} if date_to else {})}
    if q:
        import re
        rx = re.compile(re.escape(q), re.I)
        f["$or"] = [{"customer_name": rx}, {"number": rx}, {"booking_number": rx}, {"customer_code": rx}]
    items = await db.generated_documents.find(f, {"_id": 0}).sort("generated_at", -1).limit(max(1, min(limit, 500))).to_list(None)
    today = now_iso()[:10]
    kp = await db.generated_documents.aggregate([{"$match": {"company_id": user["company_id"], **project_scope_filter(user)}}, {"$group": {"_id": None, "total": {"$sum": 1}, "today": {"$sum": {"$cond": [{"$gte": ["$generated_at", today]}, 1, 0]}}, "month": {"$sum": {"$cond": [{"$gte": ["$generated_at", today[:7]]}, 1, 0]}}, "unsent": {"$sum": {"$cond": [{"$eq": ["$sent", None]}, 1, 0]}}}}]).to_list(1)
    kpis = {k: (kp[0][k] if kp else 0) for k in ("total", "today", "month", "unsent")}
    kpis["active_links"] = await db.doc_share_links.count_documents({"company_id": user["company_id"], "expires_at": {"$gt": time.time()}})
    if format == "csv":
        from utils import to_csv
        return Response(content=to_csv([{"type": i["type_name"], "number": i["number"], "customer": i["customer_name"], "booking": i["booking_number"], "project": i["project_name"], "tower": i["block_name"], "generated_by": i["generated_by_name"], "generated_at": i["generated_at"], "sent_channel": (i.get("sent") or {}).get("channel"), "sent_at": (i.get("sent") or {}).get("at")} for i in items]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="document-register.csv"'})
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
    data, name, _, _ = await _build(GenerateIn(**d["params"]), user)  # deterministic rebuild — same builders, same bytes
    return _pdf.pdf_response(data, d["filename"] or name, bool(download))


@router.post("/{doc_id}/share")
async def share(doc_id: str, request: Request, user: dict = Depends(require("documents.document.share"))):
    d = await _doc(doc_id, user)
    exp = time.time() + 15 * 60
    token = hmac.new(os.environ["JWT_SECRET"].encode(), f"{doc_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:40]
    await db.doc_share_links.insert_one({"token": token, "doc_id": doc_id, "company_id": user["company_id"], "expires_at": exp, "created_by": user["id"], "created_at": now_iso(), "params": d["params"], "filename": d["filename"]})
    await write_audit(user, "document.shared", "generated_document", doc_id, after={"number": d["number"], "expires_in_min": 15}, ip=client_ip(request))
    return {"url": f"/api/docgen/shared/{token}", "expires_at": exp, "expires_in_sec": 900}


@router.get("/shared/{token}")
async def shared(token: str):
    link = await db.doc_share_links.find_one({"token": token}, {"_id": 0})
    if not link or link["expires_at"] < time.time():
        raise ApiError(410, "This link has expired", "LINK_EXPIRED")
    sysuser = {"id": link["created_by"], "company_id": link["company_id"], "permissions": ["*"], "name": "share-link", "project_scope": ["*"]}
    data, name, _, _ = await _build(GenerateIn(**link["params"]), sysuser)
    return _pdf.pdf_response(data, link["filename"] or name, True)


@router.post("/{doc_id}/sent")
async def mark_sent(doc_id: str, body: SentIn, request: Request, user: dict = Depends(require("documents.document.generate"))):
    if body.channel not in CHANNELS:
        raise ApiError(422, f"channel must be one of {', '.join(CHANNELS)}", "VALIDATION_ERROR")
    d = await _doc(doc_id, user)
    sent = {"channel": body.channel, "note": body.note, "at": now_iso(), "by": user["id"], "by_name": user["name"]}
    await db.generated_documents.update_one({"id": doc_id}, {"$set": {"sent": sent, "updated_at": now_iso()}})
    await write_audit(user, "document.sent", "generated_document", doc_id, before={"sent": d.get("sent")}, after={"sent": sent, "number": d["number"]}, ip=client_ip(request))
    return {**d, "sent": sent}


@router.post("/bulk")
async def bulk(body: BulkIn, request: Request, user: dict = Depends(require("documents.document.bulk"))):
    """Merged PDF (page break per document) or ZIP of individual PDFs; > 50 documents → async export job."""
    from routers.pdfs import build_demand_pdf, build_receipt_pdf
    ids = [("demand", i) for i in body.demand_ids] + [("receipt", i) for i in body.payment_ids]
    if not ids:
        raise ApiError(422, "Select at least one demand or receipt", "VALIDATION_ERROR")
    if len(ids) > 50:
        job = {**base_doc(user, user["company_id"]), "kind": "DOC_BULK", "status": "QUEUED", "count": len(ids), "mode": body.mode, "demand_ids": body.demand_ids, "payment_ids": body.payment_ids, "requested_by": user["id"]}
        await db.export_jobs.insert_one(job)
        asyncio.get_running_loop().create_task(_bulk_job(job["id"], body, user))
        return Response(status_code=202, content=__import__("json").dumps({"job_id": job["id"], "count": len(ids), "status": "QUEUED"}), media_type="application/json")
    parts, names = await _bulk_parts(body, user, build_demand_pdf, build_receipt_pdf)
    for kind, i in ids:
        await write_audit(user, "document.generated", "generated_document", i, after={"type": kind, "bulk": True, "mode": body.mode}, ip=client_ip(request))
    await db.generated_documents.insert_one({**base_doc(user, user["company_id"]), "type": "bulk", "type_name": "Bulk " + ("merged PDF" if body.mode == "merged" else "ZIP"), "number": f"{len(parts)} documents", "filename": "bulk.pdf" if body.mode == "merged" else "bulk.zip", "bytes": sum(len(p) for p in parts), "params": body.model_dump(),
                                             "booking_id": None, "booking_number": None, "customer_id": None, "customer_name": f"{len(parts)} customers", "project_id": None, "project_name": None, "block_id": None, "block_name": None, "generated_by": user["id"], "generated_by_name": user["name"], "generated_at": now_iso(), "sent": None, "items": names})
    if body.mode == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for n, p in zip(names, parts):
                z.writestr(n, p)
        return Response(content=buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="documents.zip"'})
    return _pdf.pdf_response(_merge(parts), "documents-merged.pdf", True)


async def _bulk_parts(body: BulkIn, user: dict, build_demand_pdf, build_receipt_pdf):
    parts, names = [], []
    for did in body.demand_ids:
        dm = await db.demands.find_one({"id": did, "company_id": user["company_id"]}, {"_id": 0, "booking_id": 1, "project_id": 1})
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
    from routers.pdfs import build_demand_pdf, build_receipt_pdf
    from storage import APP_NAME, put_object
    try:
        await db.export_jobs.update_one({"id": job_id}, {"$set": {"status": "RUNNING", "started_at": now_iso()}})
        parts, names = await _bulk_parts(body, user, build_demand_pdf, build_receipt_pdf)
        data = _merge(parts)
        res = await put_object(f"{APP_NAME}/exports/{job_id}.pdf", data, "application/pdf")
        await db.export_jobs.update_one({"id": job_id}, {"$set": {"status": "DONE", "finished_at": now_iso(), "storage_key": res["path"], "bytes": len(data), "file_name": "documents-merged.pdf"}})
    except Exception as e:  # noqa: BLE001
        await db.export_jobs.update_one({"id": job_id}, {"$set": {"status": "FAILED", "finished_at": now_iso(), "error": str(e)[:500]}})
