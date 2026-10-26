"""Owner bootstrap + demo-account host gating."""
import os

import requests

# host gating is decided from the Host/X-Forwarded-Host the backend sees; the preview ingress rewrites those, so hit the backend directly
BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")}
OWNER = os.environ.get("OWNER_BOOTSTRAP_EMAIL", "")
OWNER_PW = os.environ.get("OWNER_BOOTSTRAP_PASSWORD", "")


def _login(email, pw, host=None):
    h = {**BYPASS}
    if host:
        h["X-Forwarded-Host"] = host
    return requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, headers=h, timeout=15)


def test_owner_login_super_admin():
    assert OWNER and OWNER_PW, "OWNER_BOOTSTRAP_* not set"
    r = _login(OWNER, OWNER_PW, "localhost")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role_name"] == "Super Admin"
    assert r.json()["user"].get("is_demo") in (False, None)


def test_demo_login_refused_on_production_host():
    r = _login("admin@kkt.in", "Kkt@12345", "billpe.com")
    assert r.status_code == 401, r.text
    assert r.json()["code"] == "DEMO_LOGIN_DISABLED"


def test_demo_login_allowed_on_preview_host():
    r = _login("admin@kkt.in", "Kkt@12345", "kkt.preview.emergentagent.com")
    assert r.status_code == 200, r.text


def test_login_options_follow_host():
    prod = requests.get(f"{BASE}/auth/login-options", headers={"X-Forwarded-Host": "billpe.com"}, timeout=15).json()
    prev = requests.get(f"{BASE}/auth/login-options", headers={"X-Forwarded-Host": "x.preview.emergentagent.com"}, timeout=15).json()
    assert prod == {"demo_accounts": False, "company": "KKT Constructions"}
    assert prev["demo_accounts"] is True


def test_owner_not_in_test_credentials_file():
    txt = open("/app/memory/test_credentials.md").read()
    assert OWNER_PW not in txt
