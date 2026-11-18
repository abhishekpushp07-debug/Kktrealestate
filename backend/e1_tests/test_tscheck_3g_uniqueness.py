from conftest import login
def test_uniqueness_rules_applied():
    c = login("admin@kkt.in")
    u = c.get("/admin/ops").json()["uniqueness"]
    keys = {x["key"]: x["status"] for x in u}
    for k in ["waiver number","credit-note number","refund number","ledger line (booking + sequence)","one live booking per flat"]:
        assert keys.get(k) == "applied", (k, keys)
    assert not any("dup" in str(x).lower() for x in u), u
