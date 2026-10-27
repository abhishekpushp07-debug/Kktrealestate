"""Message outbox: queue() writes the Message; MESSAGE_SEND sends each one in isolation with ×3 backoff; send_now() is the same path, synchronous."""
import logging
from datetime import datetime, timedelta, timezone

from db import db
from services import job_runs
from services.messaging.adapters import CHANNELS, configured_channels
from utils import base_doc, now_iso, write_audit

logger = logging.getLogger("kkt.messaging")
BACKOFF_MIN = (1, 4, 16)
MAX_ATTEMPTS = 3


async def ensure_indexes():
    await db.messages.create_index([("company_id", 1), ("created_at", -1)])
    await db.messages.create_index([("customer_id", 1), ("created_at", -1)])
    await db.messages.create_index([("status", 1), ("next_attempt_at", 1)])
    await db.messages.create_index("provider_message_id", sparse=True)
    await db.reminders.create_index([("booking_id", 1), ("threshold", 1)], unique=True)
    await db.message_templates.create_index([("company_id", 1), ("code", 1)], unique=True)


def pick_channel(customer: dict, order: list[str] | None = None) -> tuple[str | None, str | None]:
    """Preferred channel first, then the owner's channel order; returns (channel, skip_status). Consent and contact are checked per channel."""
    consent = customer.get("consent") or {}
    contacts = {"email": customer.get("email"), "whatsapp": customer.get("whatsapp_phone") or customer.get("phone"), "sms": customer.get("phone")}
    order = [c for c in [customer.get("preferred_channel")] + list(order or ["email", "whatsapp", "sms"]) if c]
    seen, reasons = set(), []
    for ch in order:
        if ch in seen or ch not in CHANNELS:
            continue
        seen.add(ch)
        if not contacts.get(ch):
            reasons.append("skipped_no_contact")
            continue
        has_consent = consent.get(ch) if ch in consent else (ch == "email")
        if not has_consent:
            reasons.append("skipped_no_consent")
            continue
        if not CHANNELS[ch].configured():
            reasons.append("not_configured")
            continue
        return ch, None
    for r in ("skipped_no_consent", "skipped_no_contact", "not_configured"):
        if r in reasons:
            return None, r
    return None, "skipped_no_contact"


async def queue(company_id: str, *, customer: dict, template_code: str, channel: str | None, subject: str, body_text: str, body_html: str, booking_id: str | None = None,
                attachments: list[str] | None = None, actor: dict | None = None, request_id: str | None = None, as_of: str | None = None, status: str = "queued", error: str | None = None, meta: dict | None = None) -> dict:
    to = {"email": customer.get("email"), "whatsapp": customer.get("whatsapp_phone") or customer.get("phone"), "sms": customer.get("phone")}.get(channel or "", None)
    msg = {**base_doc(actor, company_id), "customer_id": customer["id"], "customer_name": customer.get("full_name"), "booking_id": booking_id, "template_code": template_code, "channel": channel, "to": to,
           "subject": subject, "body_text": body_text, "body_html": body_html, "attachments": attachments or [], "status": status, "provider_message_id": None, "error": error, "attempts": 0,
           "next_attempt_at": now_iso() if status == "queued" else None, "sent_at": None, "delivered_at": None, "request_id": request_id, "as_of": as_of or now_iso()[:10], "created_by_name": (actor or {}).get("name", "system"), **(meta or {})}
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    await write_audit(actor, "message.queued" if status == "queued" else f"message.{status}", "message", msg["id"], after={"channel": channel, "to": to, "template_code": template_code, "status": status, "customer_id": customer["id"]}, company_id=company_id)
    return msg


async def attempt(msg: dict) -> dict:
    """One delivery attempt; isolated — never raises."""
    ch = CHANNELS.get(msg.get("channel") or "")
    if not ch:
        status, pid, err = "failed", None, f"unknown channel {msg.get('channel')!r}"
    else:
        try:
            status, pid, err = await ch.send(msg)
        except Exception as e:  # noqa: BLE001 — guardrail gate or transport error
            status, pid, err = "failed", None, str(e)[:300]
    attempts = (msg.get("attempts") or 0) + 1
    upd = {"attempts": attempts, "last_attempt_at": now_iso(), "error": err, "provider_message_id": pid or msg.get("provider_message_id")}
    if status == "sent":
        upd.update({"status": "sent", "sent_at": now_iso(), "next_attempt_at": None})
    elif status == "not_configured":
        upd.update({"status": "not_configured", "next_attempt_at": None})
    elif attempts < MAX_ATTEMPTS and not (err or "").startswith(("insufficient_credits", "integration_disabled", "daily_limit_reached")) and "undeliverable" not in (err or ""):
        upd.update({"status": "queued", "next_attempt_at": (datetime.now(timezone.utc) + timedelta(minutes=BACKOFF_MIN[min(attempts, len(BACKOFF_MIN) - 1)])).isoformat()})
    else:
        upd.update({"status": "failed", "next_attempt_at": None})
    await db.messages.update_one({"id": msg["id"]}, {"$set": upd})
    out = {**msg, **upd}
    await write_audit(None, f"message.{out['status']}", "message", msg["id"], after={"channel": msg.get("channel"), "to": msg.get("to"), "attempts": attempts, "provider_message_id": upd["provider_message_id"], "error": err}, company_id=msg["company_id"])
    if out["status"] == "failed":
        try:
            from routers.notifications import notify_roles
            await notify_roles(msg["company_id"], ["Accounts", "Super Admin"], "Message failed", f"{msg.get('channel')} to {msg.get('to')} · {err}", "message.failed", "message", msg["id"])
        except Exception:  # noqa: BLE001
            logger.exception("notify failed-message")
    return out


async def send_now(msg: dict) -> dict:
    return await attempt(msg)


async def run_message_send() -> dict:
    """MESSAGE_SEND job: due queued messages, each isolated (job_runs)."""
    now = now_iso()
    due = await db.messages.find({"status": "queued", "next_attempt_at": {"$lte": now}}, {"_id": 0}).limit(200).to_list(None)
    async def _it():
        for m in due:
            yield m
    run = await job_runs.run_isolated("MESSAGE_SEND", _it(), attempt)
    return {"due": len(due), "run": run}


async def channel_status() -> list[dict]:
    return [a.describe() for a in CHANNELS.values()]


__all__ = ["queue", "attempt", "send_now", "run_message_send", "pick_channel", "channel_status", "configured_channels", "ensure_indexes"]
