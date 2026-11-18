from conftest import login
def test_hub_admin_5x10(api):
    d = api.get("/reports/v3").json()
    assert len(d["segments"]) == 5
    for s in d["segments"]:
        assert len(s["tiles"]) == 10 and all(t["live"] for t in s["tiles"])
    assert d["one_click"] == "customer-status" and d["control_room"]
def test_hub_sales_inventory_only():
    s = login("sales@kkt.in")
    keys = [t["key"] for seg in s.get("/reports/v3").json()["segments"] for t in seg["tiles"]]
    assert set(["inventory-status","stacking-plan","price-list","hold-register","parking","sales-velocity"]) <= set(keys)
    assert "project-statement" not in keys and "collections" not in keys
