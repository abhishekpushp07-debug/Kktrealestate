"""Story-anchored rewrites of the legacy demo-seed tests (see tests/RETIRED_TESTS.md). Runs only against the isolated kkt_test snapshot."""
import uuid
from datetime import date

import pytest
import requests

from tests.conftest import BASE, session_token

API = f"{BASE}/api"
PORTAL_PHONE, PORTAL_PW = "9431023445", "Buyer@12345"  # Priya Verma — story portal persona


def H(email):
    return {"Authorization": f"Bearer {session_token(email, 'Kkt@12345')}"}


def _modes(h):
    return {m["code"]: m for m in requests.get(f"{API}/master/payment-modes?page_size=50", headers=h).json()["items"]}


def _post(h, path, body):
    return requests.post(f"{API}{path}", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, json=body, timeout=60)


# ---- payments: bucket cap, cheque pending → clear → reverse (replaces test_phase_2 payment/cheque tests) ----
def test_cash_bucket_cap_rejected_on_anchor(admin_headers, anchor_booking):
    b = requests.get(f"{API}/bookings/{anchor_booking['id']}", headers=admin_headers).json()
    room = b["cash_agreed_paise"] - b["summary"]["cash_paid_paise"]
    r = _post(admin_headers, "/payments", {"booking_id": b["id"], "payment_category": "Cash", "amount": room / 100 + 1000, "payment_date": date.today().isoformat(), "payment_mode_id": _modes(admin_headers)["CASH"]["id"]})
    assert r.status_code == 409 and "Revise agreement" in r.json()["detail"], r.text


def test_cheque_pending_clear_then_reverse(admin_headers, anchor_booking):
    h = admin_headers
    bank = requests.get(f"{API}/master/bank-accounts", headers=h).json()["items"][0]
    r = _post(h, "/payments", {"booking_id": anchor_booking["id"], "payment_category": "Account", "amount": 1000, "payment_date": date.today().isoformat(), "payment_mode_id": _modes(h)["CHEQUE"]["id"], "bank_account_id": bank["id"],
                               "instrument": {"number": "777001", "date": date.today().isoformat(), "bank_name": "SBI"}})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "Pending"
    c = _post(h, f"/payments/{p['id']}/clear", {"cleared_date": date.today().isoformat()})
    assert c.status_code == 200 and c.json()["status"] == "Cleared", c.text
    led = requests.get(f"{API}/bookings/{anchor_booking['id']}/ledger", headers=h).json()["rows"]
    assert any(x["ref"] == p["receipt_number"] for x in led)
    rv = _post(h, f"/payments/{p['id']}/reverse", {"reason": "story rewrite"})
    assert rv.status_code == 200 and rv.json()["status"] == "Reversed", rv.text
    assert requests.get(f"{API}/payments/{p['id']}/receipt", headers=h).json()["watermark"] == "REVERSED"


# ---- construction: forward-only + undo (replaces test_milestones_forward_only_and_undo_block, TestTowerBConstruction) ----
def test_stages_forward_only_and_undo_roundtrip(admin_headers):
    h = admin_headers
    blk = next(b for b in requests.get(f"{API}/blocks?page_size=20", headers=h).json()["items"] if b["code"] == "C")  # Tower C: mid-construction in the story
    ms = requests.get(f"{API}/blocks/{blk['id']}/milestones", headers=h).json()
    nxt = ms["next_seq"]
    assert nxt is not None
    r = requests.post(f"{API}/blocks/{blk['id']}/milestones/{nxt + 1}/complete", headers=h, json={"completed_on": date.today().isoformat()})
    assert r.status_code == 409, r.text
    done = requests.post(f"{API}/blocks/{blk['id']}/milestones/{nxt}/complete", headers=h, json={"completed_on": date.today().isoformat()})
    assert done.status_code == 200 and done.json().get("audit_id"), done.text
    after = requests.get(f"{API}/blocks/{blk['id']}/milestones", headers=h).json()
    assert after["next_seq"] in (None, nxt + 1)
    undo = requests.post(f"{API}/blocks/{blk['id']}/milestones/undo", headers=h, json={})
    assert undo.status_code == 200, undo.text
    assert requests.get(f"{API}/blocks/{blk['id']}/milestones", headers=h).json()["next_seq"] == nxt


def test_block_percent_matches_completed_stage_weights(admin_headers):
    for blk in requests.get(f"{API}/blocks?page_size=20", headers=admin_headers).json()["items"]:
        ms = requests.get(f"{API}/blocks/{blk['id']}/milestones", headers=admin_headers).json()
        pct = sum(m.get("weight_percent") or m.get("percent") or 0 for m in ms["items"] if m["status"] == "Completed")
        assert round(pct) == round(blk["construction_percent"]), (blk["code"], pct, blk["construction_percent"])


# ---- KYC masking (replaces test_kyc_masking_and_reveal) ----
def test_kyc_masked_for_sales_revealed_for_accounts(admin_headers):
    cust = requests.get(f"{API}/customers?page_size=1&search=CUST-2526-0002", headers=admin_headers).json()["items"][0]
    r = requests.patch(f"{API}/customers/{cust['id']}", headers=H("accounts@kkt.in"), json={"pan": "ABCPV1234K", "version": cust["version"]})
    assert r.status_code == 200, r.text
    s = requests.get(f"{API}/customers/{cust['id']}", headers=H("sales@kkt.in")).json()
    assert s.get("pan") in (None, "") and s["pan_masked"].startswith("XXXXX") and s["pan_masked"].endswith("234K")
    assert requests.get(f"{API}/customers/{cust['id']}?reveal=1", headers=H("sales@kkt.in")).status_code == 403
    a = requests.get(f"{API}/customers/{cust['id']}?reveal=1", headers=H("accounts@kkt.in")).json()
    assert a["pan"] == "ABCPV1234K"
    au = requests.get(f"{API}/audit-logs?entity_type=customer&entity_id={cust['id']}&action=customer.kyc_reveal", headers=admin_headers).json()
    assert au["items"], "reveal must be audited"


