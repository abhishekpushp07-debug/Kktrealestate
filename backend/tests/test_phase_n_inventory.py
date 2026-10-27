"""Phase N — inventory control: visibility shaping, saleability in the wizard, mandatory hold expiry, expiry sweep, category → counters/Journey, report tie-outs."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _sales_headers():
    try:
        return _login("sales@kkt.in", "Kkt@12345")
    except AssertionError:
        return None


def _avail_flats(h, n):
    import random
    rows = requests.get(f"{BASE}/api/flats", params={"status": "Available", "page_size": 200}, headers=h).json()["items"]
    rows = [f for f in rows if f.get("bookable", True) and not f.get("masked")]
    assert len(rows) >= n, len(rows)
    rows = rows[10:] if len(rows) > n + 10 else rows  # other modules mutate the first few Available flats under xdist; stay clear of them
    random.shuffle(rows)
    return rows[:n]


def _bulk(h, **body):
    return requests.post(f"{BASE}/api/inventory/bulk", json=body, headers=h)


def test_hold_requires_expiry_and_reason(admin_headers):
    f = _avail_flats(admin_headers, 1)[0]
    reason = requests.get(f"{BASE}/api/master/hold-reasons", headers=admin_headers).json()["items"][0]
    r = _bulk(admin_headers, flat_ids=[f["id"]], action="hold", reason_id=reason["id"])
    assert r.status_code == 422 and r.json()["code"] == "HOLD_EXPIRY_REQUIRED"
    r = _bulk(admin_headers, flat_ids=[f["id"]], action="hold", reason_id=reason["id"], expires_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    assert r.status_code == 422 and r.json()["code"] == "HOLD_EXPIRY_PAST"
    r = _bulk(admin_headers, flat_ids=[f["id"]], action="hold", reason_id=reason["id"], expires_at=(datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), note="t")
    assert r.status_code == 200 and r.json()["done"] == 1
    g = requests.get(f"{BASE}/api/flats/{f['id']}", headers=admin_headers).json()
    assert g["status"] == "Hold" and g["inventory_state"] == "Hold" and g["display_state"] == "Show as Hold" and g["hold"]["expires_at"]
    assert _bulk(admin_headers, flat_ids=[f["id"]], action="release").json()["done"] == 1


def test_masked_flat_indistinguishable_from_sold_for_non_privileged(admin_headers):
    sales = _sales_headers()
    f = _avail_flats(admin_headers, 1)[0]
    r = _bulk(admin_headers, flat_ids=[f["id"]], action="set_display", display_state="Show as Sold", reason="hold back")
    assert r.status_code == 200 and r.json()["done"] == 1
    priv = requests.get(f"{BASE}/api/flats/{f['id']}", headers=admin_headers).json()
    assert priv["status"] == "Available" and priv["inventory_state"] == "Available" and priv["display_state"] == "Show as Sold" and priv["masked"] is True
    grid = requests.get(f"{BASE}/api/blocks/{f['block_id']}/grid", headers=admin_headers).json()
    cell = next(x for fl in grid["floors"] for x in fl["flats"] if x["id"] == f["id"])
    assert cell["masked"] is True and cell["status"] == "Available"
    if sales:
        s = requests.get(f"{BASE}/api/flats/{f['id']}", headers=sales).json()
        assert s["status"] == "Sold" and not any(k in s for k in ("display_state", "display_override", "inventory_state", "masked", "display_reason"))
        sgrid = requests.get(f"{BASE}/api/blocks/{f['block_id']}/grid", headers=sales).json()
        scell = next(x for fl in sgrid["floors"] for x in fl["flats"] if x["id"] == f["id"])
        assert scell["status"] == "Sold" and "masked" not in scell and "display_state" not in scell
        # a real Sold flat and the masked one have the identical key set AND null-pattern for the Sales user — across the whole company
        real_sold = next((x for fl in sgrid["floors"] for x in fl["flats"] if x["status"] == "Sold" and x["id"] != f["id"]), None)
        if real_sold:
            assert set(real_sold) == set(scell)
        def _all(h):
            out, page = [], 1
            while True:
                r = requests.get(f"{BASE}/api/flats", params={"page_size": 200, "page": page}, headers=h).json()
                out += r["items"]
                if len(r["items"]) < 200:
                    return out
                page += 1
        allf, allp = _all(sales), _all(admin_headers)
        masked_ids = {x["id"] for x in allp if x.get("masked") and x["display_state"] == "Show as Sold"}
        real_ids = {x["id"] for x in allp if x["inventory_state"] in ("Booked", "Sold")}
        sm = [x for x in allf if x["id"] in masked_ids]
        sr = [x for x in allf if x["id"] in real_ids]
        assert sm and sr, (len(allf), len(allp), len(masked_ids), len(real_ids), next(x for x in allp if x["id"] == f["id"]), mongo.flats.find_one({"id": f["id"]}, {"_id": 0, "status": 1, "display_state": 1, "display_override": 1, "flat_number": 1}), requests.get(f"{BASE}/api/flats/{f['id']}", headers=admin_headers).json()["inventory_state"])
        assert all(x["status"] == "Sold" for x in sm + sr) and not any("booking_id" in x for x in sm + sr)
        keysets = {frozenset(x) for x in sm + sr}
        assert len(keysets) == 1, [sorted(a ^ b) for a in keysets for b in keysets if a != b][:1]
        for k in keysets.pop():
            real_nulls = {x.get(k) is None for x in sr}
            assert {x.get(k) is None for x in sm} <= real_nulls, (k, [x.get(k) for x in sm][:3])
        # non-privileged summary counts are by DISPLAYED status only and tie to the shaped flat list
        summ = requests.get(f"{BASE}/api/inventory/summary", params={"block_id": f["block_id"]}, headers=sales).json()
        assert summ["privileged"] is False and not any(k in summ["counters"] for k in ("shown_as_sold_masked", "masked", "booked", "blocked"))
        shaped = [x for x in allf if x["block_id"] == f["block_id"]]
        by = {s: sum(1 for x in shaped if x["status"] == s) for s in ("Available", "Hold", "Sold")}
        assert summ["counters"]["available"] == by["Available"] and summ["counters"]["held"] == by["Hold"] and summ["counters"]["sold"] == by["Sold"] and summ["counters"]["total"] == len(shaped), (summ, by)
        # wizard never lists it; booking attempt reads as Sold
        wiz = requests.get(f"{BASE}/api/blocks/{f['block_id']}/grid", params={"bookable_for": ""}, headers=sales).json()
        assert all(x["id"] != f["id"] for fl in wiz["floors"] for x in fl["flats"])
        # dashboard / project / search counters for Sales are display-based: the masked flat counts as Sold, never Available
        import time
        time.sleep(0.2)
        sd = requests.get(f"{BASE}/api/dashboard", headers=sales).json()
        ad = requests.get(f"{BASE}/api/dashboard", headers=admin_headers).json()
        sb = next(b for b in sd["blocks"] if b["id"] == f["block_id"])["inventory"]
        ab = next(b for b in ad["blocks"] if b["id"] == f["block_id"])["inventory"]
        assert sb["Booked"] == 0 and sb["Available"] <= ab["Available"] and sb["total"] == ab["total"]
        sp = requests.get(f"{BASE}/api/projects/{f['project_id']}", headers=sales).json()
        assert next(b for b in sp["blocks"] if b["id"] == f["block_id"])["inventory"]["Available"] == sb["Available"]
        # tower cards (/blocks) and the flats list status filter are display-based too
        card = next(b for b in requests.get(f"{BASE}/api/blocks", params={"page_size": 100}, headers=sales).json()["items"] if b["id"] == f["block_id"])
        assert card["inventory"]["Booked"] == 0 and card["inventory"]["Available"] == sb["Available"], (card["name"], card["inventory"], sb)
        lst = requests.get(f"{BASE}/api/flats", params={"block_id": f["block_id"], "status": "Available", "page_size": 200}, headers=sales).json()["items"]
        assert all(x["id"] != f["id"] for x in lst) and all(x["status"] == "Available" for x in lst)
        srch = requests.get(f"{BASE}/api/search", params={"q": f["flat_number"], "scope": "flats"}, headers=sales).json()
        hit = next((i for g in srch["groups"] for i in g["items"] if i.get("id") == f["id"]), None)
        assert hit is None or (hit["status"] == "Sold" and "masked" not in hit)
    _bulk(admin_headers, flat_ids=[f["id"]], action="clear_display", reason="test done")
    assert requests.get(f"{BASE}/api/flats/{f['id']}", headers=admin_headers).json()["masked"] is False


def test_wizard_excludes_landowner_blocked_and_booking_rejects_unsaleable(admin_headers):
    a, b = _avail_flats(admin_headers, 2)
    cats = {c["code"]: c for c in requests.get(f"{BASE}/api/master/allocation-categories", headers=admin_headers).json()["items"]}
    assert cats["BUILDER"]["bookable"] is True and cats["LANDOWNER"]["bookable"] is False
    assert _bulk(admin_headers, flat_ids=[a["id"]], action="set_category", category_id=cats["LANDOWNER"]["id"]).json()["done"] == 1
    assert _bulk(admin_headers, flat_ids=[b["id"]], action="block", reason="legal").json()["done"] == 1
    wiz = requests.get(f"{BASE}/api/blocks/{a['block_id']}/grid", params={"bookable_for": ""}, headers=admin_headers).json()
    ids = {x["id"] for fl in wiz["floors"] for x in fl["flats"]}
    assert a["id"] not in ids and b["id"] not in ids
    lst = requests.get(f"{BASE}/api/flats", params={"bookable_for": "", "block_id": a["block_id"], "page_size": 200}, headers=admin_headers).json()["items"]
    assert all(x["id"] not in (a["id"], b["id"]) for x in lst)
    cust = requests.get(f"{BASE}/api/customers", params={"page_size": 1}, headers=admin_headers).json()["items"][0]
    r = requests.post(f"{BASE}/api/bookings", json={"flat_id": a["id"], "customer_id": cust["id"], "booking_date": datetime.now(timezone.utc).date().isoformat(), "agreement_value": 1000000, "cash_agreed": 1000000, "account_agreed": 0}, headers=admin_headers)
    assert r.status_code in (409, 422) and (r.json().get("code") == "FLAT_NOT_SALEABLE" or r.status_code == 422), r.text
    # counters + Journey (before→after inline on the entity journey AND humanised in History)
    summ = requests.get(f"{BASE}/api/inventory/summary", params={"block_id": a["block_id"]}, headers=admin_headers).json()
    jr = requests.get(f"{BASE}/api/journey/entity/flat/{a['id']}", headers=admin_headers).json()["items"]
    cat = next(i for i in jr if i["action"] == "flat.category_changed")
    assert cat.get("before") and cat.get("after") and cat["after"]["allocation_category_code"] == "LANDOWNER", cat
    hist = requests.get(f"{BASE}/api/audit-logs/entity/flat/{a['id']}", headers=admin_headers).json()["items"]
    ch = next(i for i in hist if i["action"] == "flat.category_changed")["changed_fields"]
    assert any(c["label"] == "Category" and c["old"] == "Builder saleable" and c["new"] == "Landowner share" for c in ch), ch
    assert summ["privileged"] and summ["counters"]["landowner"] >= 1 and summ["counters"]["blocked"] >= 1
    assert mongo.audit_logs.find_one({"action": "flat.category_changed", "entity_id": a["id"]}) and mongo.audit_logs.find_one({"action": "flat.blocked", "entity_id": b["id"]})
    _bulk(admin_headers, flat_ids=[a["id"]], action="set_category", category_id=cats["BUILDER"]["id"])
    _bulk(admin_headers, flat_ids=[b["id"]], action="unblock")


def test_expiry_sweep_releases_and_notifies(admin_headers):
    f = _avail_flats(admin_headers, 1)[0]
    reason = requests.get(f"{BASE}/api/master/hold-reasons", headers=admin_headers).json()["items"][0]
    assert _bulk(admin_headers, flat_ids=[f["id"]], action="hold", reason_id=reason["id"], expires_at=(datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()).json()["done"] == 1
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    mongo.flats.update_one({"id": f["id"]}, {"$set": {"hold.expires_at": past}})
    import json
    import subprocess
    out = subprocess.run([sys.executable, "-c", "import asyncio, json, sys\nsys.path.insert(0, '.')\nfrom services import inventory as inv\nprint(json.dumps(asyncio.run(inv.expire_holds()), default=str))"],
                         cwd=os.path.join(os.path.dirname(__file__), ".."), capture_output=True, text=True, timeout=120, env={**os.environ, "DB_NAME": mongo.name})
    assert out.returncode == 0, out.stderr[-2000:]
    run = json.loads(out.stdout.strip().splitlines()[-1])
    assert run["status"] == "OK", run
    g = requests.get(f"{BASE}/api/flats/{f['id']}", headers=admin_headers).json()
    assert g["status"] == "Available" and not g.get("hold")
    assert mongo.audit_logs.find_one({"action": "flat.hold_expired", "entity_id": f["id"]})
    assert mongo.notifications.find_one({"kind": "flat.hold_expired", "entity_id": f["id"]})
    assert mongo.job_runs.find_one({"job": "HOLD_EXPIRY_SWEEP", "status": "OK"})


def test_reports_tie_out(admin_headers):
    for name in ("by-category", "landowner-share", "hold-register", "masked"):
        r = requests.get(f"{BASE}/api/inventory/reports/{name}", headers=admin_headers)
        assert r.status_code == 200, (name, r.text[:200])
        assert "tie_out" in r.json()
    cat = requests.get(f"{BASE}/api/inventory/reports/by-category", headers=admin_headers).json()
    assert cat["tie_out"]["flats"] == cat["tie_out"]["rows_total"] == mongo.flats.count_documents({"is_active": True})
    hr = requests.get(f"{BASE}/api/inventory/reports/hold-register", headers=admin_headers).json()
    assert hr["totals"]["active"] == hr["tie_out"]["flats_on_hold"] == mongo.flats.count_documents({"is_active": True, "status": "Hold"})
    mk = requests.get(f"{BASE}/api/inventory/reports/masked", headers=admin_headers).json()
    assert mk["totals"]["masked"] <= mk["tie_out"]["overrides"]
    sales = _sales_headers()
    if sales:
        assert requests.get(f"{BASE}/api/inventory/reports/masked", headers=sales).status_code == 403
