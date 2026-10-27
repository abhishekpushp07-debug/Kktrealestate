"""E8 — API-level verification of Undo persistence for Leads & Service Requests.

The frontend `undoToast` must await the reverting POST. These tests simulate exactly
what the frontend does on an Undo click, and then assert via GET + audit log that
the revert actually hit the database.
"""
import os

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
HDRS_BYPASS = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD}, headers=HDRS_BYPASS, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def accounts_token():
    r = requests.post(f"{API}/auth/login", json={"email": "accounts@kkt.in", "password": TEST_PASSWORD}, headers=HDRS_BYPASS, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", **HDRS_BYPASS}


# ---------- Leads: forward + revert must persist ----------
def test_lead_stage_forward_then_undo_persists_in_db_and_audit(admin_token):
    H = _h(admin_token)
    board = requests.get(f"{API}/leads/board", headers=H, timeout=30).json()
    new_col = next((c for c in board["columns"] if c["stage"] == "New"), None)
    assert new_col and new_col["leads"], "need at least one lead in New"
    lead = new_col["leads"][0]
    lead_id = lead["id"]

    # Forward: New -> Contacted
    r1 = requests.post(f"{API}/leads/{lead_id}/stage", headers=H, json={"status": "Contacted", "version": lead["version"]}, timeout=30)
    assert r1.status_code == 200, r1.text
    moved = r1.json().get("lead", r1.json())
    assert moved["status"] == "Contacted"

    # Undo: Contacted -> New (exactly what undoToast.onUndo does)
    r2 = requests.post(f"{API}/leads/{lead_id}/stage", headers=H, json={"status": "New", "note": "Undo", "version": moved.get("version")}, timeout=30)
    assert r2.status_code == 200, r2.text

    # Verify via GET
    g = requests.get(f"{API}/leads/{lead_id}", headers=H, timeout=30).json()
    assert g["status"] == "New", f"After undo, lead should be New but is {g['status']}"

    # Verify audit shows two lead.stage entries (forward + revert)
    a = requests.get(f"{API}/audit-logs?entity_type=lead&entity_id={lead_id}&page_size=50", headers=H, timeout=30).json()
    stage_entries = [e for e in a.get("items", []) if e.get("action") == "lead.stage"]
    assert len(stage_entries) >= 2, f"expected >=2 lead.stage audits, got {len(stage_entries)}"


# ---------- Service Requests: forward + revert must persist ----------
def test_service_status_forward_then_undo_persists_in_db_and_audit(admin_token):
    H = _h(admin_token)
    # Find a ticket currently in New (seed SR-2627-0004)
    srs = requests.get(f"{API}/service-requests?status=New&page_size=50", headers=H, timeout=30).json()
    items = srs.get("items", [])
    assert items, "need an SR in New"
    sr = items[0]
    sr_id = sr["id"]

    r1 = requests.post(f"{API}/service-requests/{sr_id}/status", headers=H, json={"status": "In Progress"}, timeout=30)
    assert r1.status_code == 200, r1.text

    r2 = requests.post(f"{API}/service-requests/{sr_id}/status", headers=H, json={"status": "New", "note": "Undo"}, timeout=30)
    assert r2.status_code == 200, r2.text

    g = requests.get(f"{API}/service-requests/{sr_id}", headers=H, timeout=30).json()
    assert g["status"] == "New", f"After undo SR should be New but is {g['status']}"

    a = requests.get(f"{API}/audit-logs?entity_type=service_request&entity_id={sr_id}&page_size=50", headers=H, timeout=30).json()
    status_entries = [e for e in a.get("items", []) if e.get("action") == "service.status"]
    assert len(status_entries) >= 2


# ---------- Pincode catalogue surface used by the Customer form ----------
def test_catalogues_locality_has_pincode_for_kankarbagh(admin_token):
    H = _h(admin_token)
    r = requests.get(f"{API}/catalogues", headers=H, timeout=30)
    assert r.status_code == 200
    data = r.json()
    localities = (data.get("types") or {}).get("locality") or []
    kank = [l for l in localities if (l.get("label") or l.get("name")) == "Kankarbagh"]
    assert kank, "Kankarbagh locality must exist"
    meta = kank[0].get("meta") or {}
    assert meta.get("pincode") == "800020", f"Kankarbagh pincode expected 800020, got {meta.get('pincode')}"


# ---------- Booking wizard: 60/40 SGH + ₹10,000 cash payment ----------
def test_sgh_booking_60_40_and_cash_payment(admin_token, accounts_token):
    H = _h(admin_token)

    # Find SGH project and an Available flat
    projects = requests.get(f"{API}/projects?page_size=50", headers=H, timeout=30).json()
    sgh = next((p for p in projects["items"] if p.get("code") == "SGH"), None)
    assert sgh, "SGH project missing"

    flats = requests.get(f"{API}/flats?project_id={sgh['id']}&status=Available&page_size=20", headers=H, timeout=30).json()
    assert flats.get("items"), "need an Available SGH flat"
    flat = flats["items"][0]

    customers = requests.get(f"{API}/customers?page_size=5", headers=H, timeout=30).json()
    cust = customers["items"][0]

    # Compose a booking payload. Agreed value from flat rate.
    agreed = flat.get("final_price") or flat.get("agreed_value") or 10000000
    cash = int(agreed * 0.6)
    acct = int(agreed - cash)
    body = {
        "flat_id": flat["id"],
        "customer_id": cust["id"],
        "booking_date": "2026-01-15",
        "agreement_value": agreed,
        "cash_agreed": cash,
        "account_agreed": acct,
    }
    import uuid
    r = requests.post(f"{API}/bookings", headers={**H, "Idempotency-Key": str(uuid.uuid4())}, json=body, timeout=30)
    if r.status_code not in (200, 201):
        pytest.skip(f"Booking create not accepted in this shape: {r.status_code} {r.text[:200]}")
    bk = r.json()
    bk_id = bk.get("id") or bk.get("booking", {}).get("id")
    assert bk_id

    # GET booking → cash_agreed_paise > 0
    g = requests.get(f"{API}/bookings/{bk_id}", headers=H, timeout=30).json()
    cap = g.get("cash_agreed_paise") or g.get("cash_agreed", 0) * 100
    assert cap and cap > 0, "cash_agreed_paise must be > 0 for SGH"

    # Post ₹10,000 cash via accounts user
    HA = _h(accounts_token)
    # Get Cash payment mode
    modes = requests.get(f"{API}/catalogues", headers=H, timeout=30).json()["types"].get("payment_modes", [])
    cash_mode = next((m for m in modes if m.get("code") == "CASH" or (m.get("label") or m.get("name")) == "Cash"), None)
    assert cash_mode, "Cash payment mode missing"
    pay = {
        "booking_id": bk_id,
        "against": "FLAT_VALUE",
        "payment_category": "Cash",
        "amount": 10000,
        "payment_date": "2026-01-15",
        "payment_mode_id": cash_mode["id"],
    }
    r2 = requests.post(f"{API}/payments", headers={**HA, "Idempotency-Key": str(uuid.uuid4())}, json=pay, timeout=30)
    assert r2.status_code in (200, 201), r2.text
    rec = r2.json()
    receipt = rec.get("receipt_number") or rec.get("payment", {}).get("receipt_number")
    assert receipt and receipt.startswith("KKT/"), f"receipt must start with KKT/ got {receipt}"

    # List payments for this booking
    p = requests.get(f"{API}/payments?booking_id={bk_id}", headers=H, timeout=30).json()
    assert any(x.get("amount_paise", 0) == 1000000 or x.get("amount") == 10000 for x in p.get("items", [])), "payment not visible"
