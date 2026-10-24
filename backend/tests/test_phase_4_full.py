"""Phase 4 comprehensive: reports (11), presets, PDFs (statement/allotment/receipt/demand),
role dashboards, notifications, backup, ready/health, erasure, upload magic-bytes, OpenAPI 401 sweep.
"""
import io
import os
import uuid

import httpx
import pytest
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

REPORT_KEYS = [
    "collections", "outstanding", "advances", "demand-vs-collection",
    "inventory", "cheques", "cancellations", "sales-leads",
    "roznamcha-range", "bank-receipts", "activity",
]


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=90) as c:
        yield c


def _tok(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "Kkt@12345"})
    assert r.status_code == 200, f"{email} login failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin(client): return _tok(client, "admin@kkt.in")
@pytest.fixture(scope="module")
def accounts(client): return _tok(client, "accounts@kkt.in")
@pytest.fixture(scope="module")
def sales(client): return _tok(client, "sales@kkt.in")
@pytest.fixture(scope="module")
def employee(client): return _tok(client, "employee@kkt.in")
@pytest.fixture(scope="module")
def marketing(client): return _tok(client, "marketing@kkt.in")
@pytest.fixture(scope="module")
def padmin(client): return _tok(client, "projectadmin@kkt.in")


# ---------- Reports list + each report in 3 formats ----------
def test_reports_list_has_11(client, admin):
    r = client.get("/api/reports", headers=admin)
    assert r.status_code == 200
    items = r.json()
    # could be dict or list
    if isinstance(items, dict) and "items" in items:
        items = items["items"]
    assert len(items) == 11, f"expected 11 reports, got {len(items)}"


@pytest.mark.parametrize("key", REPORT_KEYS)
def test_report_formats(client, admin, key):
    # JSON
    r = client.get(f"/api/reports/{key}", headers=admin)
    assert r.status_code == 200, f"{key} JSON: {r.status_code} {r.text[:200]}"
    j = r.json()
    assert "columns" in j and "rows" in j and "totals" in j, f"{key} missing keys: {list(j.keys())}"
    # CSV
    r = client.get(f"/api/reports/{key}", params={"format": "csv"}, headers=admin)
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    # PDF
    r = client.get(f"/api/reports/{key}", params={"format": "pdf"}, headers=admin)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_reports_rbac(client, accounts, employee):
    assert client.get("/api/reports/collections", headers=accounts).status_code == 200
    assert client.get("/api/reports/collections", headers=employee).status_code == 403


# ---------- Totals reconciliation ----------
def test_collections_totals_match_payments(client, admin):
    rep = client.get("/api/reports/collections", params={"from_date": "2020-01-01", "to_date": "2030-12-31"}, headers=admin).json()
    total = 0
    page = 1
    while True:
        r = client.get("/api/payments", params={"page": page, "page_size": 100, "status": "Cleared"}, headers=admin).json()
        total += sum(i["amount_paise"] for i in r["items"] if i["status"] == "Cleared")
        if page * 100 >= r["total"]:
            break
        page += 1
    assert rep["totals"]["total_paise"] == total


def test_outstanding_totals_match_bookings(client, admin):
    rep = client.get("/api/reports/outstanding", headers=admin).json()
    total_due = 0
    page = 1
    while True:
        r = client.get("/api/bookings", params={"page": page, "page_size": 100}, headers=admin).json()
        for b in r["items"]:
            if b.get("status") in ("Active", "Completed"):
                s = b.get("summary") or {}
                total_due += s.get("due_paise", 0) + s.get("other_charges_due_paise", 0)
        if page * 100 >= r["total"]:
            break
        page += 1
    assert rep["totals"]["due_paise"] == total_due


# ---------- Customer PDFs ----------
@pytest.fixture(scope="module")
def booking_0001(client, admin):
    r = client.get("/api/bookings", params={"search": "BK-2526-0001", "page_size": 1}, headers=admin).json()
    assert r["items"], "BK-2526-0001 not found"
    return r["items"][0]


def _pdf_text(content):
    return "".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(content)).pages)


