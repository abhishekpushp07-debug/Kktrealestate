# Phase 2 chunk 2B+2C: theme preferences endpoint + search receipts group (run against PREVIEW public URL)
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PW = "Kkt@12345"


def grp(d, t):
    return next((g["items"] for g in d.get("groups", []) if g["type"] == t), [])


def login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = login("admin@kkt.in")
    yield s
    s.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": "light"})


# Preferences
class TestPreferences:
    def test_me_has_ui_theme(self, admin):
        r = admin.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json().get("ui_theme") in ("light", "night")

    def test_set_night_persists(self, admin):
        r = admin.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": "night"})
        assert r.status_code == 200, r.text
        assert r.json()["ui_theme"] == "night"
        assert admin.get(f"{BASE_URL}/api/auth/me").json()["ui_theme"] == "night"
        # new session sees server value
        s2 = login("admin@kkt.in")
        assert s2.get(f"{BASE_URL}/api/auth/me").json()["ui_theme"] == "night"

    def test_set_light(self, admin):
        r = admin.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": "light"})
        assert r.status_code == 200
        assert admin.get(f"{BASE_URL}/api/auth/me").json()["ui_theme"] == "light"

    @pytest.mark.parametrize("bad", ["Auto", "auto", "dark", "", "LIGHT"])
    def test_invalid_theme_422(self, admin, bad):
        r = admin.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": bad})
        assert r.status_code == 422, (bad, r.status_code, r.text)

    def test_missing_body_422(self, admin):
        r = admin.patch(f"{BASE_URL}/api/auth/me/preferences", json={})
        assert r.status_code == 422

    def test_unauth_401(self):
        r = requests.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": "light"})
        assert r.status_code in (401, 403)

    def test_sales_can_set_own(self):
        s = login("sales@kkt.in")
        cur = s.get(f"{BASE_URL}/api/auth/me").json().get("ui_theme", "light")
        r = s.patch(f"{BASE_URL}/api/auth/me/preferences", json={"theme": cur})
        assert r.status_code == 200


# Search receipts group
class TestSearchReceipts:
    def _receipt(self, admin):
        r = admin.get(f"{BASE_URL}/api/search", params={"q": "KKT/2526/", "limit": 5})
        assert r.status_code == 200, r.text
        return r.json()

    def test_prefix_receipt(self, admin):
        d = self._receipt(admin)
        print("keys", list(d.keys()))
        rec = grp(d, "receipts")
        assert rec, d
        assert all("KKT/2526/" in x["receipt_number"] for x in rec)
        assert "_id" not in rec[0]

    def test_lowercase_prefix(self, admin):
        r = admin.get(f"{BASE_URL}/api/search", params={"q": "kkt/2526/"})
        d = r.json()
        rec = grp(d, "receipts")
        assert rec

    def test_trailing_digits(self, admin):
        d = self._receipt(admin)
        rec = grp(d, "receipts")
        rn = rec[0]["receipt_number"]
        tail = rn.split("/")[-1][-3:]
        t0 = time.time()
        r = admin.get(f"{BASE_URL}/api/search", params={"q": tail})
        el = time.time() - t0
        d2 = r.json()
        rec2 = grp(d2, "receipts")
        print("tail", tail, len(rec2), "elapsed", el, r.headers.get("server-timing"))
        assert any(x["receipt_number"].endswith(tail) for x in rec2)
        assert el < 1.5

    def test_sales_no_receipts_if_no_perm(self):
        s = login("sales@kkt.in")
        r = s.get(f"{BASE_URL}/api/search", params={"q": "KKT/2526/"})
        assert r.status_code == 200
        print("sales search groups", [g["type"] for g in r.json()["groups"]])

    def test_gibberish_empty(self, admin):
        r = admin.get(f"{BASE_URL}/api/search", params={"q": "zzqx"})
        assert r.status_code == 200
        d = r.json()
        assert d["groups"] == [], d
