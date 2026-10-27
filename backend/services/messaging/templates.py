"""Message templates (Masters → Templates): code + channel-agnostic subject/body in en + hi, server-side placeholder rendering with escaping."""
import re
from html import escape
from urllib.parse import urlparse

from db import db
from utils import base_doc, now_iso

PLACEHOLDERS = ["customer_name", "booking_number", "flat", "project", "tower", "amount", "due_date", "days_overdue", "company", "rm_name", "rm_phone", "document_link"]
_PH = re.compile(r"{{\s*([a-z_]+)\s*}}")

SEEDED = {
    "reminder_day7": {"name": "Reminder — 7 days overdue", "en": ("Payment reminder · {{booking_number}} · {{flat}}", "Dear {{customer_name}},\n\nThis is a gentle reminder that ₹{{amount}} towards {{flat}}, {{tower}}, {{project}} (booking {{booking_number}}) was due on {{due_date}} and is now {{days_overdue}} days overdue.\n\nYour reminder letter: {{document_link}}\n\nIf you have already paid, please ignore this message. For help, contact {{rm_name}} ({{rm_phone}}).\n\nWarm regards,\n{{company}}"),
                      "hi": ("भुगतान अनुस्मारक · {{booking_number}} · {{flat}}", "प्रिय {{customer_name}},\n\nयह एक विनम्र स्मरण है कि {{flat}}, {{tower}}, {{project}} (बुकिंग {{booking_number}}) के लिए ₹{{amount}} की राशि {{due_date}} को देय थी और अब {{days_overdue}} दिन विलंबित है।\n\nआपका अनुस्मारक पत्र: {{document_link}}\n\nयदि आपने भुगतान कर दिया है तो कृपया इस संदेश को अनदेखा करें। सहायता हेतु {{rm_name}} ({{rm_phone}}) से संपर्क करें।\n\nसादर,\n{{company}}")},
    "reminder_day15": {"name": "Reminder — 15 days overdue", "en": ("Second reminder · {{booking_number}} · ₹{{amount}} overdue", "Dear {{customer_name}},\n\n₹{{amount}} for {{flat}}, {{tower}}, {{project}} (booking {{booking_number}}) remains unpaid {{days_overdue}} days after its due date {{due_date}}.\n\nReminder letter: {{document_link}}\n\nPlease arrange payment at the earliest to keep your schedule on track. Questions? {{rm_name}} · {{rm_phone}}.\n\nRegards,\n{{company}}"),
                       "hi": ("द्वितीय अनुस्मारक · {{booking_number}} · ₹{{amount}} बकाया", "प्रिय {{customer_name}},\n\n{{flat}}, {{tower}}, {{project}} (बुकिंग {{booking_number}}) के लिए ₹{{amount}} की राशि देय तिथि {{due_date}} के {{days_overdue}} दिन बाद भी बकाया है।\n\nअनुस्मारक पत्र: {{document_link}}\n\nकृपया शीघ्र भुगतान की व्यवस्था करें। प्रश्न? {{rm_name}} · {{rm_phone}}।\n\nसादर,\n{{company}}")},
    "reminder_day30": {"name": "Reminder — 30 days overdue", "en": ("Final reminder · {{booking_number}} · ₹{{amount}} overdue", "Dear {{customer_name}},\n\nDespite earlier reminders, ₹{{amount}} for {{flat}}, {{tower}}, {{project}} (booking {{booking_number}}), due {{due_date}}, is {{days_overdue}} days overdue.\n\nReminder letter: {{document_link}}\n\nPlease settle this within 7 days or speak to {{rm_name}} ({{rm_phone}}) about a payment arrangement.\n\nRegards,\n{{company}}"),
                       "hi": ("अंतिम अनुस्मारक · {{booking_number}} · ₹{{amount}} बकाया", "प्रिय {{customer_name}},\n\nपूर्व अनुस्मारकों के बावजूद {{flat}}, {{tower}}, {{project}} (बुकिंग {{booking_number}}) के लिए ₹{{amount}}, देय {{due_date}}, {{days_overdue}} दिन विलंबित है।\n\nअनुस्मारक पत्र: {{document_link}}\n\nकृपया 7 दिनों के भीतर भुगतान करें या {{rm_name}} ({{rm_phone}}) से बात करें।\n\nसादर,\n{{company}}")},
    "receipt_sent": {"name": "Receipt sent", "en": ("Receipt · {{booking_number}} · ₹{{amount}} received", "Dear {{customer_name}},\n\nThank you — we have received ₹{{amount}} towards {{flat}}, {{tower}}, {{project}} (booking {{booking_number}}).\n\nYour receipt: {{document_link}}\n\nRegards,\n{{company}}"),
                     "hi": ("रसीद · {{booking_number}} · ₹{{amount}} प्राप्त", "प्रिय {{customer_name}},\n\nधन्यवाद — {{flat}}, {{tower}}, {{project}} (बुकिंग {{booking_number}}) के लिए ₹{{amount}} प्राप्त हुए।\n\nआपकी रसीद: {{document_link}}\n\nसादर,\n{{company}}")},
    "demand_raised": {"name": "Demand raised", "en": ("Payment due · {{booking_number}} · ₹{{amount}} by {{due_date}}", "Dear {{customer_name}},\n\nAn instalment of ₹{{amount}} towards {{flat}}, {{tower}}, {{project}} (booking {{booking_number}}) is due by {{due_date}}.\n\nDemand letter: {{document_link}}\n\nRegards,\n{{company}}"),
                      "hi": ("भुगतान देय · {{booking_number}} · ₹{{amount}} {{due_date}} तक", "प्रिय {{customer_name}},\n\n{{flat}}, {{tower}}, {{project}} (बुकिंग {{booking_number}}) के लिए ₹{{amount}} की किस्त {{due_date}} तक देय है।\n\nमांग पत्र: {{document_link}}\n\nसादर,\n{{company}}")},
    "welcome_booking": {"name": "Welcome — booking confirmed", "en": ("Welcome to {{project}} · booking {{booking_number}}", "Dear {{customer_name}},\n\nWelcome to the {{company}} family. Your booking {{booking_number}} for {{flat}}, {{tower}}, {{project}} is confirmed.\n\nYour relationship manager {{rm_name}} ({{rm_phone}}) will guide you through the payment schedule.\n\nWarm regards,\n{{company}}"),
                        "hi": ("{{project}} में स्वागत है · बुकिंग {{booking_number}}", "प्रिय {{customer_name}},\n\n{{company}} परिवार में आपका स्वागत है। {{flat}}, {{tower}}, {{project}} के लिए आपकी बुकिंग {{booking_number}} की पुष्टि हो गई है।\n\nआपके संबंध प्रबंधक {{rm_name}} ({{rm_phone}}) भुगतान अनुसूची में आपका मार्गदर्शन करेंगे।\n\nसादर,\n{{company}}")},
}


