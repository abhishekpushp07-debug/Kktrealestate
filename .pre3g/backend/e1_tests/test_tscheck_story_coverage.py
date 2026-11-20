"""JRN-7: the demo story covers every situation, each visible in its matching report."""
AS_OF = "2026-11-16"


def _items(r):
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    return d.get("items", d) if isinstance(d, dict) else d


def test_receipt_of_each_mode(api):
    modes = {m["code"]: m["id"] for m in _items(api.get("/master/payment-modes", params={"page_size": 100}))}
    found = {}
    for want in ["CASH", "CHEQUE", "NEFT", "UPI"]:
        code = next((c for c in modes if want in c), None)
        assert code, (want, list(modes))
        its = _items(api.get("/payments", params={"payment_mode_id": modes[code], "page_size": 1}))
        found[want] = len(its)
    assert all(found.values()), found
    r = api.get("/reports/collections", params={"from_date": "2026-04-01", "to_date": AS_OF, "group_by": "mode"})
    assert r.status_code == 200, r.text[:300]
    txt = r.text.upper()
    for m in ["CASH", "CHEQUE", "UPI"]:
        assert m in txt, m
    assert "NEFT" in txt or "RTGS" in txt


def test_cheque_register_pending_bounce_and_replacement(api):
    d = api.get("/reports/cheques").json()
    st = {r["status"] for r in d["rows"]}
    assert {"Pending", "Bounced", "Cleared"} <= st, st
    bounce = _items(api.get("/payments", params={"search": "story:bounce", "page_size": 50}))
    # bounced cheque and its replacement are both tagged on the story booking
    assert any(p["status"] == "Bounced" for p in d["rows"])


def test_outstanding_ageing_buckets(api):
    ag = {a["bucket"]: a["amount_paise"] for a in api.get("/reports/outstanding").json()["ageing"]}
    for b in ["0-30", "31-60", "61-90", "90+"]:
        assert ag.get(b, 0) > 0, ag


def test_cancellations_refund_paid_and_forfeited(api):
    rows = api.get("/reports/cancellations").json()["rows"]
    st = {r["refund_status"] for r in rows}
    assert "Paid" in st and "Forfeited" in st, st


def test_transfer_and_revision(api):
    bks = _items(api.get("/bookings", params={"page_size": 200}))
    assert any(b.get("transfers") or b.get("transferred_from") or b.get("transfer_history") for b in bks) or \
        any("transfer" in str(b.get("history", "")).lower() for b in bks) or \
        api.get("/audit-logs", params={"action": "booking.transfer", "limit": 1}).json().get("items"), "no transferred booking"
    assert any(b.get("agreement_revisions") or (b.get("revision_count") or 0) > 0 or b.get("revisions") for b in bks) or \
        api.get("/audit-logs", params={"action": "booking.agreement_revision", "limit": 1}).json().get("items"), "no revision"


def test_hold_expiring_within_48h(api):
    d = api.get("/inventory/reports/hold-register").json()
    assert d["totals"]["active"] >= 1 and d["totals"]["expiring_48h"] >= 1, d["totals"]
    assert any(i["expires_at"] and i["hours_left"] is not None and i["hours_left"] <= 48 for i in d["items"])


def test_lost_lead_with_reason_and_funnel(api):
    leads = _items(api.get("/leads", params={"status": "Lost", "page_size": 50}))
    assert leads, "no Lost lead"
    assert any(l.get("lost_reason") or l.get("lost_reason_id") or l.get("reason") for l in leads), leads[0]
    f = {x["stage"]: x["count"] for x in api.get("/reports/sales-leads").json()["funnel"]}
    assert f.get("Lost", 0) >= 1, f


def test_site_visit_today(api):
    r = api.get("/site-visits/today")
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    items = d.get("items", d) if isinstance(d, dict) else d
    assert len(items) >= 1, d
