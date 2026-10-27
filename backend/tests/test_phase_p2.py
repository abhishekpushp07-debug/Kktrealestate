"""Phase P tester follow-up: cancellation closes demands (register/KPIs/integrity), signed share links (expired → 410), void delta is the ledger's,
overdue tie-out register == Outstanding report, Customer 360 live-bookings rule, document void, report date_from/date_to parity."""
import hashlib
import hmac
import os
import sys
import time

import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def _rows(reg):
    return [x for g in reg["groups"] for p in g["projects"] for t in p["towers"] for x in t["rows"]]


def test_cancelled_booking_demands_are_closed_everywhere(admin_headers):
    bk = mongo.bookings.find_one({"status": "Cancelled"}, {"_id": 0, "id": 1, "booking_number": 1})
    assert bk, "story DB has cancelled bookings"
    reg = requests.get(f"{BASE}/api/demands/register", params={"customer": bk["booking_number"], "basis": "raised"}, headers=admin_headers).json()
    assert _rows(reg) == [], "no open rows for a cancelled booking by default"
    reg2 = requests.get(f"{BASE}/api/demands/register", params={"customer": bk["booking_number"], "basis": "raised", "include_void": "true"}, headers=admin_headers).json()
    for r in _rows(reg2):
        assert r["status"] in ("Cancelled", "Voided", "Paid") and r["balance_paise"] == 0
    # law enforced at creation
    r = requests.post(f"{BASE}/api/demands/manual", json={"booking_id": bk["id"], "name": "Late fee", "cash_amount": 10, "due_date": "2030-01-01"}, headers=admin_headers)
    assert r.status_code == 422 and r.json()["code"] == "BOOKING_NOT_ACTIVE"
    # integrity rule: no open demand on a non-live booking; and a planted one is a finding
    rep = requests.get(f"{BASE}/api/admin/integrity-report", params={"fresh": 1}, headers=admin_headers).json()
    assert rep["counts"].get("open_demand_on_inactive_booking", 0) == 0
    d = mongo.demands.find_one({"booking_id": bk["id"]}, {"_id": 0, "id": 1, "status": 1})
    if d:
        mongo.demands.update_one({"id": d["id"]}, {"$set": {"status": "Open"}})
        try:
            rep2 = requests.get(f"{BASE}/api/admin/integrity-report", params={"fresh": 1}, headers=admin_headers).json()
            assert rep2["counts"].get("open_demand_on_inactive_booking") == 1
        finally:
            mongo.demands.update_one({"id": d["id"]}, {"$set": {"status": d["status"]}})


def test_void_reports_real_ledger_delta_zero_when_ledger_never_held_it(admin_headers):
    bk = mongo.bookings.find_one({"status": "Cancelled"}, {"_id": 0, "id": 1})
    d = mongo.demands.find_one({"booking_id": bk["id"], "status": "Cancelled", "voided": {"$ne": True}, "paid_paise": {"$in": [0, None]}}, {"_id": 0, "id": 1})
    if not d:
        return
    v = requests.post(f"{BASE}/api/demands/{d['id']}/void", json={"reason": "tester: closed demand"}, headers=admin_headers)
    assert v.status_code == 200 and v.json()["udhar_delta_paise"] == 0 and v.json()["ledger_held_it"] is False


def test_register_overdue_equals_outstanding_report_overdue(admin_headers):
    k = requests.get(f"{BASE}/api/demands/kpis", headers=admin_headers).json()
    rep = requests.get(f"{BASE}/api/reports/outstanding", headers=admin_headers).json()
    report_overdue = rep["totals"]["overdue_paise"] if "totals" in rep else sum(r["overdue_paise"] for r in rep["rows"])
    assert k["overdue_paise"] == report_overdue, (k["overdue_paise"], report_overdue)


def test_share_link_signed_expired_and_tampered(admin_headers):
    b = requests.get(f"{BASE}/api/bookings", params={"status": "Active", "page_size": 1}, headers=admin_headers).json()["items"][0]
    doc = requests.post(f"{BASE}/api/docgen/generate", json={"type": "statement", "booking_id": b["id"]}, headers=admin_headers).json()
    sh = requests.post(f"{BASE}/api/docgen/{doc['id']}/share", headers=admin_headers).json()
    tok = sh["url"].rsplit("/", 1)[1]
    assert requests.get(f"{BASE}{sh['url']}").status_code == 200
    did, exp, nonce, sig = tok.split(".")
    secret = os.environ["JWT_SECRET"].encode()
    old = int(time.time()) - 5
    expired = f"{did}.{old}.{nonce}." + hmac.new(secret, f"{did}.{old}.{nonce}".encode(), hashlib.sha256).hexdigest()[:32]
    r = requests.get(f"{BASE}/api/docgen/shared/{expired}")
    assert r.status_code == 410 and r.json()["code"] == "LINK_EXPIRED"
    r = requests.get(f"{BASE}/api/docgen/shared/{did}.{exp}.{nonce}.{'f' * 32}")
    assert r.status_code == 401 and r.json()["code"] == "LINK_INVALID"
    # void document: audited, leaves KPIs, revokes links
    k0 = requests.get(f"{BASE}/api/docgen/register", headers=admin_headers).json()["kpis"]["total"]
    v = requests.post(f"{BASE}/api/docgen/{doc['id']}/void", json={"reason": "tester"}, headers=admin_headers)
    assert v.status_code == 200 and v.json()["voided"]
    assert requests.get(f"{BASE}/api/docgen/register", headers=admin_headers).json()["kpis"]["total"] == k0 - 1
    assert requests.get(f"{BASE}{sh['url']}").status_code == 401
    assert requests.post(f"{BASE}/api/docgen/{doc['id']}/void", json={"reason": "again"}, headers=admin_headers).status_code == 409
    assert mongo.audit_logs.count_documents({"action": "document.voided", "entity_id": doc["id"]}) == 1


def test_customer360_live_bookings_rule_and_portal_flag(admin_headers):
    bk = mongo.bookings.find_one({"status": "Cancelled"}, {"_id": 0, "customer_id": 1})
    p0 = requests.get(f"{BASE}/api/customers/{bk['customer_id']}/panels", headers=admin_headers).json()
    p1 = requests.get(f"{BASE}/api/customers/{bk['customer_id']}/panels", params={"include_cancelled": "true"}, headers=admin_headers).json()
    assert "portal_enabled" in p0 and p0["summary"]["cancelled"]["count"] >= 1
    assert p0["counts"]["bookings"] == len(p0["ledgers"]["ledgers"]) and p1["counts"]["bookings"] == len(p1["ledgers"]["ledgers"])
    assert p1["counts"]["bookings"] > p0["counts"]["bookings"]
    assert p0["summary"]["agreement_paise"] <= p1["summary"]["agreement_paise"]


def test_reports_accept_date_from_date_to(admin_headers):
    for path in ("/api/reports/collections", "/api/reports/outstanding", "/api/reports/demand-vs-collection"):
        r = requests.get(f"{BASE}{path}", params={"date_from": "2026-01-01", "date_to": "2026-12-31"}, headers=admin_headers)
        assert r.status_code == 200, (path, r.text[:200])
    spec = requests.get(f"{BASE}/api/openapi.json", headers=admin_headers).json()
    for path in ("/api/reports/collections", "/api/reports/outstanding", "/api/reports/demand-vs-collection"):
        names = {p["name"] for p in spec["paths"][path]["get"].get("parameters", [])}
        assert {"date_from", "date_to"} <= names, path