async def ensure_seeded(company_id: str) -> int:
    n = 0
    for code, t in SEEDED.items():
        if not await db.message_templates.find_one({"company_id": company_id, "code": code}, {"_id": 0, "id": 1}):
            await db.message_templates.insert_one({**base_doc(None, company_id), "code": code, "name": t["name"], "seeded": True,
                                                   "en": {"subject": t["en"][0], "body": t["en"][1]}, "hi": {"subject": t["hi"][0], "body": t["hi"][1]}})
            n += 1
    return n


def render(text: str, ctx: dict) -> str:
    return _PH.sub(lambda m: str(ctx.get(m.group(1), "")), text or "")


def unknown_placeholders(text: str) -> list[str]:
    return sorted({m for m in _PH.findall(text or "") if m not in PLACEHOLDERS})


def to_html(body_text: str, company: str) -> str:
    """Plain template → safe inline-CSS HTML (links become anchors whose text is the host, so the G3 anchor rule holds)."""
    paras = []
    for para in escape(body_text).split("\n\n"):
        para = re.sub(r"(https://[^\s<]+)", lambda m: f'<a href="{m.group(1)}" style="color:#8a6d12">Open on {urlparse(m.group(1)).hostname}</a>', para).replace("\n", "<br>")
        paras.append(f'<p style="margin:0 0 12px">{para}</p>')
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a">{"".join(paras)}'
            f'<p style="font-size:12px;color:#888;margin-top:20px">Sent by {escape(company)}. We never ask for your password, OTP or card details by email.</p></td></tr></table>')


async def get_template(company_id: str, code: str) -> dict | None:
    await ensure_seeded(company_id)
    return await db.message_templates.find_one({"company_id": company_id, "code": code, "is_active": {"$ne": False}}, {"_id": 0})


def touch(doc: dict) -> dict:
    doc["updated_at"] = now_iso()
    return doc
