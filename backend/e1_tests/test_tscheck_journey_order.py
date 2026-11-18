import pytest
TODAY = "2026-11-16"
# role-tagged anchors from demo_journeys.md: story:ontime Tower A, story:ontime Tower C, story:fullpaid GGV
CASES = [("BK-2526-1348", 710162.0), ("BK-2526-1349", 741144.0), ("BK-2526-1352", 668436.0)]
@pytest.mark.parametrize("num,balance", CASES)
def test_journey(api, num, balance):
    bk = [b for b in api.get("/bookings", params={"search": num, "limit": 5}).json()["items"] if b["booking_number"] == num][0]
    if bk.get("lead_id"):
        lead = api.get(f"/leads/{bk['lead_id']}")
        if lead.status_code == 200:
            assert lead.json()["created_at"][:10] <= bk["booking_date"]
    led = api.get(f"/bookings/{bk['id']}/ledger").json()
    rows = led["rows"]
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates) and dates[0] == bk["booking_date"] and max(dates) <= TODAY
    assert rows[0]["type"] == "DEMAND"
    stage_dates = {s["completed_on"] for s in api.get(f"/blocks/{bk['block_id']}/construction").json()["stages"] if s.get("completed_on")}
    for r in rows:
        if r["type"] == "DEMAND" and r["date"] != bk["booking_date"]:
            assert any(sd <= r["date"] for sd in stage_dates), r
    net = sum(r["bill_raised_paise"] for r in rows) - sum(r["received_paise"] for r in rows)
    assert net == rows[-1]["balance_paise"] == round(balance * 100), (net, rows[-1]["balance_paise"])
def test_no_activity_dated_after_today(home):
    future = [r for r in home["recent"] if r["created_at"][:10] > TODAY]
    assert not future, f"{len(future)} recent-activity rows dated after {TODAY}: {future[0]['action']} {future[0]['created_at']}"
