"""
Phase B hardening + receipt PDF polish — regression test for the review request.

Covers:
- Receipt PDF polish (text, deterministic bytes)
- Demand letter + allotment PDF signature block
- Uniform error envelope (404, 422, 401, 405, 428)
- Permission guards (anonymous + portal token on ERP routes)
- Idempotency replay (POST /api/customers)
- Optimistic concurrency (PATCH /api/customers)
- Integrity report
- Anchor booking BK-2526-0001 (22 ledger rows, due==0)
- Health endpoint fast + security headers
"""
import os
import hashlib
import io
import time
import uuid

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@kkt.in", "password": "Kkt@12345"}
PORTAL = {"phone": "9431023456", "password": "Buyer@12345"}
ANCHOR_BK = "BK-2526-0001"


# ---------- shared tokens (login once; rate limit 10/60s) ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def portal_token():
    r = requests.post(f"{API}/portal/auth/login", json=PORTAL, timeout=30)
    assert r.status_code == 200, f"portal login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def anchor_booking_id(admin_headers):
    r = requests.get(f"{API}/bookings", headers=admin_headers, params={"q": ANCHOR_BK}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    items = data.get("items") or data if isinstance(data, dict) else data
    if isinstance(data, dict) and "items" in data:
        items = data["items"]
    for b in items:
        if b.get("booking_number") == ANCHOR_BK:
            return b["id"]
    pytest.fail(f"Booking {ANCHOR_BK} not found")


# ---------- Health ----------
def test_health_fast_with_security_headers():
    t0 = time.perf_counter()
    r = requests.get(f"{API}/health", timeout=10)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert r.status_code == 200
    assert elapsed_ms < 500, f"health took {elapsed_ms:.0f} ms"
    assert "Content-Security-Policy" in r.headers, f"missing CSP; headers: {list(r.headers.keys())}"
    assert "X-Content-Type-Options" in r.headers


# ---------- Error envelope ----------
def _assert_envelope(resp, expected_code=None):
    body = resp.json()
    assert "detail" in body, f"no detail: {body}"
    assert "code" in body, f"no top-level code: {body}"
    assert "request_id" in body, f"no top-level request_id: {body}"
    assert "error" in body and isinstance(body["error"], dict), f"no error obj: {body}"
    for k in ("code", "message", "request_id"):
        assert k in body["error"], f"error missing {k}: {body}"
    if expected_code:
        assert body["code"] == expected_code or body["error"]["code"] == expected_code, \
            f"expected code {expected_code}, got {body.get('code')}/{body['error'].get('code')}"
    return body


def test_error_envelope_404_unknown_booking(admin_headers):
    r = requests.get(f"{API}/bookings/00000000-0000-0000-0000-000000000000", headers=admin_headers, timeout=15)
    assert r.status_code == 404
    _assert_envelope(r)


def test_error_envelope_422_validation(admin_headers):
    r = requests.post(f"{API}/customers", headers={**admin_headers, "Idempotency-Key": f"test-{uuid.uuid4()}"}, json={"full_name": 1}, timeout=15)
    assert r.status_code == 422
    _assert_envelope(r)


def test_error_envelope_401_anonymous():
    r = requests.get(f"{API}/bookings", timeout=15)
    assert r.status_code == 401
    _assert_envelope(r)


def test_error_envelope_405_method_not_allowed():
    r = requests.patch(f"{API}/bookings/x", timeout=15)
    assert r.status_code == 405
    _assert_envelope(r)


def test_error_envelope_428_idempotency_before_body_validation(admin_headers):
    # POST /api/payments with EMPTY body and NO Idempotency-Key → 428 before 422
    r = requests.post(f"{API}/payments", headers=admin_headers, json={}, timeout=15)
    assert r.status_code == 428, f"expected 428 got {r.status_code}: {r.text[:300]}"
    body = _assert_envelope(r)
    code = body.get("code") or body["error"].get("code")
    assert code == "IDEMPOTENCY_KEY_REQUIRED", f"bad code: {code}"


# ---------- Permission guards ----------
@pytest.mark.parametrize("path", ["/bookings", "/customers", "/payments", "/admin/integrity-report"])
def test_anonymous_rejected(path):
    r = requests.get(f"{API}{path}", timeout=15)
    assert r.status_code == 401, f"{path}: {r.status_code}"


@pytest.mark.parametrize("path", ["/bookings", "/customers", "/payments", "/admin/integrity-report"])
def test_portal_token_rejected_on_erp(portal_token, path):
    r = requests.get(f"{API}{path}", headers={"Authorization": f"Bearer {portal_token}"}, timeout=15)
    assert r.status_code in (401, 403), f"{path}: {r.status_code}"


# ---------- Idempotency replay ----------
def test_customers_idempotency_replay(admin_headers):
    key = f"test-replay-{uuid.uuid4()}"
    body = {"full_name": "TEST Replay User", "phone": "9" + str(uuid.uuid4().int)[:9], "salutation": "Mr"}
    headers = {**admin_headers, "Idempotency-Key": key}
    r1 = requests.post(f"{API}/customers", headers=headers, json=body, timeout=20)
    assert r1.status_code in (200, 201), f"first: {r1.status_code} {r1.text[:300]}"
    id1 = r1.json()["id"]
    r2 = requests.post(f"{API}/customers", headers=headers, json=body, timeout=20)
    assert r2.status_code in (200, 201), f"replay: {r2.status_code} {r2.text[:300]}"
    assert r2.json()["id"] == id1, "replay returned different id"
    # Case-insensitive header check
    replayed = r2.headers.get("Idempotent-Replayed") or r2.headers.get("idempotent-replayed")
    assert replayed, f"missing Idempotent-Replayed header; got {dict(r2.headers)}"
    # Ensure only one record
    search = requests.get(f"{API}/customers", headers=admin_headers, params={"search": "TEST Replay User", "page_size": 100}, timeout=20)
    assert search.status_code == 200
    data = search.json()
    items = data["items"] if isinstance(data, dict) and "items" in data else data
    matches = [c for c in items if c.get("id") == id1]
    assert len(matches) == 1, f"found {len(matches)} records (expected 1)"


# ---------- Optimistic concurrency ----------
def test_customers_version_conflict(admin_headers):
    key = f"test-vc-{uuid.uuid4()}"
    body = {"full_name": "TEST VersionConflict", "phone": "9" + str(uuid.uuid4().int)[:9], "salutation": "Mr"}  # unique: active-phone index persists across runs
    r = requests.post(f"{API}/customers", headers={**admin_headers, "Idempotency-Key": key}, json=body, timeout=20)
    assert r.status_code in (200, 201)
    cid = r.json()["id"]
    cur_version = r.json().get("version", 1)
    stale = cur_version + 50
    patch = requests.patch(
        f"{API}/customers/{cid}",
        headers={**admin_headers, "If-Match": str(stale)},
        json={"notes": "x", "version": stale},
        timeout=20,
    )
    assert patch.status_code == 409, f"expected 409 got {patch.status_code}: {patch.text[:300]}"
    body = _assert_envelope(patch)
    code = body.get("code") or body["error"].get("code")
    assert code == "VERSION_CONFLICT", f"bad code: {code}"


# ---------- Integrity ----------
def test_integrity_report_ok(admin_headers):
    r = requests.get(f"{API}/admin/integrity-report?fresh=1", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert data.get("ok") is True, f"ok != true: {data}"
    assert data.get("counts") == {} or data.get("counts") == {} , f"counts not empty: {data.get('counts')}"


# ---------- Anchor booking ----------
def test_anchor_booking_ledger_and_due(admin_headers, anchor_booking_id):
    r = requests.get(f"{API}/bookings/{anchor_booking_id}/ledger", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    rows = data["rows"] if isinstance(data, dict) and "rows" in data else data
    assert len(rows) == 22, f"expected 22 ledger rows got {len(rows)}"

    b = requests.get(f"{API}/bookings/{anchor_booking_id}", headers=admin_headers, timeout=30)
    assert b.status_code == 200
    summary = b.json().get("summary", {})
    due = summary.get("due", summary.get("due_paise"))
    assert due == 0, f"due != 0: {due} (summary={summary})"


# ---------- PDFs ----------
def _extract_pdf_text(blob: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(blob))
    return "\n".join(p.extract_text() or "" for p in reader.pages)


@pytest.fixture(scope="session")
def anchor_payment_id(admin_headers, anchor_booking_id):
    r = requests.get(f"{API}/bookings/{anchor_booking_id}/ledger", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    rows = data["rows"] if isinstance(data, dict) and "rows" in data else data
    for row in rows:
        pid = row.get("payment_id") or row.get("ref_payment_id") or (row.get("ref", {}) or {}).get("payment_id") if isinstance(row.get("ref"), dict) else None
        if pid:
            return pid
    # fallback: list payments
    rp = requests.get(f"{API}/payments", headers=admin_headers, params={"booking_id": anchor_booking_id}, timeout=20)
    if rp.status_code == 200:
        data = rp.json()
        items = data["items"] if isinstance(data, dict) and "items" in data else data
        if items:
            return items[0]["id"]
    pytest.fail("No payment id found on anchor booking")


def test_receipt_pdf_text_and_deterministic(admin_headers, anchor_payment_id):
    url = f"{API}/payments/{anchor_payment_id}/receipt.pdf"
    r1 = requests.get(url, headers=admin_headers, timeout=30)
    assert r1.status_code == 200, r1.text[:300]
    assert r1.headers.get("content-type", "").startswith("application/pdf")
    text = _extract_pdf_text(r1.content)
    for needle in ["Amount received", "Authorised Signatory", "For KKT Constructions", "Page 1 of"]:
        assert needle in text, f"missing '{needle}' in receipt PDF (text excerpt: {text[:500]!r})"
    r2 = requests.get(url, headers=admin_headers, timeout=30)
    assert r2.status_code == 200
    sha1 = hashlib.sha256(r1.content).hexdigest()
    sha2 = hashlib.sha256(r2.content).hexdigest()
    assert sha1 == sha2, f"receipt PDF bytes not deterministic: {sha1} vs {sha2}"


def test_allotment_pdf_has_signature(admin_headers, anchor_booking_id):
    r = requests.get(f"{API}/bookings/{anchor_booking_id}/allotment.pdf", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    text = _extract_pdf_text(r.content)
    assert "Authorised Signatory" in text, f"no sig in allotment: {text[:400]!r}"
    assert "Page 1 of" in text


def test_demand_letter_pdf_has_signature(admin_headers, anchor_booking_id):
    # Demands are nested on the booking detail
    r = requests.get(f"{API}/bookings/{anchor_booking_id}", headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text[:300]
    demands = r.json().get("demands") or []
    assert demands, "no demands on anchor booking"
    did = demands[0]["id"]
    rp = requests.get(f"{API}/bookings/{anchor_booking_id}/demands/{did}/letter.pdf", headers=admin_headers, timeout=30)
    assert rp.status_code == 200, rp.text[:300]
    text = _extract_pdf_text(rp.content)
    assert "Authorised Signatory" in text, f"no sig in demand letter: {text[:400]!r}"
    assert "Page 1 of" in text
