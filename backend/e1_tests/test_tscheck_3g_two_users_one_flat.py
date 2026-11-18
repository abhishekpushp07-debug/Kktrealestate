import httpx
from conftest import login, qa_customer, parallel, booking_on_flat, avail_flats, ORION, BASE, CREATED

def test_two_parallel_bookings_one_flat():
    a, s = login("admin@kkt.in"), login("sales@kkt.in")
    flats = avail_flats(a, ORION)[:3]
    assert len(flats) == 3
    for f in flats:
        ba = booking_on_flat(a, "tscheck-3g-race-a", f); bb = booking_on_flat(a, "tscheck-3g-race-b", f)
        ra, rb = parallel(lambda: a.post("/bookings", json=ba), lambda: s.post("/bookings", json=bb))
        codes = sorted([ra.status_code, rb.status_code])
        ok = [r for r in (ra, rb) if r.status_code < 300]; bad = [r for r in (ra, rb) if r.status_code >= 300]
        assert len(ok) == 1 and len(bad) == 1, (codes, ra.text[:200], rb.text[:200])
        assert 400 <= bad[0].status_code < 500, bad[0].text[:300]
        print("loser:", bad[0].status_code, bad[0].text[:200])
        CREATED.append(("booking", ok[0].json()["booking_number"], ok[0].json()["id"]))
        live = [b for b in a.get("/bookings", params={"project_id": f["project_id"], "page_size": 200}).json()["items"]
                if b["flat_id"] == f["id"] and b["status"] == "Active"]
        assert len(live) == 1, len(live)
        fl = a.get(f"/flats/{f['id']}").json()
        assert fl["status"] == "Booked", fl["status"]
