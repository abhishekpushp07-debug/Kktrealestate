"""JRN-47: global search returns grouped results fast."""
import time


def test_search_grouped(api):
    for q, grp in [("Priya Verma", "customers"), ("9431023456", "customers"),
                   ("BK-2526-2331", "bookings"), ("KKT/2526/15134", "receipts"), ("C-1604", "flats")]:
        t = time.time()
        r = api.get("/search", params={"q": q})
        ms = (time.time() - t) * 1000
        assert r.status_code == 200, r.text
        types = [g["type"] for g in r.json()["groups"] if g["items"]]
        assert grp in types, (q, types)
        assert ms < 400, (q, ms)
    r = api.get("/search", params={"q": "zzqxnonsense"})
    assert r.status_code == 200 and not any(g["items"] for g in r.json()["groups"])
