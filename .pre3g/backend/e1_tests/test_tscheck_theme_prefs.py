"""JRN-43/45: theme preference is stored server-side; only light|night accepted."""
import httpx
from conftest import BASE


def test_theme_roundtrip_and_reject_auto(api):
    r = api.patch("/auth/me/preferences", json={"theme": "night"})
    assert r.status_code == 200, r.text
    me = api.get("/auth/me").json()
    assert "night" in str(me), str(me)[:300]
    bad = api.patch("/auth/me/preferences", json={"theme": "auto"})
    assert bad.status_code in (400, 422), bad.text
    r = api.patch("/auth/me/preferences", json={"theme": "light"})
    assert r.status_code == 200, r.text
    assert "night" not in str(api.get("/auth/me").json()), "theme still night after reset" 


def test_prefs_requires_auth():
    r = httpx.patch(f"{BASE}/auth/me/preferences", json={"theme": "night"}, timeout=30)
    assert r.status_code == 401, r.text
