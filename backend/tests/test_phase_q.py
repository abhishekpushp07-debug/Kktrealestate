"""Phase Q: channel interface, consent/skip statuses, dedupe unique index, thresholds + send window, template rendering en/hi, VOID watermark determinism, trends tie-out,
send-now path (document register + message + timeline), reminder settings validation."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def test_channel_interface_and_not_configured():
    from services.messaging.adapters import CHANNELS, EmailResend, SmsAdapter, WhatsAppAdapter, assert_safe_email
    assert set(CHANNELS) == {"email", "whatsapp", "sms"}
    for a in (WhatsAppAdapter(), SmsAdapter()):
        assert a.configured() is False and a.needs
        assert asyncio.run(a.send({"to": "x"}))[0] == "not_configured"
    assert EmailResend().configured() is True
    with pytest.raises(ValueError):
        assert_safe_email("x", '<form><input></form>')
    with pytest.raises(ValueError):
        assert_safe_email("x", '<a href="http://bit.ly/x">x</a>')
    assert_safe_email("ok", '<p><a href="https://kkt.example.com/a">Open on kkt.example.com</a></p>') is None


def test_pick_channel_consent_and_contact():
    from services.messaging.outbox import pick_channel
    assert pick_channel({"email": "a@b.co", "phone": "+91"}) == ("email", None)
    assert pick_channel({"email": "a@b.co", "consent": {"email": False}})[1] == "skipped_no_consent"
    assert pick_channel({"phone": "+91"})[1] in ("skipped_no_contact", "not_configured")  # whatsapp/sms not configured, no email
    assert pick_channel({})[1] == "skipped_no_contact"
    assert pick_channel({"email": "a@b.co", "preferred_channel": "whatsapp", "phone": "+91", "consent": {"whatsapp": True}}) == ("email", None)  # falls back to next configured


def test_template_render_en_hi_and_unknown_placeholder():
    from services.messaging.templates import SEEDED, render, to_html, unknown_placeholders
    ctx = {"customer_name": "Ravi", "amount": "1,00,000", "booking_number": "BK-1", "flat": "A-101", "tower": "A", "project": "P", "due_date": "01 Jan 2026", "days_overdue": 7, "company": "KKT", "rm_name": "RM", "rm_phone": "9", "document_link": "https://x.example.com/d"}
    for code, t in SEEDED.items():
        for lang in ("en", "hi"):
            out = render(t[lang][1], ctx)
            assert "{{" not in out and ("Ravi" in out)
    assert "विनम्र" in render(SEEDED["reminder_day7"]["hi"][1], ctx)
    assert unknown_placeholders("hi {{foo}} {{customer_name}}") == ["foo"]
    html = to_html("line\n\nsee https://x.example.com/d <b>", "KKT")
    assert "<form" not in html and "&lt;b&gt;" in html and 'href="https://x.example.com/d"' in html


def test_send_window_and_thresholds():
    from services.messaging.reminders import DEFAULTS, IST, in_window, settings_for
    cfg = settings_for({})
    assert cfg["thresholds"] == [7, 15, 30] and cfg["escalate_days"] == 45
    assert in_window(cfg, datetime(2026, 1, 1, 12, 0, tzinfo=IST)) and not in_window(cfg, datetime(2026, 1, 1, 9, 59, tzinfo=IST))
    assert in_window(settings_for({"reminders": {"window_from": "00:00", "window_to": "23:59"}}), datetime(2026, 1, 1, 3, 0, tzinfo=IST))
    assert settings_for({"reminders": {"thresholds": [5]}})["thresholds"] == [5] and DEFAULTS["enabled"]


def test_reminder_settings_api_validation(admin_headers):
    r = requests.patch(f"{BASE}/api/messaging/reminders/settings", json={"thresholds": [15, 7, 30]}, headers=admin_headers)
    assert r.status_code == 422
    r = requests.patch(f"{BASE}/api/messaging/reminders/settings", json={"window_from": "18:00", "window_to": "10:00"}, headers=admin_headers)
    assert r.status_code == 422
    r = requests.patch(f"{BASE}/api/messaging/reminders/settings", json={"thresholds": [7, 15, 30], "cc_rm": False}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["cc_rm"] is False
    requests.patch(f"{BASE}/api/messaging/reminders/settings", json={}, headers=admin_headers)


def test_send_now_registers_document_message_and_timeline(admin_headers):
    reg = requests.get(f"{BASE}/api/demands/register", params={"status": "Overdue", "basis": "due"}, headers=admin_headers).json()
    rows = [x for g in reg["groups"] for p in g["projects"] for t in p["towers"] for x in t["rows"]]
    assert rows
    bid = rows[0]["booking_id"]
    r = requests.post(f"{BASE}/api/messaging/reminders/send-now", json={"booking_id": bid}, headers=admin_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] in ("sent", "failed", "skipped_no_contact", "skipped_no_consent", "not_configured", "queued")  # a REAL provider answer, never faked
    m = d["message"]
    assert m["attachments"] == [d["document_id"]] and m["template_code"].startswith("reminder_day")
    doc = mongo.generated_documents.find_one({"id": d["document_id"]}, {"_id": 0})
    assert doc["type"] == "reminder" and doc["message_id"] == m["id"]
    reg2 = requests.get(f"{BASE}/api/docgen/register", params={"type": "reminder", "booking_id": bid}, headers=admin_headers).json()
    assert any(x["id"] == d["document_id"] for x in reg2["items"])
    b = mongo.bookings.find_one({"id": bid}, {"customer_id": 1})
    j = requests.get(f"{BASE}/api/journey/entity/customer/{b['customer_id']}", headers=admin_headers).json()["items"]
    assert any(i["action"] in ("reminder.sent", "reminder.skipped") for i in j)
    log = requests.get(f"{BASE}/api/messaging/reminder-log", headers=admin_headers).json()
    assert log["total"] == log["tie_out_count"] >= 1
    # cancelled booking → 422
    cb = mongo.bookings.find_one({"status": "Cancelled"}, {"id": 1})
    assert requests.post(f"{BASE}/api/messaging/reminders/send-now", json={"booking_id": cb["id"]}, headers=admin_headers).status_code == 422


def test_dedupe_unique_per_booking_threshold(admin_headers):
    from pymongo.errors import DuplicateKeyError
    bid = "test-booking-dedupe"
    mongo.reminders.delete_many({"booking_id": bid})
    mongo.reminders.create_index([("booking_id", 1), ("threshold", 1)], unique=True)
    mongo.reminders.insert_one({"booking_id": bid, "threshold": 7})
    with pytest.raises(DuplicateKeyError):
        mongo.reminders.insert_one({"booking_id": bid, "threshold": 7})
    mongo.reminders.insert_one({"booking_id": bid, "threshold": 15})
    mongo.reminders.delete_many({"booking_id": bid})


def test_nightly_job_runs_isolated_and_defers_outside_window(admin_headers):
    r = requests.post(f"{BASE}/api/messaging/reminders/run", params={"force_window": "false"}, headers=admin_headers)
    assert r.status_code == 200
    j = r.json()
    cfg = requests.get(f"{BASE}/api/messaging/reminders/settings", headers=admin_headers).json()
    if not cfg["in_window_now"]:
        assert j["deferred"] and j["companies"] == 0
    r = requests.post(f"{BASE}/api/messaging/reminders/run", params={"force_window": "true"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["companies"] >= 1
    runs = r.json()["runs"]
    assert all(x["job"] == "OVERDUE_REMINDERS" for x in runs)
    # second run: nothing new for the same thresholds (unique dedupe)
    r2 = requests.post(f"{BASE}/api/messaging/reminders/run", params={"force_window": "true"}, headers=admin_headers).json()
    assert sum(x["result"].get("messages", 0) for x in r2["runs"]) == 0


def test_void_watermark_deterministic(admin_headers):
    from services.pdf import watermark
    b = requests.get(f"{BASE}/api/bookings", params={"status": "Active", "page_size": 1}, headers=admin_headers).json()["items"][0]
    doc = requests.post(f"{BASE}/api/docgen/generate", json={"type": "statement", "booking_id": b["id"]}, headers=admin_headers).json()
    clean = requests.get(f"{BASE}/api/docgen/{doc['id']}/download", headers=admin_headers).content
    requests.post(f"{BASE}/api/docgen/{doc['id']}/void", json={"reason": "watermark test"}, headers=admin_headers)
    v1 = requests.get(f"{BASE}/api/docgen/{doc['id']}/download", headers=admin_headers).content
    v2 = requests.get(f"{BASE}/api/docgen/{doc['id']}/download", headers=admin_headers).content
    assert v1 == v2 and v1 != clean and len(v1) > len(clean)
    from pypdf import PdfReader
    import io
    txt = PdfReader(io.BytesIO(v1)).pages[0].extract_text()
    assert "VOID" in txt and "Voided on" in txt and "watermark test" in txt
    assert watermark(clean, "VOID", "x") == watermark(clean, "VOID", "x")


def test_trends_tie_out_with_collections_report(admin_headers):
    t = requests.get(f"{BASE}/api/trends", params={"scope": "company", "months": 12}, headers=admin_headers).json()
    assert len(t["months"]) == 12 and set(t) >= {"collections", "demands", "outstanding_eom", "bookings"}
    f, to = t["months"][0] + "-01", t["months"][-1] + "-31"
    rep = requests.get(f"{BASE}/api/reports/collections", params={"date_from": f, "date_to": to, "group_by": "month"}, headers=admin_headers).json()
    assert sum(t["collections"]) == rep["totals"]["total_paise"]
    by = {r["period"]: r["total_paise"] for r in rep["rows"]}
    assert all(t["collections"][i] == by.get(m, 0) for i, m in enumerate(t["months"]))
    assert mongo.monthly_buckets.count_documents({"scope": "company"}) >= 12
    r = requests.get(f"{BASE}/api/trends", params={"scope": "project"}, headers=admin_headers)
    assert r.status_code == 422


def test_customer_consent_fields_roundtrip(admin_headers):
    c = requests.get(f"{BASE}/api/customers", params={"page_size": 1}, headers=admin_headers).json()["items"][0]
    full = requests.get(f"{BASE}/api/customers/{c['id']}", headers=admin_headers).json()
    r = requests.patch(f"{BASE}/api/customers/{c['id']}", json={"version": full["version"], "consent": {"email": False, "whatsapp": True}, "preferred_channel": "whatsapp", "language": "hi"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    g = requests.get(f"{BASE}/api/customers/{c['id']}", headers=admin_headers).json()
    assert g["consent"]["email"] is False and g["language"] == "hi" and g["preferred_channel"] == "whatsapp"
