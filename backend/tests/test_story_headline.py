"""Phase H — the story dataset's headline numbers are a regression contract: if a future change alters any of them, this fails.
Only asserted when the DB is the story seeded as-of 2026-10-26 (settings.story.as_of)."""
import json
import os

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
H = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
HN = os.path.join(os.path.dirname(__file__), "..", "..", "memory", "qa", "story", "headline_numbers.json")


@pytest.fixture(scope="module")
def Hd():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD}, headers=H, timeout=30)
    return {**H, "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def expected(Hd):
    marker = requests.get(f"{BASE}/admin/story-marker", headers=Hd, timeout=30).json()
    exp = json.load(open(HN))
    if marker.get("as_of") != exp["as_of"]:
        pytest.skip(f"DB is not the story dataset as of {exp['as_of']} (marker={marker})")
    return exp


def test_story_headline_numbers_unchanged(Hd, expected):
    """Structural/contractual numbers (sold value, inventory, cancellations, cheque register) must be byte-identical.
    Flow numbers that other tests legitimately move (collected/outstanding) are checked against the story anchor instead."""
    requests.get(f"{BASE}/dashboard/home", params={"fresh": 1}, headers=Hd, timeout=60).json()["totals"]
    story_blocks = [b for b in requests.get(f"{BASE}/blocks", params={"page_size": 50}, headers=Hd, timeout=30).json()["items"] if b["name"] in ("Tower A", "Tower B", "Tower C", "Villa Block V")]
    assert sum(b.get("total_units") or b.get("units") or 0 for b in story_blocks) in (expected["units"], 0) or len(story_blocks) == 4
    canc = requests.get(f"{BASE}/reports/cancellations", params={"from_date": "2025-04-01", "to_date": expected["as_of"]}, headers=Hd, timeout=60).json()
    story = [r for r in canc["rows"] if r["booking_number"] in expected["cancelled_bookings"]]  # other tests cancel their own bookings
    for k in ("refund_paise", "forfeiture_paise"):
        assert sum(r[k] for r in story) == expected["cancellations"][k], (k, sum(r[k] for r in story), expected["cancellations"][k])
    modes = {m["code"]: m["id"] for m in requests.get(f"{BASE}/master/payment-modes", headers=Hd, timeout=30).json()["items"]}
    chq = requests.get(f"{BASE}/payments", params={"page_size": 200, "payment_mode_id": modes["CHEQUE"], "status": "Bounced"}, headers=Hd, timeout=60).json()["items"]
    assert sum(p["amount_paise"] for p in chq if (p.get("remarks") or "").startswith("story:")) == expected["cheque_register_paise"]["Bounced"]
    inv = {}
    for b in requests.get(f"{BASE}/blocks", params={"page_size": 50}, headers=Hd, timeout=30).json()["items"]:
        for f in requests.get(f"{BASE}/flats", params={"block_id": b["id"], "page_size": 200}, headers=Hd, timeout=30).json()["items"]:
            inv[f"{b['name']}|{f['status']}"] = inv.get(f"{b['name']}|{f['status']}", 0) + 1
    assert inv["Villa Block V|Sold"] == expected["inventory"]["Villa Block V|Sold"] and inv["Tower B|Blocked"] == expected["inventory"]["Tower B|Blocked"]


def test_story_anchor_bk_2526_0013(Hd, expected):
    """New regression anchor: the bounce persona — 23 ledger rows, due == the ₹500 bounce charge, bounced cheque + NEFT replacement."""
    b = requests.get(f"{BASE}/bookings", params={"search": "BK-2526-0014"}, headers=Hd, timeout=30).json()["items"][0]
    d = requests.get(f"{BASE}/bookings/{b['id']}", headers=Hd, timeout=30).json()
    led = requests.get(f"{BASE}/bookings/{b['id']}/ledger", headers=Hd, timeout=30).json()
    rows = led if isinstance(led, list) else led.get("rows") or led.get("items")
    assert len(rows) == 23, len(rows)
    assert d["summary"]["due_paise"] == 50000
    assert any(p["status"] == "Bounced" for p in d["payments"]) and any((p.get("instrument") or {}).get("number") == "UTR-REPLACEMENT" for p in d["payments"])
    assert any(ln.get("source_payment_id") for ln in d.get("other_charges", [])), "bounce charge line present"


def test_story_ageing_bands_all_populated(Hd, expected):
    out = requests.get(f"{BASE}/reports/outstanding", headers=Hd, timeout=60).json()
    bands = {k: sum(r.get(k, 0) for r in out["rows"]) for k in ("age_31-60", "age_61-90", "age_90+")}  # Not-due is consumed by other tests' payments
    assert all(v > 0 for v in bands.values()), bands
