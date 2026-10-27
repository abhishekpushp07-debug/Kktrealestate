"""Phase 4 hardening: every non-public route must reject anonymous requests (401), PDFs are valid, backup RBAC."""
import os

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
PUBLIC_PREFIXES = ("/api/public", "/api/files/variants/", "/api/files/{file_id}/download", "/api/auth/login", "/api/auth/refresh", "/api/auth/forgot", "/api/auth/reset", "/api/health", "/api/ready", "/api/openapi.json", "/api/docs", "/api/admin/backups/", "/api/portal/auth/login", "/api/portal/auth/refresh", "/api/portal/config")


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=60) as c:
        yield c


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def accounts(client):
    r = client.post("/api/auth/login", json={"email": "accounts@kkt.in", "password": "Kkt@12345"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_openapi_all_routes_require_auth(client):
    spec = client.get("/api/openapi.json").json()
    unguarded = []
    checked = 0
    for path, methods in spec["paths"].items():
        if path.startswith(PUBLIC_PREFIXES):
            continue
        for m in methods:
            if m not in ("get", "post", "patch", "put", "delete"):
                continue
            url = path
            for seg in [s for s in path.split("/") if s.startswith("{")]:
                url = url.replace(seg, "00000000-0000-0000-0000-000000000000")
            r = client.request(m.upper(), url, json={} if m in ("post", "patch", "put") else None)
            checked += 1
            if r.status_code != 401:
                unguarded.append((m, path, r.status_code))
    assert checked > 100
    assert not unguarded, unguarded


def test_pdfs_download(client, admin):
    import io

    from pypdf import PdfReader
    b = client.get("/api/bookings", params={"search": "BK-2526-0001", "page_size": 1}, headers=admin).json()["items"][0]
    for url in (f"/api/reports/statement/{b['id']}?format=pdf", f"/api/reports/allotment/{b['id']}?format=pdf", "/api/reports/collections?format=pdf"):
        r = client.get(url, headers=admin)
        assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
        text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
        assert "KKT Constructions" in text
    pay = client.get("/api/payments", params={"booking_id": b["id"], "page_size": 1}, headers=admin).json()["items"][0]
    r = client.get(f"/api/payments/{pay['id']}/receipt.pdf", headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
    assert "Only" in text  # amount in words
    d = client.get(f"/api/bookings/{b['id']}", headers=admin).json()["demands"][0]
    r = client.get(f"/api/bookings/{b['id']}/demands/{d['id']}/letter.pdf", headers=admin)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")


def test_collections_report_matches_payments(client, admin):
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


def test_backup_rbac(client, admin, accounts):
    assert client.post("/api/admin/backup", headers=accounts).status_code == 403
    r = client.post("/api/admin/backup", headers=admin)
    assert r.status_code == 201, r.text
    z = client.get(r.json()["download_url"])
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip" and z.content[:2] == b"PK"
    assert client.get("/api/admin/backups", headers=admin).status_code == 200


def test_upload_magic_bytes(client, admin):
    p = client.get("/api/projects", headers=admin).json()["items"][0]
    r = client.post("/api/documents", files={"file": ("x.pdf", b"not a pdf at all", "application/pdf")}, data={"entity_type": "project", "entity_id": p["id"]}, headers=admin)
    assert r.status_code == 422
