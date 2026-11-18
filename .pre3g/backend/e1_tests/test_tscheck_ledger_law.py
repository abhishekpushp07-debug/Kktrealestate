import os, re, httpx, pytest
API = "http://localhost:8001/api"
PW = re.search(r'^DEMO_PASSWORD=["\']?([^"\'\n]+)', open('/app/backend/.env').read(), re.M).group(1)
IDS = {"ontime": "696d665b-1086-4e56-8442-b765a4fef405", "transfer": "e34ee469-9460-4122-8d0a-dba26296affa", "cancel": "c033f2c1-84f4-43c4-9329-ebd7fce07441"}

@pytest.fixture(scope="module")
def h():
    r = httpx.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": PW}, timeout=30)
    assert r.status_code == 200
    return {"authorization": "Bearer " + r.json()["access_token"]}

@pytest.mark.parametrize("tag", list(IDS))
def test_ledger_law(h, tag):
    r = httpx.get(f"{API}/bookings/{IDS[tag]}/ledger", headers=h, timeout=30)
    assert r.status_code == 200
    s = r.json()["booking"]["summary"]
    assert s["total_bill_raised_paise"] - s["total_received_paise"] == s["outstanding_paise"] - s["advance_paise"] == s["balance_paise"], s

def test_ledger_requires_auth():
    assert httpx.get(f"{API}/bookings/{IDS['ontime']}/ledger", timeout=30).status_code in (401, 403)
