"""OVERDUE_REMINDERS: nightly, per-booking isolation, thresholds 7/15/30 fire once per (booking, threshold) — unique index; 45 → RM escalation.
Document first (Reminder letter via docgen, registered), then the Message through the customer's preferred configured channel."""
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone

from db import db
from services import job_runs
from services.messaging import outbox, templates
from services.money import inr
from services.pdf import fmt_date
from utils import base_doc, now_iso, write_audit

logger = logging.getLogger("kkt.reminders")
IST = timezone(timedelta(hours=5, minutes=30))
DEFAULTS = {"enabled": True, "thresholds": [7, 15, 30], "escalate_days": 45, "window_from": "10:00", "window_to": "18:00", "channel_order": ["email", "whatsapp", "sms"], "cc_rm": True}
SYSTEM = {"id": "system", "name": "Reminder automation", "permissions": ["*"], "project_scope": ["*"]}


def settings_for(company: dict) -> dict:
    return {**DEFAULTS, **(company.get("reminders") or {})}


def in_window(cfg: dict, now: datetime | None = None) -> bool:
    t = (now or datetime.now(IST)).astimezone(IST).strftime("%H:%M")
    return cfg["window_from"] <= t <= cfg["window_to"]


async def _ctx(booking: dict, customer: dict, company: dict, demand: dict, days: int, link: str | None) -> dict:
    rm = await db.users.find_one({"id": booking.get("sales_user_id") or customer.get("assigned_sales_user_id")}, {"_id": 0, "name": 1, "phone": 1}) or {}
    fs = booking.get("flat_snapshot") or {}
    return {"customer_name": customer.get("full_name", ""), "booking_number": booking["booking_number"], "flat": fs.get("flat_number", ""), "project": booking.get("project_name", ""), "tower": booking.get("block_name", ""),
            "amount": inr(demand["total_demand_paise"] - (demand.get("paid_paise") or 0)).replace("₹", "").strip(), "due_date": fmt_date(demand["due_date"]), "days_overdue": days, "company": company.get("legal_name") or company.get("name", ""),
            "rm_name": rm.get("name", ""), "rm_phone": rm.get("phone", ""), "document_link": link or ""}


async def _reminder_document(booking: dict, actor: dict, threshold: int | None) -> tuple[dict, str]:
    """Reminder letter via the Documents module (deterministic, registered) + a 7-day signed https link for the message body."""
    from routers.docgen import GenerateIn, _sign, generate_internal
    doc = await generate_internal(GenerateIn(type="reminder", booking_id=booking["id"]), actor, extra={"reminder_threshold": threshold})
    exp = int(time.time()) + 7 * 24 * 3600
    nonce = "rem"
    token = f"{doc['id']}.{exp}.{nonce}.{_sign(doc['id'], exp, nonce)}"
    await db.doc_share_links.insert_one({"token": token, "doc_id": doc["id"], "company_id": booking["company_id"], "expires_at": exp, "created_by": actor["id"], "created_at": now_iso(), "params": doc["params"], "filename": doc["filename"], "purpose": "reminder"})
    base = os.environ.get("ERP_PUBLIC_URL") or ""
    return doc, f"{base}/api/docgen/shared/{token}"


