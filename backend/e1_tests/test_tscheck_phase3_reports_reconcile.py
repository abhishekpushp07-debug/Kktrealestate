import httpx
from conftest import BASE

def test_outstanding_bands_and_net(api):
    t = api.get("/reports/outstanding-v2").json()["totals"]
    bands = sum(v for k, v in t.items() if k.startswith("band_"))
    assert bands == t["outstanding_paise"]
    assert t["outstanding_paise"] - t["advance_paise"] == t["net_balance_paise"]
    assert t["bill_raised_paise"] - t["received_paise"] == t["net_balance_paise"]

def test_collections_carried_closing_equals_outstanding_net(api):
    c = api.get("/reports/collections-v2").json()["carried"]
    assert c["opening_paise"] + c["billed_paise"] - c["received_paise"] == c["closing_paise"]
    net = api.get("/reports/outstanding-v2").json()["totals"]["net_balance_paise"]
    assert c["closing_paise"] == net

def test_segments_add_up(api):
    c = api.get("/customers/segments").json()["counts"]
    assert c["overdue"] + c["on_track"] + c["clear"] + c["advance_only"] + c["no_booking"] == c["all"]

def test_reports_require_auth():
    assert httpx.get(f"{BASE}/reports/outstanding-v2", timeout=30).status_code in (401, 403)
