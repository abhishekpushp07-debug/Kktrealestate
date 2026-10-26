"""Hardening proofs: idempotency replay, payments without key, 409 version conflict, Mongo validators reject bad docs, ledger anchor + invariants."""
import os
import sys
import uuid

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_idempotency_replay_customer_create(base_url, admin_headers):
    key = f"idem-{uuid.uuid4()}"
    body = {"full_name": "Idem Test", "phone": f"98{uuid.uuid4().int % 10**8:08d}", "salutation": "Mr"}
    h = {**admin_headers, "Idempotency-Key": key}
    r1 = requests.post(f"{base_url}/api/customers", json=body, headers=h)
    assert r1.status_code in (200, 201), r1.text
    r2 = requests.post(f"{base_url}/api/customers", json=body, headers=h)
    assert r2.status_code == r1.status_code and r2.json()["id"] == r1.json()["id"]
    assert r2.headers.get("Idempotent-Replayed") in ("true", "1", "True")
    assert _sync_db().customers.count_documents({"phone": {"$regex": body["phone"] + "$"}}) == 1
    requests.delete(f"{base_url}/api/customers/{r1.json()['id']}", headers=admin_headers)


def test_payment_without_idempotency_key_rejected(base_url, admin_headers, anchor_booking):
    r = requests.post(f"{base_url}/api/payments", json={"booking_id": anchor_booking["id"], "amount": 1, "payment_category": "Cash", "payment_date": "2026-01-01"}, headers=admin_headers)
    assert r.status_code == 428 and r.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED", r.text


def test_version_conflict_409(base_url, admin_headers, anchor_booking):
    c = requests.get(f"{base_url}/api/customers/{anchor_booking['customer_id']}", headers=admin_headers).json()
    r = requests.patch(f"{base_url}/api/customers/{c['id']}", json={"version": c["version"] + 50, "notes": "stale write"}, headers=admin_headers)
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "VERSION_CONFLICT" and r.json()["error"]["code"] == "VERSION_CONFLICT"


def test_405_uses_error_envelope(base_url, admin_headers):
    r = requests.patch(f"{base_url}/api/bookings/x", json={}, headers=admin_headers)
    assert r.status_code == 405 and r.json()["error"]["code"] and r.json()["code"]


def _sync_db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_mongo_validators_reject_bad_docs():
    from pymongo.errors import WriteError
    db = _sync_db()
    rejected = 0
    for coll, doc in [("payments", {"id": "x", "company_id": "c", "booking_id": "b", "receipt_number": "R", "amount_paise": 10.5, "status": "Cleared", "against": "FLAT_VALUE", "payment_date": "2026-01-01"}),
                          ("bookings", {"id": "x", "company_id": "c", "project_id": "p", "block_id": "b", "flat_id": "f", "customer_id": "c", "booking_number": "BK-X", "status": "Weird", "agreement_value_paise": 1, "cash_agreed_paise": 1, "account_agreed_paise": 0, "version": 1}),
                          ("flats", {"id": "x", "company_id": "c", "project_id": "p", "block_id": "b", "flat_number": "A1", "status": "Floating"})]:
        try:
            db[coll].insert_one(doc)
            db[coll].delete_one({"id": "x"})
        except WriteError as e:
            assert e.code == 121, e
            rejected += 1
    assert rejected == 3


def test_regression_anchor_bk_2526_0001(base_url, admin_headers, anchor_booking):
    b = requests.get(f"{base_url}/api/bookings/{anchor_booking['id']}", headers=admin_headers).json()
    assert b["summary"]["due"] == 0, b["summary"]
    led = requests.get(f"{base_url}/api/bookings/{anchor_booking['id']}/ledger", headers=admin_headers)
    rows = led.json()["rows"] if led.status_code == 200 and isinstance(led.json(), dict) else led.json()
    assert len(rows) == 22, len(rows)


def test_integrity_report_clean(base_url, admin_headers):
    import time
    for _ in range(6):  # other xdist worker may be mid-payment; ledger/summary converge within a request
        r = requests.get(f"{base_url}/api/admin/integrity-report?fresh=1", headers=admin_headers)
        if r.status_code == 200 and r.json()["ok"] is True:
            return
        time.sleep(5)
    assert r.status_code == 200 and r.json()["ok"] is True, r.json().get("counts")


def test_public_api_leak_scan(base_url):
    forbidden = {"password_hash", "token_hash", "storage_key", "_id", "encrypted", "aadhaar", "pan", "company_id", "created_by", "ip"}
    for path in ["/api/public/site", "/api/public/projects", "/api/portal/config"]:
        r = requests.get(base_url + path)
        assert r.status_code == 200, (path, r.status_code)
        def walk(o, trail=""):
            if isinstance(o, dict):
                for k, v in o.items():
                    assert k not in forbidden, (path, trail + "." + k)
                    walk(v, trail + "." + k)
            elif isinstance(o, list):
                for v in o[:50]:
                    walk(v, trail)
        walk(r.json())


def test_bypass_token_not_in_env_files():
    import glob
    for f in glob.glob(os.path.join(os.path.dirname(__file__), "..", ".env*")):
        assert "LOGIN_RATE_LIMIT_BYPASS_TOKEN" not in open(f).read(), f
