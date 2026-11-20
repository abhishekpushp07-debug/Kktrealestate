import requests


def _get(base_url, h, path, **params):
    r = requests.get(f"{base_url}/api{path}", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_plan_timeline_rows_match_plan_and_bills(base_url, admin_headers):
    b = _get(base_url, admin_headers, "/bookings", page_size=1, status="Active")["items"][0]
    t = _get(base_url, admin_headers, f"/bookings/{b['id']}/plan-timeline")
    full = _get(base_url, admin_headers, f"/bookings/{b['id']}")
    inst = sorted((full.get("payment_plan_snapshot") or {}).get("installments") or [], key=lambda i: i["seq"])
    assert [r["seq"] for r in t["rows"]] == [i["seq"] for i in inst]
    assert sum(t["counts"].values()) == len(t["rows"])
    for r in t["rows"]:
        assert r["bill"]["state"] in {"paid", "part_paid", "overdue", "billed", "not_billed"}
        if r["bill"]["state"] != "not_billed":
            assert r["amount_is_estimate"] is False
            assert r["bill"]["open_paise"] == max(r["bill"]["billed_paise"] - r["bill"]["paid_paise"], 0)
        if r["trigger_type"] == "ON_STAGE":
            assert r["stage"]["state"] in {"completed", "awaiting"}


def test_list_segment_counts(base_url, admin_headers):
    for path in ("/bookings", "/projects"):
        res = _get(base_url, admin_headers, path, page_size=1)
        allc = _get(base_url, admin_headers, path, page_size=1, with_total="true")
        assert isinstance(res["status_counts"], dict)
        if allc.get("total") is not None and path == "/projects":
            assert sum(res["status_counts"].values()) == allc["total"]
