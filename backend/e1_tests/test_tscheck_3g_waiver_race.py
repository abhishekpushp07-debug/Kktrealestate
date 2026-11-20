from conftest import login, qa_booking, parallel

def _waiver(c, bid):
    r = login("accounts@kkt.in").post("/waivers", json={"booking_id":bid,"target":{"kind":"share","share":"Account"},"amount":1000,"reason":"tscheck-3g-waiver"})
    assert r.status_code in (200,201), r.text
    assert r.json()["status"] == "Pending", r.json()["status"]
    return r.json()

def test_waiver_approve_twice_and_approve_vs_reject():
    a, b = login("admin@kkt.in"), login("admin@kkt.in", fresh=True)
    _, bk = qa_booking(a, "tscheck-3g-wv", discount=0)
    for i in range(3):
        w = _waiver(a, bk["id"])
        r1, r2 = parallel(lambda: a.post(f"/waivers/{w['id']}/approve", json={}), lambda: b.post(f"/waivers/{w['id']}/approve", json={}))
        codes = sorted([r1.status_code, r2.status_code])
        assert codes == [200, 409], (codes, r1.text[:200], r2.text[:200])
        allw = [x for x in a.get("/waivers", params={"page_size":200}).json()["items"] if x["id"] == w["id"]]
        assert len(allw) == 1 and allw[0]["status"] == "Approved" and allw[0].get("cn_number")
    for i in range(3):
        w = _waiver(a, bk["id"])
        r1, r2 = parallel(lambda: a.post(f"/waivers/{w['id']}/approve", json={}), lambda: b.post(f"/waivers/{w['id']}/reject", json={"reason":"tscheck-3g race"}))
        x = [x for x in a.get("/waivers", params={"page_size":200}).json()["items"] if x["id"] == w["id"]][0]
        print(r1.status_code, r2.status_code, x["status"], x.get("cn_number"))
        assert sorted([r1.status_code, r2.status_code])[1] == 409
        assert not (x["status"] == "Rejected" and x.get("cn_number")), x
    cns = [x["cn_number"] for x in a.get("/waivers", params={"page_size":500}).json()["items"] if x.get("cn_number")]
    assert len(cns) == len(set(cns))
