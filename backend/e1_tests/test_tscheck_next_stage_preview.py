import pytest
from conftest import block_id
@pytest.mark.parametrize("tower,n,amt", [("Tower B",16,14683726.0),("Tower C",30,25123680.0)])
def test_plastering_preview(api, home, tower, n, amt):
    bid = block_id(home, "SGH", tower)
    c = api.get(f"/blocks/{bid}/construction").json()
    pend = [s for s in c["stages"] if s["status"] == "Pending"]
    assert pend[0]["name"] == "Plastering"
    bills_before = api.get("/reports/outstanding-v2").json()["totals"]["udhar_paise"]
    r = api.get(f"/blocks/{bid}/stages/{pend[0]['stage_id']}/preview"); assert r.status_code == 200
    p = r.json(); s = str(p)
    assert str(n) in s and (str(int(amt*100)) in s or str(amt) in s), s[:600]
    assert api.get("/reports/outstanding-v2").json()["totals"]["udhar_paise"] == bills_before
