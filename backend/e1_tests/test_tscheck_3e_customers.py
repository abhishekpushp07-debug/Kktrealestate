from conftest import qa_booking, qa_customer
import random
def _pan(): return "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(5))+str(random.randint(1000,9999))+"Q"
def test_deactivate_rules(api):
    cust, b = qa_booking(api, "Deact", discount=0)
    r = api.post(f"/customers/{cust['id']}/deactivate", json={"reason":"QA tscheck"}); assert r.status_code in (409,422), r.text
    assert "booking" in r.text.lower()
    c2 = qa_customer(api, "Deact2")
    r = api.post(f"/customers/{c2['id']}/deactivate", json={"reason":"QA tscheck"}); assert r.status_code == 200, r.text
    assert api.get(f"/customers/{c2['id']}").json()["is_active"] is False
    r = api.post(f"/customers/{c2['id']}/reactivate", json={"reason":"QA tscheck back"}); assert r.status_code == 200, r.text
    assert api.get(f"/customers/{c2['id']}").json()["is_active"] is True
def test_duplicate_pan_warns(api):
    p = _pan(); c = qa_customer(api, "Pan", pan=p)
    r = api.get("/customers/check-duplicate", params={"pan":p}); assert r.status_code == 200
    assert c["id"] in r.text, r.text[:300]
def test_merge(api):
    s, b = qa_booking(api, "MergeSurv", discount=0)
    m = qa_customer(api, "MergeOld")
    r = api.post("/customers/merge", json={"survivor_id":s["id"],"merged_id":m["id"],"reason":"QA tscheck dup"})
    assert r.status_code == 200, r.text
    old = api.get(f"/customers/{m['id']}").json()
    assert s["id"] in str(old), str(old)[:400]
    r = api.get("/customers", params={"search":m["customer_code"]}); assert s["id"] in r.text, r.text[:400]
    print("MERGED", m["customer_code"], "->", s["customer_code"])
def test_merge_two_pans_refused(api):
    a = qa_customer(api, "PanA", pan=_pan()); b = qa_customer(api, "PanB", pan=_pan())
    for x in (a, b):
        r = api.post(f"/customers/{x['id']}/kyc-status", json={"kyc_status":"Verified"}); assert r.status_code == 200, r.text
    r = api.post("/customers/merge", json={"survivor_id":a["id"],"merged_id":b["id"],"reason":"QA tscheck"})
    assert r.status_code in (409,422), (r.status_code, r.text)
