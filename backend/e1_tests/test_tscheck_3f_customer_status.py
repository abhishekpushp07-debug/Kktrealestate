def test_customer_status_columns_and_bridge(api):
    d = api.get("/reports/v3/customer-status", params={"page_size":500}).json()
    labels = [c["label"] if isinstance(c, dict) else c for c in d["cols"]]
    assert labels == ['Customer name','Flat code','Agreement value','Cash component','Bills raised till date','Account received','Cash received','Account dues','Cash dues','Final status']
    t = d["totals"]
    assert t["agreement_value"] == t["cash_component"] + t["account_component"]
    assert t["account_dues"] + t["cash_dues"] + t["other_charges_due"] == t["total_due"]
    og = api.get("/reports/v3/customer-ageing").json()["totals"]
    assert og["total_due"] == t["total_due"] and og["overdue_amount"] == t["overdue_amount"]
    assert sum(r["account_dues"] for r in d["rows"]) == t["account_dues"]
def test_customer_status_as_of_changes(api):
    a = api.get("/reports/v3/customer-status").json()["totals"]["total_due"]
    b = api.get("/reports/v3/customer-status", params={"as_of":"2026-03-31"}).json()
    assert b["totals"]["total_due"] != a and "31 Mar 2026" in b["sentence"]
