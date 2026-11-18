"""JRN-17 — paid_parts backfill is idempotent; Outstanding total unchanged."""
import json


def _out(api):
    return api.get("/reports/outstanding-v2").json()["totals"]["outstanding_paise"]


def test_backfill_twice(api):
    o0 = _out(api)
    r1 = api.post("/admin/backfill-paid-parts", json={}, timeout=280)
    assert r1.status_code == 200, r1.text
    o1 = _out(api)
    r2 = api.post("/admin/backfill-paid-parts", json={}, timeout=280)
    assert r2.status_code == 200, r2.text
    o2 = _out(api)
    print("RUN1", json.dumps(r1.json())[:400]); print("RUN2", json.dumps(r2.json())[:400])
    assert r2.json().get("changed") == 0, r2.json()
    assert o0 == o1 == o2, (o0, o1, o2)