async def send_reminder(booking: dict, *, threshold: int | None, actor: dict | None, as_of: str, request_id: str | None = None, sync: bool = False) -> dict:
    """The one path for nightly + 'Send reminder now'. Returns the Message (or a skipped Message) + document id."""
    is_system = actor is None
    actor = actor or {**SYSTEM, "company_id": booking["company_id"]}
    company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0}) or {}
    cfg = settings_for(company)
    customer = await db.customers.find_one({"id": booking["customer_id"]}, {"_id": 0}) or {"id": booking["customer_id"]}
    dems = await db.demands.find({"booking_id": booking["id"], "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": as_of}}, {"_id": 0}).sort("due_date", 1).to_list(None)
    if not dems:
        return {"status": "no_overdue", "message": None, "document_id": None}
    oldest = dems[0]
    days = (date.fromisoformat(as_of) - date.fromisoformat(oldest["due_date"])).days
    code = f"reminder_day{threshold}" if threshold in (7, 15, 30) else ("reminder_day30" if days >= 30 else "reminder_day15" if days >= 15 else "reminder_day7")
    tpl = await templates.get_template(booking["company_id"], code) or {}
    lang = customer.get("preferred_language") if customer.get("preferred_language") in ("en", "hi") else "en"
    channel, skip = outbox.pick_channel(customer, cfg["channel_order"])
    doc, link = await _reminder_document(booking, actor, threshold)
    ctx = await _ctx(booking, customer, company, oldest, days, link)
    t = tpl.get(lang) or tpl.get("en") or {"subject": "Payment reminder", "body": ""}
    subject, body = templates.render(t["subject"], ctx), templates.render(t["body"], ctx)
    html = templates.to_html(body, ctx["company"])
    meta = {"threshold": threshold, "days_overdue": days, "demand_id": oldest["id"], "demand_number": oldest["demand_number"], "amount_paise": oldest["total_demand_paise"] - (oldest.get("paid_paise") or 0), "document_id": doc["id"], "language": lang,
            "project_id": booking.get("project_id"), "project_name": booking.get("project_name"), "block_id": booking.get("block_id"), "booking_number": booking["booking_number"], "from_name": os.environ.get("EMAIL_FROM_NAME") or ctx["company"], "reply_to": company.get("letterhead_email") or company.get("email")}
    if cfg.get("cc_rm") and ctx["rm_name"]:
        meta["cc_rm_name"] = ctx["rm_name"]
    msg = await outbox.queue(booking["company_id"], customer=customer, template_code=code, channel=channel, subject=subject, body_text=body, body_html=html, booking_id=booking["id"], attachments=[doc["id"]],
                             actor=None if is_system else actor, request_id=request_id, as_of=as_of, status="queued" if channel else skip, error=None if channel else f"{skip.replace('_', ' ')} — channels tried: {', '.join(cfg['channel_order'])}", meta=meta)
    if channel and sync:
        msg = await outbox.send_now(msg)
    elif channel:
        msg = await outbox.attempt(msg)
    await db.generated_documents.update_one({"id": doc["id"]}, {"$set": {"message_id": msg["id"], "message_status": msg["status"]}})
    after = {"booking_number": booking["booking_number"], "threshold": threshold, "days_overdue": days, "channel": channel, "status": msg["status"], "message_id": msg["id"], "document_id": doc["id"], "to": msg.get("to")}
    await write_audit(None if is_system else actor, "reminder.sent" if msg["status"] in ("sent", "delivered") else "reminder.skipped", "customer", booking["customer_id"], after=after, company_id=booking["company_id"])
    await write_audit(None if is_system else actor, "reminder.sent" if msg["status"] in ("sent", "delivered") else "reminder.skipped", "booking", booking["id"], after=after, company_id=booking["company_id"])
    rm_id = booking.get("sales_user_id") or customer.get("assigned_sales_user_id")
    if rm_id:
        from routers.notifications import notify_users
        await notify_users(booking["company_id"], [rm_id], f"Reminder {msg['status'].replace('_', ' ')}", f"{booking['booking_number']} · {customer.get('full_name', '')} · {days} days overdue · {inr(meta['amount_paise'])}", "reminder", "booking", booking["id"], f"/customers/{booking['customer_id']}?tab=demands")
    return {"status": msg["status"], "message": msg, "document_id": doc["id"], "days_overdue": days}


async def _process_booking(b: dict, as_of: str, cfg: dict) -> dict:
    dems = await db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": as_of}}, {"_id": 0, "due_date": 1}).sort("due_date", 1).to_list(1)
    if not dems:
        return {"booking": b["booking_number"], "action": "none"}
    days = (date.fromisoformat(as_of) - date.fromisoformat(dems[0]["due_date"])).days
    crossed = [t for t in cfg["thresholds"] if days >= t]
    out = {"booking": b["booking_number"], "days": days, "sent": [], "escalated": False}
    for t in sorted(crossed):
        try:
            await db.reminders.insert_one({**base_doc(None, b["company_id"]), "booking_id": b["id"], "threshold": t, "as_of": as_of, "days_overdue": days})
        except Exception:  # duplicate key → already sent for this (booking, threshold)
            continue
        res = await send_reminder(b, threshold=t, actor=None, as_of=as_of)
        await db.reminders.update_one({"booking_id": b["id"], "threshold": t}, {"$set": {"message_id": (res.get("message") or {}).get("id"), "status": res["status"], "document_id": res.get("document_id")}})
        out["sent"].append({"threshold": t, "status": res["status"]})
    if days >= cfg["escalate_days"] and not b.get("reminder_escalated"):
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"reminder_escalated": True, "reminder_escalated_at": now_iso()}})
        from routers.notifications import notify_roles, notify_users
        txt = f"{b['booking_number']} · {b.get('customer_name', '')} · {days} days overdue after 3 reminders"
        if b.get("sales_user_id"):
            await notify_users(b["company_id"], [b["sales_user_id"]], "Escalation: overdue 45+ days", txt, "reminder.escalation", "booking", b["id"])
        await notify_roles(b["company_id"], ["Accounts", "Super Admin"], "Escalation: overdue 45+ days", txt, "reminder.escalation", "booking", b["id"])
        out["escalated"] = True
    return out


async def run_overdue_reminders(as_of: str | None = None, force_window: bool = False) -> dict:
    as_of = as_of or datetime.now(IST).date().isoformat()
    companies = await db.companies.find({}, {"_id": 0, "id": 1, "reminders": 1}).to_list(None)
    totals = {"as_of": as_of, "companies": 0, "deferred": [], "runs": []}
    for co in companies:
        cfg = settings_for(co)
        if not cfg["enabled"]:
            continue
        if not force_window and not in_window(cfg):
            totals["deferred"].append(co["id"])
            continue
        totals["companies"] += 1
        ids = await db.demands.distinct("booking_id", {"company_id": co["id"], "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": as_of}})
        bookings = db.bookings.find({"id": {"$in": ids}, "status": "Active"}, {"_id": 0})
        run = await job_runs.run_isolated("OVERDUE_REMINDERS", bookings, lambda b, _cfg=cfg: _process_booking(b, as_of, _cfg), result_fn=lambda acc: {"bookings": len(acc), "messages": sum(len(x.get("sent", [])) for x in acc), "escalated": sum(1 for x in acc if x.get("escalated"))})
        totals["runs"].append(run)
    return totals
