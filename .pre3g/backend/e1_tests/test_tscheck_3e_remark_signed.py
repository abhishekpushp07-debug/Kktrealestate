from conftest import qa_booking
import datetime as dt
T = dt.date.today()


def test_remark_refused_and_correct_needs_reason(api):
    _, b = qa_booking(api, "Remark", days_ago=10)
    bid = b["id"]
    d1 = (T - dt.timedelta(days=3)).isoformat()
    r = api.post(f"/bookings/{bid}/agreement-signed", json={"signed_on": d1}); assert r.status_code == 200, r.text
    r = api.post(f"/bookings/{bid}/agreement-signed", json={"signed_on": (T - dt.timedelta(days=2)).isoformat()})
    assert r.status_code == 409 and "ALREADY_SIGNED" in r.text, r.text
    bk = api.get(f"/bookings/{bid}").json()
    assert d1 in str(bk), "signed_on changed"
    d2 = (T - dt.timedelta(days=4)).isoformat()
    r = api.post(f"/bookings/{bid}/agreement-signed/correct", json={"signed_on": d2})
    assert r.status_code == 422, r.text
    r = api.post(f"/bookings/{bid}/agreement-signed/correct", json={"signed_on": d2, "reason": "QA tscheck wrong date typed"})
    assert r.status_code == 200, r.text
    bk = api.get(f"/bookings/{bid}").json()
    assert d2 in str(bk)
    a = api.get(f"/audit-logs/entity/booking/{bid}")
    print("AUDIT", a.status_code, a.text[:300])
    assert "QA tscheck wrong date typed" in a.text, a.text[:300]
