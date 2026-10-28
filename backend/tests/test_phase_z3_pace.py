"""Z.3 — weekly sold series per tower: sums tie out to sold (real), cancellation removes from its week, sales payload has no real-only keys."""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ["TEST_PASSWORD"]}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def _ts(H, pid, view="real", weeks=12):
    r = requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": view, "weeks": weeks}, headers=H, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def test_weekly_series_ties_out_and_cancel_removes_from_week():
    A = _hdr("admin@kkt.in")
    pid = next(p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=A, timeout=30).json()["items"] if p.get("code") == "SGH")["id"]
    d = _ts(A, pid, "real", 52)
    assert len(d["weeks"]) == 52 and all(len(t["series"]) == 52 for t in d["towers"])
    for t in d["towers"]:
        assert sum(t["series"]) <= t["sold"] and t["last4"] == sum(t["series"][-4:]) and t["pace"] in ("fast", "steady", "slow")
        if t["last4"] == 0 and t["available"] > 0:
            assert t["pace"] == "slow"
    assert d["total"]["series"] == [sum(t["series"][i] for t in d["towers"]) for i in range(52)]
    # book today in a selling tower → this week's bucket +1 for that tower; cancel → back to baseline
    sold_blocks = {t["block_id"]: t for t in d["towers"] if t["sold"] > 0}
    flats = requests.get(f"{BASE}/api/flats?project_id={pid}&status=Available&page_size=200", headers=A, timeout=30).json()["items"]
    flat = next(f for f in flats if f.get("bookable") is not False and f["block_id"] in sold_blocks)
    before = sold_blocks[flat["block_id"]]["series"][-1]
    tag = uuid.uuid4().hex[:6]
    cid = requests.post(f"{BASE}/api/customers", json={"full_name": f"Z3 Buyer {tag}", "phone": f"9{tag.encode().hex()[:9]}"}, headers=A, timeout=30).json()["id"]
    plans = requests.get(f"{BASE}/api/projects/{pid}/blocks/{flat['block_id']}/payment-plans", headers=A, timeout=30).json()["items"]
    body = {"flat_id": flat["id"], "customer_id": cid, "booking_date": date.today().isoformat(), "agreement_value": 2500000, "cash_agreed": 500000, "account_agreed": 2000000, "payment_plan_id": plans[0]["id"] if plans else None}
    r = requests.post(f"{BASE}/api/bookings", json=body, headers={**A, "Idempotency-Key": str(uuid.uuid4())}, timeout=60)
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    row = next(t for t in _ts(A, pid, "real", 52)["towers"] if t["block_id"] == flat["block_id"])
    assert row["series"][-1] == before + 1
    assert requests.post(f"{BASE}/api/bookings/{bid}/cancel", json={"reason": "Z.3 test artefact", "deduction": 0, "refund": 0}, headers={**A, "Idempotency-Key": str(uuid.uuid4())}, timeout=60).status_code == 200
    row = next(t for t in _ts(A, pid, "real", 52)["towers"] if t["block_id"] == flat["block_id"])
    assert row["series"][-1] == before  # cancelled booking falls out of the week it was booked


def test_sales_payload_has_no_real_only_keys():
    S = _hdr("sales@kkt.in")
    pid = next(p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=S, timeout=30).json()["items"] if p.get("code") == "SGH")["id"]
    d = _ts(S, pid, "real")
    assert d["view"] == "display" and d["can_toggle"] is False
    for t in d["towers"]:
        assert not ({"landowner", "blocked", "booking_id", "status", "display_override"} & set(t))
        assert len(t["series"]) == 12 and "pace" in t and "last4" in t
    assert "landowner" not in d["total"]
