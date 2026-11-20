import datetime
from conftest import login, parallel, booking_on_flat, avail_flats, VILLA_P, CREATED

def test_stage_completed_twice_at_once():
    a, b = login("admin@kkt.in"), login("admin@kkt.in", fresh=True)
    flats = avail_flats(a, VILLA_P)
    assert len(flats) >= 2, "no villa P flats left"
    bids = []
    for f in flats[:2]:
        r = a.post("/bookings", json=booking_on_flat(a, "tscheck-3g-stage", f)); assert r.status_code in (200,201), r.text
        bids.append(r.json()["id"]); CREATED.append(("booking", r.json()["booking_number"], r.json()["id"]))
    bk = a.get(f"/bookings/{bids[0]}").json()
    trig = [i["trigger_stage_id"] for i in bk["payment_plan_snapshot"]["installments"] if i["trigger_type"]=="ON_STAGE"]
    stages = a.get(f"/blocks/{VILLA_P}/construction").json()["stages"]
    pend = [s for s in stages if s["status"] != "Completed" and s["stage_id"] in trig]
    assert pend, "no pending trigger stage"
    sid = pend[0]["stage_id"]
    before = {x: len(a.get(f"/bookings/{x}").json().get("demands") or []) for x in bids}
    body = {"stage_id": sid, "completed_on": datetime.date.today().isoformat(), "notes": "tscheck-3g-stage"}
    r1, r2 = parallel(lambda: a.post(f"/blocks/{VILLA_P}/construction/stage", json=body), lambda: b.post(f"/blocks/{VILLA_P}/construction/stage", json=body))
    codes = sorted([r1.status_code, r2.status_code])
    loser = r1 if r1.status_code >= 300 else r2
    print(codes, loser.text[:200])
    assert codes[0] < 300 and codes[1] == 409, (codes, r1.text[:200], r2.text[:200])
    allnums = []
    for x in bids:
        d = a.get(f"/bookings/{x}").json().get("demands") or []
        assert len(d) == before[x] + 1, (x, before[x], len(d))
        seqs = [y.get("installment_seq") for y in d if not y.get("voided")]
        assert len(seqs) == len(set(seqs))
        allnums += [y.get("demand_number") for y in d]
    assert len(allnums) == len(set(allnums))
