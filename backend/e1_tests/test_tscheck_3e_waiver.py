from conftest import qa_booking, login
import pytest
@pytest.fixture(scope="module")
def wb(api):
    return qa_booking(api, "Waiver", discount=0)
def _sum(api, bid): return api.get(f"/bookings/{bid}/ledger").json()["booking"]["summary"]
def test_waiver_flow(api, wb):
    cust, b = wb; acc = login("accounts@kkt.in")
    s0 = _sum(api, b["id"])
    r = acc.post("/waivers", json={"booking_id":b["id"],"target":{"kind":"share","share":"Account"},"amount":10000,"reason":"QA tscheck goodwill"})
    assert r.status_code in (200,201), r.text
    w = r.json(); wid = w.get("id") or w.get("waiver",{}).get("id"); print("WAIVER", wid, w.get("status"))
    assert "pend" in str(w.get("status","")).lower(), w
    assert _sum(api, b["id"])["due_paise"] == s0["due_paise"]
    r = acc.post(f"/waivers/{wid}/approve", json={}); assert r.status_code in (403,409,422), ("accounts approved own", r.status_code, r.text)
    r = api.post(f"/waivers/{wid}/approve", json={}); assert r.status_code == 200, r.text
    aw = r.json(); print("APPROVED", str(aw)[:400])
    assert "CN" in str(aw).upper() or "credit" in str(aw).lower()
    s1 = _sum(api, b["id"])
    assert s1["due_paise"] < s0["due_paise"], (s0["due_paise"], s1["due_paise"])
    assert s1["total_received_paise"] == s0["total_received_paise"]; assert s1["waived_paise"] == 1050000, s1["waived_paise"]
    pdf = api.get(f"/waivers/{wid}/credit-note.pdf"); assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    r = api.post(f"/waivers/{wid}/cancel", json={"reason":"QA tscheck cancel"}); assert r.status_code == 200, r.text
    assert "cancel" in r.text.lower()
    assert _sum(api, b["id"])["due_paise"] == s0["due_paise"]
def test_waiver_over_open_and_reject(api, wb):
    cust, b = wb
    r = api.post("/waivers", json={"booking_id":b["id"],"target":{"kind":"share","share":"Account"},"amount":99999999,"reason":"QA tscheck too much"})
    assert r.status_code in (400,409,422), r.text
    acc = login("accounts@kkt.in")
    r = acc.post("/waivers", json={"booking_id":b["id"],"target":{"kind":"share","share":"Cash"},"amount":500,"reason":"QA tscheck rej"}); assert r.status_code in (200,201), r.text
    wid = r.json().get("id")
    assert api.post(f"/waivers/{wid}/reject", json={}).status_code == 422
    r = api.post(f"/waivers/{wid}/reject", json={"reason":"QA tscheck no"}); assert r.status_code == 200, r.text
def test_waiver_register_all_states(api):
    r = api.get("/reports/waiver-register"); assert r.status_code == 200
    t = r.text.lower()
    for s in ["pending","approved","rejected","cancelled"]: assert s in t, s
