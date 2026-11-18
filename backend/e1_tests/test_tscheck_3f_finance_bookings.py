def T(api, k, **p): return api.get(f"/reports/v3/{k}", params=p).json()
def test_collections_equals_bank_plus_cash(api):
    c = T(api, "collections")["totals"]
    b = T(api, "bank-receipts")["totals"]
    cash = T(api, "collections", bank="Cash")["totals"]
    assert b["count"] + cash["count"] == c["count"]
    assert b["total_paise"] + cash["total_paise"] == c["total_paise"], (b, cash, c)
def test_bills_vs_collection_equals_bills_raised(api):
    bv = T(api, "bills-vs-collection")["totals"]["demand_paise"]
    cs = T(api, "customer-status")["totals"]["bills_raised"]
    assert bv == cs, (bv, cs)
def test_booking_health_ties(api):
    h = T(api, "booking-health", page_size=500); cs = T(api, "customer-status")["totals"]
    assert h["totals"]["total_due"] == cs["total_due"] and h["totals"]["overdue_amount"] == cs["overdue_amount"]
    for r in h["rows"]:
        if r["health"] == "At risk" and r["pct_received"] >= 100: assert "other" in (r.get("why") or "").lower()
def test_booking_register_count(api):
    r = T(api, "booking-register", page_size=500)
    assert sum(1 for x in r["rows"] if x["booking_status"] != "Cancelled") == T(api, "customer-status")["count"]
