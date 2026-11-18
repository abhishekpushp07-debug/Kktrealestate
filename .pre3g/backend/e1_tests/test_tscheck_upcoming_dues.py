import httpx

API = "http://localhost:8001/api"


def _tok():
    r = httpx.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    assert r.status_code == 200
    return r.json()["access_token"]


def test_upcoming_dues_totals_match_rows():
    h = {"Authorization": f"Bearer {_tok()}"}
    for d in (30, 90, 365):
        r = httpx.get(f"{API}/reports/upcoming-dues", params={"days": d}, headers=h, timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        items = j["items"]
        assert j["total_paise"] == sum(i["total_paise"] for i in items)
        for i in items:
            assert i["total_paise"] == i["cash_paise"] + i["account_paise"]
