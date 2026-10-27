"""Pre-publish fixes: manual price override/revert rule, audit CSV humanised changes, construction preview no-dues reason."""
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.conftest import BASE  # noqa: E402


def _flat(h):
    rows = requests.get(f"{BASE}/api/flats", params={"page_size": 50, "status": "Available"}, headers=h).json()["items"]
    return next(f for f in rows if f.get("rate_per_sqft") and f.get("super_builtup_sqft") and (f.get("price_source") or "rate_card") == "rate_card")


def test_manual_price_override_then_revert_restores_rate_card_breakup(admin_headers):
    f = _flat(admin_headers)
    orig_breakup, orig_price = f["price_breakup"], f["price"]
    r = requests.patch(f"{BASE}/api/flats/{f['id']}", json={"price": orig_price + 50000, "version": f["version"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["price_source"] == "manual" and m["price_breakup"] == [{"label": "Manual price", "amount": orig_price + 50000}]
    assert m["rate_card_breakup"] == orig_breakup, "previous breakup must be retained while overridden"
    r = requests.patch(f"{BASE}/api/flats/{f['id']}", json={"price": orig_price, "version": m["version"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    back = r.json()
    assert back["price_source"] == "rate_card" and back["price_breakup"] == orig_breakup and back["price"] == orig_price and not back.get("rate_card_breakup")


def test_audit_csv_changes_are_rupees_not_paise(admin_headers):
    f = _flat(admin_headers)
    requests.patch(f"{BASE}/api/flats/{f['id']}", json={"price": f["price"] + 10000, "version": f["version"]}, headers=admin_headers)
    requests.patch(f"{BASE}/api/flats/{f['id']}", json={"price": f["price"], "version": f["version"] + 1}, headers=admin_headers)
    r = requests.get(f"{BASE}/api/audit-logs/export.csv", params={"entity_type": "flat", "entity_id": f["id"]}, headers=admin_headers)
    if r.status_code == 404:
        r = requests.get(f"{BASE}/api/audit-logs/export", params={"entity_type": "flat", "entity_id": f["id"]}, headers=admin_headers)
    assert r.status_code == 200, r.text[:200]
    body = r.text
    assert "Price: ₹" in body and "→ ₹" in body, body[:600]
    import re
    assert not re.search(r"Price: \d{7,}", body), "raw paise leaked into audit CSV changes column"
    assert "paise" not in body.splitlines()[0].lower()


def test_to_csv_never_emits_paise_columns():
    from utils import to_csv
    out = to_csv([{"a": 1, "amount_paise": 500, "amount": 5}])
    assert "amount_paise" not in out.splitlines()[0] and "amount" in out.splitlines()[0]
    out = to_csv([{"amount_paise": 500, "amount": 5}], ["amount", "amount_paise"])
    assert out.splitlines()[0] == "amount"


def test_construction_preview_states_no_dues_reason(admin_headers):
    blocks = requests.get(f"{BASE}/api/blocks", params={"page_size": 50}, headers=admin_headers).json()["items"]
    found = None
    for b in blocks:
        cs = requests.get(f"{BASE}/api/blocks/{b['id']}/construction", headers=admin_headers)
        if cs.status_code != 200:
            continue
        for s in cs.json()["stages"]:
            if s["status"] != "Completed":
                pv = requests.get(f"{BASE}/api/blocks/{b['id']}/stages/{s['stage_id']}/preview", headers=admin_headers).json()
                assert "no_dues_reason" in pv and "active_bookings" in pv
                if pv["bookings_count"] == 0:
                    found = (s["name"], pv)
                    break
        if found:
            break
    if found:
        name, pv = found
        assert pv["no_dues_reason"].startswith("No payment plan on this tower has an installment on") and "0 dues will be raised" in pv["no_dues_reason"] and f"({pv['active_bookings']} active booking" in pv["no_dues_reason"]
