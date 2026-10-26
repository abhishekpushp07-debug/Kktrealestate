"""Phase C refocus backend tests: parked public/portal APIs, bootstrap surfaces, company settings, receipt PDF, CSV, health."""
import os
import time
import re
import pytest
import requests
import urllib.request
import urllib.error
import json as _json

def _raw_get(path):
    """Bypass the shared conftest's auto-injected X-Rate-Limit-Bypass header."""
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-realty-hub-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@kkt.in"
ADMIN_PASSWORD = "Kkt@12345"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- parked surfaces ----------
def test_public_projects_parked_404():
    status, body_text = _raw_get("/api/public/projects")
    assert status == 404, f"expected 404, got {status} body={body_text[:300]}"
    body = _json.loads(body_text)
    err = body.get("error") or body
    code = err.get("code") or body.get("code")
    assert code == "NOT_FOUND", f"expected code NOT_FOUND, body={body}"
    req_id = body.get("request_id") or err.get("request_id")
    assert req_id, f"expected request_id, body={body}"


def test_portal_config_parked_404():
    status, body_text = _raw_get("/api/portal/config")
    assert status == 404, f"expected 404, got {status} body={body_text[:300]}"
    body = _json.loads(body_text)
    err = body.get("error") or body
    code = err.get("code") or body.get("code")
    assert code == "NOT_FOUND", f"expected code NOT_FOUND, body={body}"
    req_id = body.get("request_id") or err.get("request_id")
    assert req_id, f"expected request_id in body={body}"


# ---------- bootstrap ----------
def test_bootstrap_surfaces_and_company_name(admin_token):
    url = f"{BASE_URL}/api/bootstrap"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {admin_token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        assert r.status == 200
        data = _json.loads(r.read().decode("utf-8"))
    surfaces = data.get("surfaces")
    assert surfaces is not None, f"missing surfaces: {list(data.keys())}"
    assert surfaces.get("public_website") is False, f"public_website={surfaces.get('public_website')}"
    assert surfaces.get("customer_portal") is False, f"customer_portal={surfaces.get('customer_portal')}"
    company = data.get("company") or {}
    assert company.get("name") == "KKT Constructions", f"company.name={company.get('name')}"


# ---------- company settings ----------
def test_settings_company(admin_headers):
    r = requests.get(f"{BASE_URL}/api/settings/company", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert data.get("receipt_prefix") == "KKT", f"receipt_prefix={data.get('receipt_prefix')}"
    assert data.get("tagline") == "Building trust, delivering homes", f"tagline={data.get('tagline')}"


# ---------- receipt PDF ----------
def test_receipt_pdf_text_kkt(admin_headers):
    # Find a payment id
    r = requests.get(f"{BASE_URL}/api/payments?page_size=5", headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text[:300]
    items = r.json().get("items") or r.json().get("data") or []
    assert items, f"no payments found: {r.text[:400]}"
    pay_id = items[0].get("id") or items[0].get("_id") or items[0].get("payment_id")
    assert pay_id, f"no id in payment: {items[0]}"
    r2 = requests.get(f"{BASE_URL}/api/payments/{pay_id}/receipt.pdf", headers=admin_headers, timeout=30)
    assert r2.status_code == 200, f"{r2.status_code} {r2.text[:300]}"
    assert r2.headers.get("content-type", "").startswith("application/pdf"), r2.headers
    # Extract text via pypdf
    from io import BytesIO
    try:
        from pypdf import PdfReader
    except ImportError:
        from PyPDF2 import PdfReader  # type: ignore
    reader = PdfReader(BytesIO(r2.content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "KKT Constructions" in text, f"'KKT Constructions' not in PDF text. sample: {text[:400]}"
    assert "paise" not in text.lower(), f"'paise' present in receipt text: {text[:400]}"


# ---------- CSV collections ----------
def test_collections_csv_no_paise(admin_headers):
    r = requests.get(f"{BASE_URL}/api/reports/collections?format=csv", headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text[:300]
    text = r.text
    lines = [l for l in text.splitlines() if not l.startswith("#")]
    header = lines[0] if lines else ""
    assert "paise" not in header.lower(), f"'paise' in header: {header}"
    # humanised money headers carry the rupee sign (Phase I.1); legacy _inr accepted
    cols = [c.strip().lower() for c in header.split(",")]
    inr_cols = [c for c in cols if c.endswith("_inr") or c.endswith("₹")]
    assert inr_cols, f"no rupee columns found in header: {header}"


# ---------- health ----------
def test_health_under_500ms():
    t0 = time.perf_counter()
    r = requests.get(f"{BASE_URL}/api/health", timeout=5)
    dt_ms = (time.perf_counter() - t0) * 1000
    assert r.status_code == 200, r.text[:300]
    assert dt_ms < 500, f"health took {dt_ms:.1f} ms"
