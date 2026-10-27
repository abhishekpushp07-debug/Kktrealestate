"""CR-7 session hardening: refresh token cookie flags, cookie-based refresh needs the CSRF double-submit header, rotation + reuse
detection unchanged, logout clears the cookie. Body-based refresh (API clients) keeps working."""
import os

import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
PW = os.environ["TEST_PASSWORD"]
EMAIL = "admin@kkt.in"


def _login(s: requests.Session):
    r = s.request("POST", f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)  # .request: bypasses conftest login cache
    assert r.status_code == 200, r.text
    return r


def _cookie_attrs(resp, name):
    for h in resp.raw.headers.getlist("Set-Cookie"):
        if h.startswith(f"{name}="):
            return h.lower()
    return ""


def test_login_sets_hardened_cookies():
    s = requests.Session()
    r = _login(s)
    rt = _cookie_attrs(r, "kkt_rt")
    assert rt and "httponly" in rt and "samesite=strict" in rt and "path=/api/auth" in rt
    assert ("secure" in rt) == BASE.startswith("https")
    cs = _cookie_attrs(r, "kkt_csrf")
    assert cs and "httponly" not in cs and "samesite=strict" in cs and "path=/" in cs
    assert s.cookies.get("kkt_csrf")


def test_cookie_refresh_requires_csrf_then_rotates_and_detects_reuse():
    s = requests.Session()
    _login(s)
    old_rt = s.cookies.get("kkt_rt", path="/api/auth")
    r = s.post(f"{BASE}/api/auth/refresh", json={}, timeout=30)
    assert r.status_code == 403 and r.json().get("code", r.json().get("error", {}).get("code")) == "CSRF_REQUIRED"
    r = s.post(f"{BASE}/api/auth/refresh", json={}, headers={"X-CSRF-Token": "wrong"}, timeout=30)
    assert r.status_code == 403
    r = s.post(f"{BASE}/api/auth/refresh", json={}, headers={"X-CSRF-Token": s.cookies.get("kkt_csrf")}, timeout=30)
    assert r.status_code == 200 and r.json()["access_token"] and r.json()["csrf_token"]
    new_rt = s.cookies.get("kkt_rt", path="/api/auth")
    assert new_rt and new_rt != old_rt, "cookie rotated"
    # replaying the old (rotated) token → reuse detection revokes the family
    r = requests.post(f"{BASE}/api/auth/refresh", json={"refresh_token": old_rt}, timeout=30)
    assert r.status_code == 401 and "REUSED" in r.text
    r = requests.post(f"{BASE}/api/auth/refresh", json={"refresh_token": new_rt}, timeout=30)
    assert r.status_code == 401, "whole family revoked after reuse"


def test_body_refresh_still_works_for_api_clients():
    r = requests.request("POST", f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    rt = r.json()["refresh_token"]
    r2 = requests.post(f"{BASE}/api/auth/refresh", json={"refresh_token": rt}, timeout=30)
    assert r2.status_code == 200 and r2.json()["refresh_token"] != rt


def test_logout_revokes_cookie_token_and_clears_cookies():
    s = requests.Session()
    r = _login(s)
    access = r.json()["access_token"]
    rt = s.cookies.get("kkt_rt", path="/api/auth")
    r = s.post(f"{BASE}/api/auth/logout", json={}, headers={"Authorization": f"Bearer {access}"}, timeout=30)
    assert r.status_code == 403, "cookie logout without CSRF header is rejected"
    r = s.post(f"{BASE}/api/auth/logout", json={}, headers={"Authorization": f"Bearer {access}", "X-CSRF-Token": s.cookies.get("kkt_csrf")}, timeout=30)
    assert r.status_code == 200
    cleared = [h.lower() for h in r.raw.headers.getlist("Set-Cookie") if h.startswith("kkt_rt=")]
    assert cleared and ("max-age=0" in cleared[0] or "expires=" in cleared[0])
    assert not s.cookies.get("kkt_rt", path="/api/auth")
    r = requests.post(f"{BASE}/api/auth/refresh", json={"refresh_token": rt}, timeout=30)
    assert r.status_code == 401
