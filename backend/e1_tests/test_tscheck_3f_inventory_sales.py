from conftest import login
def test_inventory_186_and_sales_layer(api):
    a = api.get("/reports/v3/stacking-plan").json()["totals"]
    assert a["flats"] == api.get("/reports/v3/inventory-status").json()["totals"]["flats"] == 186
    s = login("sales@kkt.in")
    d = s.get("/reports/v3/stacking-plan", params={"page_size":500}).json()
    assert {r["status"] for r in d["rows"]} <= {"Available","Hold","Sold"}
    assert not any(k in r for r in d["rows"] for k in ("customer_name","customer","received_paise"))
    assert s.get("/reports/v3/project-statement").status_code == 403
    assert s.get("/reports/v3/collections").status_code == 403
