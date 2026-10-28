"""Phase Q: messaging API — channels, message log, templates (Masters → Templates), reminder settings, send-now, Resend webhook, reminder log report."""
import base64
import hashlib
import hmac
import os
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, get_current_user, project_scope_filter, require, require_any
from services.messaging import outbox, reminders, templates
from utils import ApiError, StrictModel, base_doc, client_ip, now_iso, write_audit

router = APIRouter(prefix="/messaging", tags=["messaging"])


@router.get("/channels")
async def channels(user: dict = Depends(require("messaging.message.view"))):
    """Each channel is either really configured or says so — the UI renders 'Connect provider' with the fields it needs."""
    return {"channels": await outbox.channel_status(), "statuses": list(__import__("services.messaging.adapters", fromlist=["STATUSES"]).STATUSES)}


@router.get("/messages")
async def list_messages(status: str | None = None, channel: str | None = None, customer_id: str | None = None, booking_id: str | None = None, template_code: str | None = None, date_from: str | None = None, date_to: str | None = None,
                        limit: int = 100, user: dict = Depends(require("messaging.message.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user)}
    q.pop("project_id", None) if "project_id" in q and q["project_id"] == {"$in": ["*"]} else None
    for k, v in (("status", status), ("channel", channel), ("customer_id", customer_id), ("booking_id", booking_id), ("template_code", template_code)):
        if v:
            q[k] = v
    if date_from or date_to:
        q["created_at"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to + "T23:59:59" if date_to else "~"} if date_to else {})}
    rows = await db.messages.find(q, {"_id": 0, "body_html": 0}).sort("created_at", -1).limit(min(limit, 500)).to_list(None)
    agg = await db.messages.aggregate([{"$match": {"company_id": user["company_id"]}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
    return {"items": rows, "kpis": {a["_id"]: a["n"] for a in agg}}


@router.get("/messages/{message_id}")
async def get_message(message_id: str, user: dict = Depends(require("messaging.message.view"))):
    m = await db.messages.find_one({"id": message_id, "company_id": user["company_id"]}, {"_id": 0})
    if not m:
        raise ApiError(404, "Message not found", "NOT_FOUND")
    return m


@router.post("/messages/{message_id}/retry")
async def retry(message_id: str, request: Request, user: dict = Depends(require("messaging.message.send"))):
    m = await db.messages.find_one({"id": message_id, "company_id": user["company_id"]}, {"_id": 0})
    if not m or m["status"] not in ("failed", "queued"):
        raise ApiError(409, "Only failed/queued messages can be retried", "STATE_FINAL")
    out = await outbox.send_now({**m, "attempts": 0})
    await write_audit(user, "message.retry", "message", message_id, after={"status": out["status"], "error": out.get("error")}, ip=client_ip(request))
    return out


class SendNowIn(StrictModel):
    booking_id: str
    threshold: int | None = Field(default=None, description="7 | 15 | 30 or null = pick by days overdue")


@router.post("/reminders/send-now")
async def send_now(body: SendNowIn, request: Request, user: dict = Depends(require("messaging.message.send"))):
    """Manual 'Send reminder now' — same path as the nightly job; the response is the real provider answer."""
    b = await db.bookings.find_one({"id": body.booking_id, "company_id": user["company_id"]}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    ensure_project_access(user, b["project_id"])
    if b["status"] != "Active":
        raise ApiError(422, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    res = await reminders.send_reminder(b, threshold=body.threshold, actor=user, as_of=now_iso()[:10], request_id=request.headers.get("x-request-id"), sync=True)
    if res["status"] == "no_overdue":
        raise ApiError(422, "No overdue demand on this booking", "NO_OVERDUE")
    return res


@router.post("/reminders/run")
async def run_now(request: Request, as_of: str | None = None, force_window: bool = True, user: dict = Depends(require("messaging.message.configure"))):
    res = await reminders.run_overdue_reminders(as_of, force_window=force_window)
    await write_audit(user, "reminders.run", "company", user["company_id"], after={"as_of": res["as_of"], "runs": len(res["runs"])}, ip=client_ip(request))
    return res


class ReminderSettingsIn(StrictModel):
    enabled: bool = True
    thresholds: list[int] = Field(default=[7, 15, 30], min_length=1, max_length=6)
    escalate_days: int = Field(default=45, ge=1, le=365)
    window_from: str = Field(default="10:00", pattern=r"^\d{2}:\d{2}$")
    window_to: str = Field(default="18:00", pattern=r"^\d{2}:\d{2}$")
    channel_order: list[Literal["email", "whatsapp", "sms"]] = ["email", "whatsapp", "sms"]
    cc_rm: bool = True


@router.get("/reminders/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    co = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "reminders": 1}) or {}
    return {**reminders.settings_for(co), "in_window_now": reminders.in_window(reminders.settings_for(co)), "configured_channels": outbox.configured_channels()}


@router.patch("/reminders/settings")
async def set_settings(body: ReminderSettingsIn, request: Request, user: dict = Depends(require_any("messaging.message.configure", "masters.company.edit"))):
    if sorted(body.thresholds) != body.thresholds or len(set(body.thresholds)) != len(body.thresholds):
        raise ApiError(422, "Thresholds must be strictly increasing", "VALIDATION_ERROR")
    if body.window_from >= body.window_to:
        raise ApiError(422, "Send window must start before it ends", "VALIDATION_ERROR")
    before = (await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "reminders": 1}) or {}).get("reminders")
    await db.companies.update_one({"id": user["company_id"]}, {"$set": {"reminders": body.model_dump(), "updated_at": now_iso()}})
    await write_audit(user, "company.reminders_updated", "company", user["company_id"], before=before, after=body.model_dump(), ip=client_ip(request))
    return await get_settings(user)


class TemplateIn(StrictModel):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=2, max_length=80)
    en: dict = Field(description="{subject, body}")
    hi: dict | None = None
    version: int | None = None


def _check(t: dict):
    for lang in ("en", "hi"):
        v = t.get(lang) or {}
        for k in ("subject", "body"):
            bad = templates.unknown_placeholders(v.get(k, ""))
            if bad:
                raise ApiError(422, f"Unknown placeholder(s) in {lang}.{k}: {', '.join('{{' + b + '}}' for b in bad)}", "VALIDATION_ERROR")


@router.get("/templates")
async def list_templates(user: dict = Depends(require("masters.template.view"))):
    await templates.ensure_seeded(user["company_id"])
    return {"items": await db.message_templates.find({"company_id": user["company_id"], "is_active": {"$ne": False}}, {"_id": 0}).sort("code", 1).to_list(None), "placeholders": templates.PLACEHOLDERS}


@router.post("/templates", status_code=201)
async def create_template(body: TemplateIn, request: Request, user: dict = Depends(require("masters.template.edit"))):
    _check(body.model_dump())
    if await db.message_templates.find_one({"company_id": user["company_id"], "code": body.code}):
        raise ApiError(409, "A template with this code exists", "DUPLICATE")
    doc = {**base_doc(user, user["company_id"]), **body.model_dump(exclude={"version"})}
    await db.message_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "template.created", "message_template", doc["id"], after={"code": body.code, "name": body.name}, ip=client_ip(request))
    return doc


@router.patch("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateIn, request: Request, user: dict = Depends(require("masters.template.edit"))):
    t = await db.message_templates.find_one({"id": template_id, "company_id": user["company_id"]}, {"_id": 0})
    if not t:
        raise ApiError(404, "Template not found", "NOT_FOUND")
    if body.version is not None and body.version != t.get("version", 1):
        raise ApiError(409, "Template changed by someone else — reload", "VERSION_CONFLICT")
    _check(body.model_dump())
    upd = {"name": body.name, "en": body.en, "hi": body.hi, "updated_at": now_iso(), "version": t.get("version", 1) + 1}
    await db.message_templates.update_one({"id": template_id}, {"$set": upd})
    await write_audit(user, "template.updated", "message_template", template_id, before={"en": t.get("en"), "hi": t.get("hi")}, after={"en": body.en, "hi": body.hi}, ip=client_ip(request))
    return {**t, **upd}


@router.get("/templates/{code}/preview")
async def preview_template(code: str, booking_id: str, lang: str = "en", user: dict = Depends(require("masters.template.view"))):
    """Render against a real booking (no send)."""
    b = await db.bookings.find_one({"id": booking_id, "company_id": user["company_id"]}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    ensure_project_access(user, b["project_id"])
    t = await templates.get_template(user["company_id"], code)
    if not t:
        raise ApiError(404, "Template not found", "NOT_FOUND")
    c = await db.customers.find_one({"id": b["customer_id"]}, {"_id": 0}) or {}
    co = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0}) or {}
    d = await db.demands.find_one({"booking_id": b["id"], "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}}, {"_id": 0}, sort=[("due_date", 1)]) or {"total_demand_paise": 0, "paid_paise": 0, "due_date": now_iso()[:10]}
    days = max((date.today() - date.fromisoformat(d["due_date"])).days, 0)
    ctx = await reminders._ctx(b, c, co, d, days, (__import__("os").environ.get("ERP_PUBLIC_URL") or "") + "/api/docgen/shared/preview")
    v = t.get(lang if lang in ("en", "hi") else "en") or t["en"]
    return {"subject": templates.render(v["subject"], ctx), "body": templates.render(v["body"], ctx), "html": templates.to_html(templates.render(v["body"], ctx), ctx["company"]), "ctx": ctx}


@router.post("/webhooks/resend")
async def resend_webhook(request: Request):
    """Delivery events → delivered / bounced. Requires RESEND_WEBHOOK_SECRET (svix signature); without it the endpoint answers 409 NOT_CONFIGURED — nothing is faked."""
    secret = os.environ.get("RESEND_WEBHOOK_SECRET")
    if not secret:
        raise ApiError(409, "Delivery webhooks are not configured (RESEND_WEBHOOK_SECRET)", "NOT_CONFIGURED")
    raw = await request.body()
    sig = request.headers.get("svix-signature", "")
    ts, mid = request.headers.get("svix-timestamp", ""), request.headers.get("svix-id", "")
    key = secret.split("_", 1)[1] if secret.startswith("whsec_") else secret
    expect = base64.b64encode(hmac.new(base64.b64decode(key), f"{mid}.{ts}.{raw.decode()}".encode(), hashlib.sha256).digest()).decode()
    if not any(hmac.compare_digest(expect, s.split(",", 1)[-1]) for s in sig.split(" ") if s):
        raise ApiError(401, "Bad webhook signature", "LINK_INVALID")
    evt = await request.json()
    pid = ((evt.get("data") or {}).get("email_id")) or (evt.get("data") or {}).get("id")
    status = {"email.delivered": "delivered", "email.bounced": "failed", "email.complained": "failed"}.get(evt.get("type"))
    if pid and status:
        upd = {"status": status, "provider_event": evt.get("type"), "updated_at": now_iso()}
        if status == "delivered":
            upd["delivered_at"] = evt.get("created_at") or now_iso()
        else:
            upd["error"] = f"provider: {evt.get('type')}"
        await db.messages.update_one({"provider_message_id": pid}, {"$set": upd})
    return {"ok": True}


@router.get("/reminder-log")
async def reminder_log(date_from: str | None = None, date_to: str | None = None, project_id: str | None = None, user: dict = Depends(require("messaging.message.view"))):
    """Reports: sent / failed / skipped by reason, per project — ties out to the messages collection (same filter)."""
    q = {"company_id": user["company_id"], "template_code": {"$regex": "^reminder_"}, **({"project_id": project_id} if project_id else {})}
    if date_from or date_to:
        q["created_at"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to + "T23:59:59"} if date_to else {})}
    rows = await db.messages.aggregate([{"$match": q}, {"$group": {"_id": {"project": "$project_name", "status": "$status"}, "n": {"$sum": 1}, "amount_paise": {"$sum": {"$ifNull": ["$amount_paise", 0]}}}}, {"$sort": {"_id.project": 1, "_id.status": 1}}]).to_list(None)
    by_status = {}
    for r in rows:
        by_status[r["_id"]["status"]] = by_status.get(r["_id"]["status"], 0) + r["n"]
    return {"rows": [{"project": r["_id"]["project"] or "—", "status": r["_id"]["status"], "count": r["n"], "amount_paise": r["amount_paise"]} for r in rows], "by_status": by_status, "total": sum(by_status.values()), "tie_out_count": await db.messages.count_documents(q)}
