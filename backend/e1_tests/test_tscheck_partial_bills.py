"""JRN-16 — every Partially Paid bill carries a paid_detail text (register, booking, customer 360 APIs)."""


def _all_demands(api):
    out, page = [], 1
    while True:
        d = api.get("/payments/demands", params={"page_size": 200, "page": page}).json()
        out += d["items"]
        if not d["items"] or len(out) >= d.get("total", 0):
            return out
        page += 1


def test_partial_bills_have_detail(api):
    parts = [d for d in _all_demands(api) if d["status"] == "Partially Paid"]
    assert parts, "no Partially Paid bills in demo"
    for d in parts:
        b = api.get(f"/bookings/{d['booking_id']}").json()
        bd = [x for x in b["demands"] if x["id"] == d["id"]][0]
        assert bd.get("paid_detail") and ("part paid" in bd["paid_detail"] or "open" in bd["paid_detail"]), bd.get("paid_detail")
