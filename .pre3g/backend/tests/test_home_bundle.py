"""Phase 2D (REQ-91…110): every Home number drills to a list whose total equals it exactly; roles only ever get the
widgets their permissions allow (server-side); one widget's failure never blanks the others."""

import os

import pytest
import requests

from tests.conftest import BASE, TEST_PASSWORD, session_token

ROLES = {
    "admin@kkt.in": None,
    "accounts@kkt.in": {"money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "attention"},
    "sales@kkt.in": {"call_today", "pipeline", "inventory", "flat_status"},
    "siteengineer@kkt.in": {"next_milestone", "construction", "flat_status"},
}


def _h(email):
    return {"Authorization": f"Bearer {session_token(email, TEST_PASSWORD)}"}


import sys as _sys  # noqa: E402

_sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from home_numbers import numbers as _numbers  # noqa: E402,F401
from home_numbers import pick as _pick


@pytest.mark.load_sensitive  # list totals vs widget numbers: no other worker may write in between
@pytest.mark.parametrize("email", list(ROLES))
@pytest.mark.parametrize("period", ["today", "month", "fy"])
def test_every_home_number_ties_to_its_list(email, period):
    H = _h(email)
    b = requests.get(f"{BASE}/api/home/bundle", params={"period": period}, headers=H, timeout=60)
    assert b.status_code == 200, b.text
    w = b.json()["widgets"]
    bad = [k for k, v in w.items() if not v["ok"]]
    assert not bad, bad
    checked = 0
    for wid, v in w.items():
        for n in _numbers(v["data"], []):
            path, params = n["drill"]["api"]
            r = requests.get(f"{BASE}/api{path}", params=params, headers=H, timeout=60)
            assert r.status_code == 200, (wid, path, r.status_code, r.text[:200])
            want = (
                n["amount_paise"]
                if "amount_paise" in n and not n["drill"]["pick"].endswith("count")
                else n.get("count", n.get("amount_paise"))
            )
            got = _pick(r.json(), n["drill"]["pick"])
            assert got == want, f"{email} {period} {wid}: {path} {params} {n['drill']['pick']} = {got} ≠ widget {want}"
            checked += 1
    assert checked or email == "siteengineer@kkt.in"


@pytest.mark.parametrize("email,expected", list(ROLES.items()))
def test_role_widgets_are_enforced_server_side(email, expected):
    H = _h(email)
    lay = requests.get(f"{BASE}/api/me/home-layout", headers=H, timeout=30).json()
    avail = {a["id"] for a in lay["available"]}
    if expected is None:
        assert len(avail) == 11
        return
    assert expected <= avail
    if email == "sales@kkt.in":
        assert avail == expected  # owner decision: Sales gets these four ONLY
    got = set(requests.get(f"{BASE}/api/home/bundle", headers=H, timeout=60).json()["widgets"])
    assert got <= avail
    denied = [i for i in ("money_today", "ageing", "pipeline", "next_milestone") if i not in avail]
    for i in denied:
        r = requests.put(f"{BASE}/api/me/home-layout", json={"widgets": [{"id": i}]}, headers=H, timeout=30)
        assert r.status_code == 403, (email, i, r.status_code)


@pytest.mark.load_sensitive  # bundle vs a fresh report: no other worker may post a receipt in between
def test_ageing_widget_equals_outstanding_report_to_the_rupee(admin_headers):
    w = requests.get(f"{BASE}/api/home/bundle", headers=admin_headers, timeout=60).json()["widgets"]["ageing"]["data"]
    rep = requests.get(f"{BASE}/api/reports/outstanding-v2", headers=admin_headers, timeout=60).json()
    assert w["total"]["amount_paise"] == rep["totals"]["outstanding_paise"]
    assert {r["bucket"]: r["amount_paise"] for r in rep["ageing"]} == {
        v["label"]: v["amount_paise"] for k, v in w.items() if "label" in v
    }


def test_one_widget_failure_is_isolated():
    import asyncio

    from routers.home_defs import guarded

    async def boom(*_):
        raise RuntimeError("x")

    async def fine(*_):
        return {"n": 1}

    async def go():
        return await asyncio.gather(guarded(boom), guarded(fine))

    a, b = asyncio.run(go())
    assert a == {"ok": False, "error": "Couldn't load", "detail": "RuntimeError"} and b == {
        "ok": True,
        "data": {"n": 1},
    }


def test_saved_and_reset_layout_reach_the_bundle_at_once():
    """Saving / resetting Customize must not be hidden by the 10 s Home bundle cache (iteration 37)."""
    H = _h("accounts@kkt.in")
    requests.get(f"{BASE}/api/home/bundle", headers=H, timeout=60)  # warm the cache
    lay = requests.get(f"{BASE}/api/me/home-layout", headers=H, timeout=30).json()
    ws = [{"id": w["id"], "visible": w["id"] != "inflow_30", "size": w.get("size", "M")} for w in lay["widgets"]]
    try:
        assert requests.put(f"{BASE}/api/me/home-layout", json={"widgets": ws}, headers=H, timeout=30).ok
        b = requests.get(f"{BASE}/api/home/bundle", headers=H, timeout=60).json()
        assert "inflow_30" not in b["widgets"]
        assert not next(w for w in b["layout"]["widgets"] if w["id"] == "inflow_30")["visible"]
    finally:
        assert requests.delete(f"{BASE}/api/me/home-layout", headers=H, timeout=30).ok
    b = requests.get(f"{BASE}/api/home/bundle", headers=H, timeout=60).json()
    assert "inflow_30" in b["widgets"]


def test_zero_bounced_drill_reads_zero(admin_headers):
    """P2-1 P4(b): a status with no receipts still appears in the totals as 0, so the 0-count drill ties."""
    t = requests.get(
        f"{BASE}/api/payments/summary",
        params={"status": "Bounced", "unreplaced": True, "date_from": "2001-01-01", "date_to": "2001-01-02"},
        headers=admin_headers,
        timeout=30,
    ).json()
    assert t["Bounced"]["count"] == 0 and t["Bounced"]["amount_paise"] == 0
