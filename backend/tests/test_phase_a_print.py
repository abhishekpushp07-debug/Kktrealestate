"""Phase A — branded print PDFs: 4 ERP endpoints, download header, 404 out of scope, portal/ERP byte identity."""
import hashlib
import os

import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _portal():
    r = requests.post(f"{BASE}/api/portal/auth/login", json={"phone": "9431023456", "password": "Buyer@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _ids(h, ph):
    pb = requests.get(f"{BASE}/api/portal/bookings", headers=ph).json()
    pb = pb["items"] if isinstance(pb, dict) else pb
    bid = pb[0]["id"]
    b = requests.get(f"{BASE}/api/bookings/{bid}", headers=h).json()
    return bid, b["payments"][0]["id"], b["demands"][0]["id"]


def test_erp_pdfs_inline_download_and_404():
    h = _admin()
    bid, pay, dem = _ids(h, _portal())
    urls = {"receipt": f"/api/payments/{pay}/receipt.pdf", "demand": f"/api/bookings/{bid}/demands/{dem}/letter.pdf", "statement": f"/api/bookings/{bid}/statement.pdf", "allotment": f"/api/bookings/{bid}/allotment.pdf"}
    for kind, u in urls.items():
        r = requests.get(BASE + u, headers=h)
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf"), (kind, r.status_code)
        assert r.headers["content-disposition"].startswith("inline;") and r.content[:4] == b"%PDF"
        d = requests.get(BASE + u + "?download=1", headers=h)
        assert d.headers["content-disposition"].startswith(f'attachment; filename="{kind}-'), d.headers["content-disposition"]
    assert requests.get(f"{BASE}/api/bookings/00000000-0000-0000-0000-000000000000/statement.pdf", headers=h).status_code == 404
    assert requests.get(f"{BASE}/api/payments/00000000-0000-0000-0000-000000000000/receipt.pdf", headers=h).status_code == 404


def test_portal_and_erp_pdfs_identical():
    h, ph = _admin(), _portal()
    bid, pay, dem = _ids(h, ph)
    pairs = [(f"/api/portal/bookings/{bid}/statement.pdf", f"/api/bookings/{bid}/statement.pdf"), (f"/api/portal/bookings/{bid}/allotment.pdf", f"/api/bookings/{bid}/allotment.pdf"),
             (f"/api/portal/bookings/{bid}/payments/{pay}/receipt.pdf", f"/api/payments/{pay}/receipt.pdf"), (f"/api/portal/bookings/{bid}/demands/{dem}/letter.pdf", f"/api/bookings/{bid}/demands/{dem}/letter.pdf")]
    for p, e in pairs:
        a = requests.get(BASE + p, headers=ph).content
        b = requests.get(BASE + e, headers=h).content
        assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest(), p


def test_public_verify_code():
    h = _admin()
    bid, pay, dem = _ids(h, _portal())
    requests.get(f"{BASE}/api/payments/{pay}/receipt.pdf", headers=h)
    import hmac
    key = (os.environ.get("ENCRYPTION_KEY") or os.environ.get("JWT_SECRET") or "kkt").encode()
    code = hmac.new(key, f"receipt:{pay}".encode(), hashlib.sha256).hexdigest()[:8].upper()
    r = requests.get(f"{BASE}/api/public/verify/{code}")
    assert r.status_code == 200 and r.json()["valid"] is True and r.json()["doc_type"] == "receipt"
    assert set(r.json()) <= {"valid", "doc_type", "number", "date"}
    assert requests.get(f"{BASE}/api/public/verify/ZZZZ0000").json() == {"valid": False}
