"""E1 (JRN-8/36): ONE outstanding number — Home 'Due ageing' == Outstanding & ageing report per band, to the paisa;
the Demand register shows the bridge from its raised-bills total to Outstanding."""

import time

import pytest
import requests

from tests.conftest import BASE as ROOT
from tests.conftest import TEST_PASSWORD, session_token

API = f"{ROOT}/api"
KEYS = {"Not due": "not_due", "0-30": "d0_30", "31-60": "d31_60", "61-90": "d61_90", "90+": "d90"}


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"}


def _pair(h):
    home = requests.get(f"{API}/dashboard/home", headers=h, timeout=60).json()
    rep = requests.get(f"{API}/reports/outstanding-v2", headers=h, timeout=60).json()
    return home, rep


@pytest.mark.load_sensitive
def test_home_ageing_equals_outstanding_report_per_band():
    h = _h()
    for _ in range(8):  # Home has a 10 s cache: a write by another test just before this one can still be in it
        home, rep = _pair(h)
        want = {a["bucket"]: a["amount_paise"] for a in rep["ageing"]}
        got = {b: home["ageing_paise"][k] for b, k in KEYS.items()}
        if got == want:
            break
        time.sleep(2)
    assert got == want
    assert sum(home["ageing_paise"].values()) == rep["totals"]["outstanding_paise"]


@pytest.mark.load_sensitive
def test_demand_register_reconciles_to_outstanding():
    h = _h()
    for _ in range(8):
        reg = requests.get(f"{API}/demands/register", headers=h, timeout=60).json()
        rep = requests.get(f"{API}/reports/outstanding-v2", headers=h, timeout=60).json()
        r = reg["reconcile"]
        if r["outstanding_paise"] == rep["totals"]["outstanding_paise"]:
            break
        time.sleep(4)  # register cache is 30 s
    assert "Raised bills only" in r["basis"]
    assert r["bills_open_paise"] + r["other_charges_due_paise"] + r["adjustment_paise"] == r["outstanding_paise"]
    assert r["outstanding_paise"] == rep["totals"]["outstanding_paise"]


def test_collections_buckets_net_of_reversals_tie_to_net_received():
    """E9: Cash + Account + Other == Net received (reversals netted in their own bucket), row by row and in total."""
    h = _h()
    c = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2025-04-01", "to_date": "2027-03-31"},
        timeout=60,
    ).json()
    for r in c["rows"] + [c["totals"]]:
        assert r["cash_paise"] + r["account_paise"] + r["other_paise"] == r["total_paise"], r.get("group")
