"""Channel adapters. A channel either really sends or reports `not_configured` — nothing fake.
Email = Emergent-managed Resend proxy (RESEND_EMAIL_PLAYBOOK): managed sender address, `from_name` = our brand, reply-to = company email."""
import ipaddress
import logging
import os
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("kkt.messaging")
EMAIL_BASE_URL = "https://integrations.emergentagent.com"  # constant by design (playbook)
STATUSES = ("queued", "sent", "delivered", "failed", "skipped_no_contact", "skipped_no_consent", "not_configured")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "send us your password", "enter your password below",
             "confirm your card number", "your full card number", "seed phrase", "recovery phrase", "verify your card", "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def assert_safe_email(subject: str, html: str) -> None:
    """Guardrail gate (G2/G3) — called on every send path; never weakened."""
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


class Channel:
    code = ""
    label = ""
    needs: list[dict] = []  # config fields a provider needs (shown on the "Connect provider" card)

    def configured(self) -> bool:
        return False

    def describe(self) -> dict:
        return {"channel": self.code, "label": self.label, "configured": self.configured(), "needs": self.needs, "provider": getattr(self, "provider", None)}

    async def send(self, msg: dict) -> tuple[str, str | None, str | None]:
        """→ (status, provider_message_id, error)"""
        return "not_configured", None, f"{self.label} provider is not configured"


class EmailResend(Channel):
    code, label, provider = "email", "Email", "Emergent-managed Resend"
    needs = [{"key": "EMERGENT_EMAIL_KEY", "label": "Managed email key (provisioned by Emergent)"}, {"key": "EMAIL_FROM_NAME", "label": "Sender display name (your brand)"}]

    def configured(self) -> bool:
        return bool(os.environ.get("EMERGENT_EMAIL_KEY")) and bool(os.environ.get("EMAIL_FROM_NAME"))

    async def send(self, msg: dict) -> tuple[str, str | None, str | None]:
        if not self.configured():
            return "not_configured", None, "EMERGENT_EMAIL_KEY / EMAIL_FROM_NAME missing"
        assert_safe_email(msg.get("subject") or "", msg.get("body_html") or "")
        payload = {"to": [msg["to"]], "subject": msg.get("subject") or "", "html": msg.get("body_html") or "", "from_name": msg.get("from_name") or os.environ["EMAIL_FROM_NAME"]}
        if msg.get("reply_to"):
            payload["contact_email"] = msg["reply_to"]
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, json=payload)
            resp.raise_for_status()
            return "sent", (resp.json() or {}).get("id"), None
        except httpx.HTTPStatusError as e:
            try:
                j = e.response.json()
            except ValueError:
                j = {}
            code = j.get("code", "")
            if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
                logger.warning("Email paused: %s (%s): %s", code, e.response.status_code, j.get("message", ""))
                return "failed", None, f"{code}: {j.get('message', '')}"[:300]
            logger.error("Email send failed: %s %s", e.response.status_code, e.response.text[:200])
            return "failed", None, f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        except Exception as e:  # noqa: BLE001
            logger.error("Email send error: %s", e)
            return "failed", None, str(e)[:300]


class WhatsAppAdapter(Channel):
    code, label, provider = "whatsapp", "WhatsApp", None
    needs = [{"key": "WHATSAPP_PROVIDER", "label": "Provider (twilio | meta_cloud)"}, {"key": "TWILIO_ACCOUNT_SID", "label": "Twilio Account SID"}, {"key": "TWILIO_AUTH_TOKEN", "label": "Twilio Auth Token"},
             {"key": "TWILIO_WHATSAPP_FROM", "label": "Twilio WhatsApp sender (whatsapp:+91…)"}, {"key": "META_WA_PHONE_NUMBER_ID", "label": "Meta Cloud API phone-number id"}, {"key": "META_WA_ACCESS_TOKEN", "label": "Meta Cloud API access token"},
             {"key": "META_WA_TEMPLATE_NAMESPACE", "label": "Approved template namespace"}]


class SmsAdapter(Channel):
    code, label, provider = "sms", "SMS", None
    needs = [{"key": "SMS_PROVIDER", "label": "Provider (twilio | msg91)"}, {"key": "TWILIO_ACCOUNT_SID", "label": "Twilio Account SID"}, {"key": "TWILIO_AUTH_TOKEN", "label": "Twilio Auth Token"},
             {"key": "TWILIO_SMS_FROM", "label": "Twilio sender number"}, {"key": "SMS_DLT_ENTITY_ID", "label": "DLT entity id (India)"}, {"key": "SMS_DLT_TEMPLATE_ID", "label": "DLT template id"}]


CHANNELS: dict[str, Channel] = {c.code: c for c in (EmailResend(), WhatsAppAdapter(), SmsAdapter())}


def configured_channels() -> list[str]:
    return [c for c, a in CHANNELS.items() if a.configured()]