def test_statement_pdf(client, admin, booking_0001):
    r = client.get(f"/api/reports/statement/{booking_0001['id']}", params={"format": "pdf"}, headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = _pdf_text(r.content)
    assert "Ledger" in t
    assert "BK-2526-0001" in t
    assert "Only" in t


def test_allotment_pdf(client, admin, booking_0001):
    r = client.get(f"/api/reports/allotment/{booking_0001['id']}", params={"format": "pdf"}, headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = _pdf_text(r.content)
    assert "Allotment" in t or "ALLOTMENT" in t
    assert "Only" in t


def test_receipt_pdf(client, admin, booking_0001):
    pay = client.get("/api/payments", params={"booking_id": booking_0001["id"], "page_size": 1}, headers=admin).json()["items"][0]
    r = client.get(f"/api/payments/{pay['id']}/receipt.pdf", headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = _pdf_text(r.content)
    assert "Receipt" in t and "Only" in t


def test_demand_letter_pdf(client, admin, booking_0001):
    full = client.get(f"/api/bookings/{booking_0001['id']}", headers=admin).json()
    dem = full["demands"][0]
    r = client.get(f"/api/bookings/{booking_0001['id']}/demands/{dem['id']}/letter.pdf", headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = _pdf_text(r.content)
    assert "Demand" in t


# ---------- Report presets ----------
def test_report_presets_crud(client, admin):
    r = client.post("/api/reports/presets", json={"report_key": "collections", "name": "QA preset", "filters": {"group_by": "month"}}, headers=admin)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    lst = client.get("/api/reports/presets", params={"report_key": "collections"}, headers=admin).json()
    items = lst.get("items", lst) if isinstance(lst, dict) else lst
    assert any(p["id"] == pid for p in items)
    assert client.delete(f"/api/reports/presets/{pid}", headers=admin).status_code == 200


# ---------- Role dashboards ----------
def test_dashboard_admin(client, admin):
    d = client.get("/api/dashboard/widgets", headers=admin).json()
    assert d["role"] == "Super Admin"
    for k in ("collections_trend", "ageing", "top_overdue", "pending_cheques", "inventory_by_project", "construction", "funnel"):
        assert k in d, f"super admin missing {k}: keys={list(d.keys())}"


def test_dashboard_accounts(client, accounts):
    d = client.get("/api/dashboard/widgets", headers=accounts).json()
    assert d["role"] == "Accounts"
    for k in ("collections_today", "collections_month", "overdue_demands"):
        assert k in d, f"accounts missing {k}"
    assert "funnel" not in d


def test_dashboard_sales(client, sales):
    d = client.get("/api/dashboard/widgets", headers=sales).json()
    assert d["role"] == "Sales"
    for k in ("funnel", "follow_ups_due", "new_enquiries", "my_bookings_month"):
        assert k in d, f"sales missing {k}"
    assert "collections_trend" not in d


def test_dashboard_project_admin(client, padmin):
    d = client.get("/api/dashboard/widgets", headers=padmin).json()
    assert d["role"] == "Project Admin"
    assert "demands_raised_month" in d
    assert "construction" in d


# ---------- Notifications ----------
def test_notifications_website_enquiry(client, sales, marketing, accounts):
    def unread(h):
        r = client.get("/api/notifications", headers=h).json()
        return r.get("unread", r.get("unread_count", 0)), r.get("items", r if isinstance(r, list) else [])

    sales_before, _ = unread(sales)
    mktg_before, _ = unread(marketing)
    acct_before, _ = unread(accounts)

    r = client.post(
        "/api/public/enquiries",
        json={"name": "Notif QA", "phone": "9811122233", "consent": True, "website": "", "project_slug": "shree-ganesh-heights"},
    )
    assert r.status_code == 200, r.text

    import time; time.sleep(1.0)

    sales_after, s_items = unread(sales)
    mktg_after, m_items = unread(marketing)
    acct_after, a_items = unread(accounts)

    assert sales_after > sales_before, f"sales unread not increased ({sales_before}->{sales_after})"
    assert mktg_after > mktg_before, f"marketing unread not increased"
    # accounts should not get lead.create
    assert not any(i.get("kind") == "lead.create" for i in a_items), "accounts should not get lead.create"

    lead_notif = next((i for i in s_items if i.get("kind") == "lead.create"), None)
    assert lead_notif, "no lead.create for sales"
    assert "New website enquiry" in (lead_notif.get("title") or "")

    # mark read
    nid = lead_notif["id"]
    r = client.post(f"/api/notifications/{nid}/read", headers=sales)
    assert r.status_code == 200
    sales_mid, _ = unread(sales)
    assert sales_mid < sales_after

    r = client.post("/api/notifications/read-all", headers=sales)
    assert r.status_code == 200
    sales_final, _ = unread(sales)
    assert sales_final == 0


# ---------- Hardening: OpenAPI 401 sweep (duplicate of test_phase_4 - keep lightweight) ----------
def test_openapi_available(client):
    r = client.get("/api/openapi.json")
    assert r.status_code == 200
    assert "paths" in r.json()


# ---------- Backup ----------
def test_backup_rbac_and_zip(client, admin, accounts):
    assert client.post("/api/admin/backup", headers=accounts).status_code == 403
    r = client.post("/api/admin/backup", headers=admin)
    assert r.status_code == 201
    url = r.json()["download_url"]
    z = client.get(url)
    assert z.status_code == 200
    assert z.headers["content-type"] == "application/zip"
    assert z.content[:2] == b"PK"
    import zipfile
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    names = zf.namelist()
    assert "manifest.json" in names
    assert "bookings.json" in names
    assert client.get("/api/admin/backups", headers=admin).status_code == 200


def test_health_ready(client):
    r = client.get("/api/ready"); assert r.status_code == 200 and r.json().get("ready") is True
    h = client.get("/api/health").json()
    assert "workers" in h and "transaction_mode" in h


# ---------- Erasure ----------
def test_erasure_full_flow(client, admin, accounts):
    # Create a customer. If 422, inspect & augment
    payload = {"full_name": "Erase Me QA", "phone": "9800011122", "salutation": "Mr"}
    r = client.post("/api/customers", json=payload, headers=admin)
    if r.status_code == 422:
        # Try with more fields based on error
        payload.update({"email": f"erase_{uuid.uuid4().hex[:6]}@qa.in"})
        r = client.post("/api/customers", json=payload, headers=admin)
    assert r.status_code in (200, 201), f"customer create failed: {r.status_code} {r.text}"
    cid = r.json()["id"]

    # Bad confirm
    bad = client.post(f"/api/admin/customers/{cid}/erase", json={"confirm": "nope", "reason": "QA"}, headers=admin)
    assert bad.status_code == 400

    # Accounts forbidden
    forbidden = client.post(f"/api/admin/customers/{cid}/erase", json={"confirm": "ERASE", "reason": "QA"}, headers=accounts)
    assert forbidden.status_code == 403

    # Erase as admin
    r = client.post(f"/api/admin/customers/{cid}/erase", json={"confirm": "ERASE", "reason": "QA"}, headers=admin)
    assert r.status_code == 200, r.text
    got = client.get(f"/api/customers/{cid}", headers=admin).json()
    assert got["full_name"].startswith("Erased Customer")
    assert got.get("kyc_status") == "Erased"

    # Customer of BK-2526-0001 (active) → 409
    b = client.get("/api/bookings", params={"search": "BK-2526-0001", "page_size": 1}, headers=admin).json()["items"][0]
    cust_id = b.get("customer_id") or (b.get("customer") or {}).get("id")
    assert cust_id, f"no customer_id on BK-2526-0001: keys={list(b.keys())}"
    r = client.post(f"/api/admin/customers/{cust_id}/erase", json={"confirm": "ERASE", "reason": "QA"}, headers=admin)
    assert r.status_code == 409
    body = r.json()
    err = body.get("detail", body)
    err_str = str(err)
    assert "ACTIVE_BOOKING" in err_str


# ---------- Upload magic bytes ----------
def test_upload_magic_bytes(client, admin):
    p = client.get("/api/projects", headers=admin).json()
    projs = p.get("items", p)
    sgh = next((x for x in projs if "ganesh-heights" in (x.get("slug") or "")), projs[0])
    # Bad: pdf extension & content-type but non-pdf content
    r = client.post(
        "/api/documents",
        files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
        data={"entity_type": "project", "entity_id": sgh["id"]},
        headers=admin,
    )
    assert r.status_code == 422
    assert "UNSUPPORTED_MEDIA" in r.text
    # Good: minimal real PDF
    r = client.post(
        "/api/documents",
        files={"file": ("ok.pdf", b"%PDF-1.4\n%EOF", "application/pdf")},
        data={"entity_type": "project", "entity_id": sgh["id"]},
        headers=admin,
    )
    assert r.status_code == 201, r.text


# ---------- Marketing role ----------
def test_marketing_permissions(client, marketing):
    assert client.get("/api/cms/site", headers=marketing).status_code == 200
    assert client.get("/api/payments", headers=marketing).status_code == 403
