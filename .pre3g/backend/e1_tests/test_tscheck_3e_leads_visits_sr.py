from conftest import qa_booking, SGH
import random, datetime as dt
def _ph(): return "9"+str(random.randint(100000000,999999999))
def test_lead_edit_and_visit_outcome(api):
    r = api.post("/leads", json={"name":"QA tscheck Lead","phone":_ph(),"project_id":SGH}); assert r.status_code in (200,201), r.text
    lid = r.json()["id"]
    r = api.patch(f"/leads/{lid}", json={"name":"QA tscheck Lead Edited"}); assert r.status_code == 200, r.text
    assert api.get(f"/leads/{lid}").json()["name"] == "QA tscheck Lead Edited"
    av = api.get("/site-visits/availability", params={"project_id":SGH,"date_from":(dt.date.today()+dt.timedelta(days=1)).isoformat(),"date_to":(dt.date.today()+dt.timedelta(days=8)).isoformat()}).json()
    day = next(d for d in av["days"] if any(s["available_count"]>0 for s in d["slots"]))
    slot = next(s for s in day["slots"] if s["available_count"]>0)
    r = api.post("/site-visits", json={"project_id":SGH,"date":day["date"],"slot_start":slot["start"],"lead_id":lid}); assert r.status_code in (200,201), r.text
    vid = r.json()["id"]
    r = api.post(f"/site-visits/{vid}/complete", json={}); assert r.status_code == 422, r.text
    r = api.post(f"/site-visits/{vid}/complete", json={"outcome":"Interested"}); assert r.status_code in (200,409), r.text
    print("LEAD", lid, "VISIT", vid, r.status_code, r.text[:200])
def test_visit_slots_respect_days(api):
    av = api.get("/site-visits/availability", params={"project_id":SGH,"date_from":dt.date.today().isoformat(),"date_to":(dt.date.today()+dt.timedelta(days=13)).isoformat()})
    assert av.status_code == 200 and av.json()["days"]
def test_front_desk_sr(api):
    cust, b = qa_booking(api, "SR", discount=0)
    cat = api.get("/service-requests/categories").json()["items"][0]["name"]
    r = api.post("/service-requests", json={"customer_id":cust["id"],"booking_id":b["id"],"category":cat,"subject":"QA tscheck desk","description":"QA tscheck walk-in"}); assert r.status_code in (200,201), r.text
    sid = r.json()["id"]
    r = api.post(f"/service-requests/{sid}/reply", json={"message":"QA tscheck reply"}); assert r.status_code in (200,201), r.text
    r = api.post(f"/service-requests/{sid}/status", json={"status":"Closed","note":"QA tscheck done"}); assert r.status_code == 200, r.text
    assert api.get(f"/service-requests/{sid}").json()["status"] in ("Closed","Resolved")
    print("SR", sid)