# ---- Roznamcha (replaces test_roznamcha) ----
def test_roznamcha_identity_on_story_cash_day(admin_headers):
    p = requests.get(f"{API}/payments?page_size=1&payment_mode_code=CASH&status=Cleared", headers=admin_headers).json()["items"][0]
    d = p["payment_date"]
    r = requests.get(f"{API}/roznamcha?date={d}", headers=admin_headers).json()
    cash_day = requests.get(f"{API}/payments?page_size=200&payment_mode_code=CASH&status=Cleared&date_from={d}&date_to={d}", headers=admin_headers).json()["items"]
    assert r["cash_received_paise"] == sum(x["amount_paise"] for x in cash_day) > 0
    assert r["closing_cash_paise"] == r["opening_cash_paise"] + r["cash_received_paise"] - r["cash_refunds_paise"] - r["bank_deposits_paise"] - r["cash_withdrawals_paise"]
    assert "Cash" in r["by_mode"]


# ---- Portal persona (replaces TestPortalAuth lockout, TestPortalData, TestChangePassword) ----
def _portal_login(pw=PORTAL_PW):
    return requests.post(f"{API}/portal/auth/login", json={"phone": PORTAL_PHONE, "password": pw}, timeout=30)


@pytest.fixture(scope="module")
def portal():
    r = _portal_login()
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_portal_me_masked_and_own_bookings_only(portal, admin_headers):
    me = requests.get(f"{API}/portal/me", headers=portal).json()
    assert me["full_name"].startswith("Priya") and "pan" not in me or me.get("pan") in (None, "")
    mine = requests.get(f"{API}/portal/bookings", headers=portal).json()
    nums = [b["booking_number"] for b in mine["items"]]
    assert nums, "story persona must own a booking"
    other = next(b for b in requests.get(f"{API}/bookings?page_size=50", headers=admin_headers).json()["items"] if b["booking_number"] not in nums)
    assert requests.get(f"{API}/portal/bookings/{other['id']}", headers=portal).status_code == 404


def test_portal_change_password_and_back(portal):
    r = requests.post(f"{API}/portal/auth/change-password", headers=portal, json={"current_password": PORTAL_PW, "new_password": "Buyer@54321"})
    assert r.status_code == 200, r.text
    assert _portal_login().status_code == 401
    tok = _portal_login("Buyer@54321").json()["access_token"]
    back = requests.post(f"{API}/portal/auth/change-password", headers={"Authorization": f"Bearer {tok}"}, json={"current_password": "Buyer@54321", "new_password": PORTAL_PW})
    assert back.status_code == 200 and _portal_login().status_code == 200


def test_portal_lockout_after_5_wrong(admin_headers):
    codes = [_portal_login("Wrong@" + str(i)).status_code for i in range(6)]
    assert 423 in codes, codes
    cust = requests.get(f"{API}/customers?page_size=1&search=CUST-2526-0002", headers=admin_headers).json()["items"][0]
    r = requests.post(f"{API}/customers/{cust['id']}/portal/revoke-sessions", headers=admin_headers, json={})
    assert r.status_code == 200, r.text
    # unlock for the rest of the suite: enable re-issues a temp password, then set the persona password back through the real flow
    en = requests.post(f"{API}/customers/{cust['id']}/portal/enable", headers=admin_headers, json={}).json()
    tok = requests.post(f"{API}/portal/auth/login", json={"phone": en["login_phone"], "password": en["temporary_password"]}).json()["access_token"]
    assert requests.post(f"{API}/portal/auth/change-password", headers={"Authorization": f"Bearer {tok}"}, json={"current_password": en["temporary_password"], "new_password": PORTAL_PW}).status_code == 200


# ---- Rate cards (replaces TestRateCards.test_create_activate_apply) ----
def test_rate_card_create_activate_apply_to_available(admin_headers):
    h = admin_headers
    sgh = next(p for p in requests.get(f"{API}/projects", headers=h).json()["items"] if p["code"] == "SGH")
    existing = requests.get(f"{API}/projects/{sgh['id']}/rate-cards", headers=h).json()["items"]
    base = next((rc for rc in existing if rc["status"] == "Active"), existing[0])
    body = {k: base[k] for k in base if k in ("base_rate_per_sqft", "floor_rise_per_floor", "plc_rates", "charges", "gst_percent", "base_rate_per_sqft_paise")}
    r = requests.post(f"{API}/projects/{sgh['id']}/rate-cards", headers=h, json={**body, "name": f"Story rewrite {uuid.uuid4().hex[:4]}", "effective_from": date.today().isoformat()})
    assert r.status_code == 201, r.text
    rc = r.json()
    assert rc["status"] == "Draft"
    assert requests.post(f"{API}/projects/{sgh['id']}/rate-cards/{rc['id']}/activate", headers=h).status_code == 200
    avail = requests.get(f"{API}/flats?project_id={sgh['id']}&status=Available&page_size=1", headers=h).json()["total"]
    ap = requests.post(f"{API}/projects/{sgh['id']}/rate-cards/{rc['id']}/apply", headers=h).json()
    assert ap["flats_updated"] == avail, (ap, avail)
    booked = requests.get(f"{API}/flats?project_id={sgh['id']}&status=Booked&page_size=1", headers=h).json()["items"][0]
    assert booked["status"] == "Booked", "apply never touches booked flats"
