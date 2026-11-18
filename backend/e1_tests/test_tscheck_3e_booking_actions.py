from conftest import qa_booking
import datetime as dt, pytest
T = dt.date.today()
@pytest.fixture(scope="module")
def bk(api): return qa_booking(api, "Actions", discount=0, days_ago=10)[1]
def test_agreement_signed_dates(api, bk):
    r = api.post(f"/bookings/{bk['id']}/agreement-signed", json={"signed_on":(T+dt.timedelta(days=2)).isoformat()}); assert r.status_code == 422, r.text
    r = api.post(f"/bookings/{bk['id']}/agreement-signed", json={"signed_on":(T-dt.timedelta(days=30)).isoformat()}); assert r.status_code == 422, r.text
    r = api.post(f"/bookings/{bk['id']}/agreement-signed", json={"signed_on":(T-dt.timedelta(days=3)).isoformat()}); assert r.status_code == 200, r.text
def test_change_plan_reason(api, bk):
    plans = api.get(f"/projects/{bk['project_id']}/blocks/{bk['block_id']}/payment-plans").json()
    plans = plans.get("items", plans) if isinstance(plans, dict) else plans
    cur = api.get(f"/bookings/{bk['id']}").json().get("payment_plan_id")
    other = [p for p in plans if p.get("id") != cur]
    if not other: pytest.skip("only one plan for block")
    r = api.post(f"/bookings/{bk['id']}/payment-plan", json={"payment_plan_id":other[0]["id"],"reason":""}); assert r.status_code == 422
    r = api.post(f"/bookings/{bk['id']}/payment-plan", json={"payment_plan_id":other[0]["id"],"reason":"QA tscheck plan switch"}); assert r.status_code == 200, r.text
    a = api.get("/audit-logs", params={"entity_id":bk["id"]})
    assert "QA tscheck plan switch" in a.text, a.status_code
def test_unvoid_manual_bill(api, bk):
    r = api.post("/demands/manual", json={"booking_id":bk["id"],"name":"QA tscheck bill","cash_amount":1000,"due_date":T.isoformat()}); assert r.status_code in (200,201), r.text
    did = r.json().get("id") or r.json()["demand"]["id"]
    assert api.post(f"/demands/{did}/void", json={"reason":"QA tscheck void"}).status_code == 200
    assert api.post(f"/demands/{did}/unvoid", json={}).status_code == 422
    r = api.post(f"/demands/{did}/unvoid", json={"reason":"QA tscheck restore"}); assert r.status_code == 200, r.text
    a = api.get("/audit-logs", params={"entity_id":did}); assert "QA tscheck restore" in a.text, a.text[:300]
