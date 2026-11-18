"""Phase 2 batch (b): Home Command Center bundle (JRN-51..54, 56-58). Read-only."""
import re, httpx, pytest
from conftest import BASE, _pw

ORDER = ["money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "next_milestone",
         "inventory", "flat_status", "construction", "pipeline", "attention"]
MONEY = {"money_today", "due_vs_received", "ageing", "inflow_30"}


def client(email):
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": _pw()}, timeout=30)
    assert r.status_code == 200, r.text
    return httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + r.json()["access_token"]}, timeout=60)


def bundle(c, **q):
    r = c.get("/home/bundle", params=q); assert r.status_code == 200, r.text[:300]; return r.json()


def pick(obj, path):
    for part in path.split("."):
        m = re.match(r"(\w+)\[(\w+)=(.+)\]$", part)
        if m:
            obj = next(x for x in obj[m.group(1)] if str(x.get(m.group(2))) == m.group(3))
        else:
            obj = obj[part]
    return obj


def drills(node, out):
    if isinstance(node, dict):
        if "drill" in node and isinstance(node["drill"], dict) and node["drill"].get("api"):
            out.append(node)
        for v in node.values(): drills(v, out)
    elif isinstance(node, list):
        for v in node: drills(v, out)
    return out


def test_owner_month_values(api):
    d = bundle(api, period="month")
    assert [w["id"] for w in d["layout"]["widgets"] if w["visible"]] == ORDER
    w = {k: v["data"] for k, v in d["widgets"].items()}
    assert w["money_today"]["cash"]["amount_paise"] == 27562800
    assert w["money_today"]["account"]["amount_paise"] == 9187600
    assert w["money_today"]["other"]["amount_paise"] == 4000000
    assert w["due_vs_received"]["due"]["amount_paise"] == 3482076000
    assert w["due_vs_received"]["received"]["amount_paise"] == 1555093000
    a = w["ageing"]
    assert [a[k]["amount_paise"] for k in ("not_due", "d0_30", "d31_60", "d61_90", "d90_plus") if k in a][:4] == \
        [1445527000, 498850100, 386609300, 679609400]
    assert w["inflow_30"]["bills"]["amount_paise"] == 1331801000
    assert w["inflow_30"]["cheques"]["amount_paise"] == 4000000
    att = w["attention"]
    assert (att["holds_expiring"]["count"], att["bounced"]["count"], att["stale_part_paid"]["count"]) == (1, 0, 4)
    ov = [c["overdue_paise"] for c in w["call_today"]["overdue_customers"]]
    assert ov == sorted(ov, reverse=True) and ov


@pytest.mark.parametrize("period", ["today", "month", "fy"])
def test_every_drill_equals_its_list(api, period):
    d = bundle(api, period=period)
    nodes = drills(d["widgets"], [])
    assert len(nodes) > 30
    bad = []
    for n in nodes:
        path, params = n["drill"]["api"]
        r = api.get(path, params={k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items()})
        assert r.status_code == 200, (path, r.status_code)
        got = pick(r.json(), n["drill"]["pick"])
        mine = n.get("amount_paise", n.get("count", n.get("total_paise")))
        if "count" in n["drill"]["pick"].split(".")[-1] or n["drill"]["pick"].endswith("total"):
            mine = n.get("count", mine)
        if got != mine:
            bad.append((path, params, n["drill"]["pick"], mine, got))
    assert not bad, bad[:5]


def test_fy_and_today_periods(api):
    fy = bundle(api, period="fy")["widgets"]["due_vs_received"]["data"]["received"]["amount_paise"]
    assert fy == 18704459100
    td = bundle(api, period="today")["widgets"]["due_vs_received"]["data"]["received"]["amount_paise"]
    assert td == 40750400


def test_project_filter_and_ye_empty(api):
    d = bundle(api, period="month")
    projs = {p.get("code"): p for p in d["projects"]}
    ye = projs.get("YE") or next(p for p in d["projects"] if p.get("name") == "Ye")
    pid = ye.get("id") or ye.get("project_id")
    y = bundle(api, period="month", project_id=pid)["widgets"]
    assert y["ageing"]["data"]["d0_30"]["amount_paise"] == 0
    towers = y["inventory"]["data"]["towers"]
    assert [t["tower"] for t in towers] == ["Orion"] and towers[0]["available"]["count"] == 48


def test_role_defaults_server_enforced():
    exp = {"sales@kkt.in": ["call_today", "pipeline", "inventory", "flat_status"],
           "accounts@kkt.in": ["money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "attention"],
           "siteengineer@kkt.in": ["next_milestone", "construction", "flat_status"]}
    for email, ids in exp.items():
        c = client(email)
        d = bundle(c, period="month")
        assert [w["id"] for w in d["layout"]["widgets"] if w["visible"]] == ids, email
        if email == "sales@kkt.in":
            assert not (MONEY & set(d["widgets"])), d["widgets"].keys()
            assert not (MONEY & {a["id"] for a in d["layout"]["available"]})
            for t in d["widgets"]["inventory"]["data"]["towers"]:
                assert "Booked" not in t["states"] and "Blocked" not in t["states"]
            txt = str(d["widgets"]["call_today"])
            assert "overdue_paise" not in txt, "sales call_today leaks money"
        c.close()
