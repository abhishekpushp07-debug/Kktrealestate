"""Phase 3 chunk 3-1 (REQ-116/117, header fix): the booking page's More menu explains refusals with the server's own
rule, and the header, Overview and Ledger foot use one total and one Balance."""

import requests

from tests.conftest import BASE


def _get(h, p, **kw):
    r = requests.get(f"{BASE}/api{p}", headers=h, params=kw, timeout=60)
    r.raise_for_status()
    return r.json()


def test_actions_endpoint_reasons_match_the_handlers(admin_headers):
    act = _get(admin_headers, "/bookings", status="Active", page_size=20)["items"]
    can = _get(admin_headers, "/bookings", status="Cancelled", page_size=5)["items"]
    for b in act[:5]:
        a = _get(admin_headers, f"/bookings/{b['id']}/actions")
        assert set(a["actions"]) >= {"record_payment", "revise", "change_plan", "transfer", "cancel", "pay_refund"}
        assert a["actions"]["record_payment"] is None and a["actions"]["pay_refund"] == "No refund is due"
        if a["actions"]["change_plan"] and "already paid" in a["actions"]["change_plan"]:
            plan = next((p for p in a["plans"] if p["id"] != b.get("payment_plan_id")), None)
            if plan:  # the handler refuses with the same rule
                r = requests.post(
                    f"{BASE}/api/bookings/{b['id']}/payment-plan",
                    json={"payment_plan_id": plan["id"], "reason": "rule check"},
                    headers=admin_headers,
                    timeout=60,
                )
                assert r.status_code == 409 and r.json()["code"] == "PLAN_LOCKED"
    for b in can:
        a = _get(admin_headers, f"/bookings/{b['id']}/actions")["actions"]
        assert a["record_payment"] == f"Booking is {b['status']}" and a["cancel"] == f"Booking is {b['status']}"


def test_one_total_and_one_balance_header_overview_ledger(admin_headers):
    for b in _get(admin_headers, "/bookings", status="Active", page_size=15)["items"]:
        s = _get(admin_headers, f"/bookings/{b['id']}")["summary"]
        rows = _get(admin_headers, f"/bookings/{b['id']}/ledger")["rows"]
        udhar = sum(r.get("udhar") or 0 for r in rows)
        jama = sum(r.get("jama") or 0 for r in rows)
        waived = s.get("waived") or 0  # REQ-253: ledger Jama = received + waived
        assert abs(udhar - s["total_bill_raised"]) < 1 and abs(jama - waived - s["total_received"]) < 1
        assert abs((s["total_udhar"] - s["total_jama"]) - (s["outstanding"] - s["advance"])) < 1


def test_customer_activity_shows_each_receipt_once(admin_headers):
    """Carry-over: a payment writes a receipt row and a booking twin; Customer 360 › Activity keeps one."""
    for b in _get(admin_headers, "/bookings", status="Active", page_size=10)["items"]:
        ev = _get(admin_headers, f"/customers/{b['customer_id']}/events")["items"]
        seen = {}
        for r in ev:
            rn = (r.get("after") or {}).get("receipt_number")
            if r["action"] == "payment.post" and rn:
                seen[rn] = seen.get(rn, 0) + 1
        assert seen and all(n == 1 for n in seen.values()), {k: n for k, n in seen.items() if n > 1}
        return


def test_typed_lead_source_and_save_to_master_offer(admin_headers):
    """3E (REQ-133/134): a one-off source is typed straight on the lead; the 3rd use is offered "Save to master"."""
    import uuid

    tag = f"Hoarding {uuid.uuid4().hex[:5]}"
    ids = []
    for n in range(2):
        r = requests.post(
            f"{BASE}/api/leads",
            json={"name": f"Typed src {n}", "phone": f"+9197{uuid.uuid4().int % 10**8:08d}", "source": tag},
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code in (200, 201), r.text
        ids.append(r.json()["id"])
        first = _get(admin_headers, "/catalogues/lead_source/typed-value", value=tag)
        assert first["in_master"] is False and first["earlier_uses"] == n + 1
        assert first["offer"] is (n + 1 >= 2)
    known = _get(admin_headers, "/catalogues/lead_source/typed-value", value="walk-in")
    assert known["in_master"] and not known["offer"]
    for i in ids:
        requests.delete(f"{BASE}/api/leads/{i}", headers=admin_headers, timeout=60)
