# Phase 2D Home bundle smoke (public URL): role-gated widgets, rupee twins, 401/403, Ye empty states, drill tie checks
import json, os, sys, time, requests

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
PW = "Kkt@12345"
USERS = ["admin@kkt.in", "accounts@kkt.in", "sales@kkt.in", "siteengineer@kkt.in"]
EXPECT = {
    "accounts@kkt.in": ["money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "attention"],
    "sales@kkt.in": ["call_today", "pipeline", "inventory", "flat_status"],
    "siteengineer@kkt.in": ["next_milestone", "construction", "flat_status"],
}
ALL = ["money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "next_milestone", "inventory",
       "flat_status", "construction", "pipeline", "attention"]
out = {}

r = requests.get(f"{BASE}/home/bundle")
print("unauth bundle:", r.status_code, r.text[:120])

for i, u in enumerate(USERS):
    if i:
        time.sleep(7)
    lr = requests.post(f"{BASE}/auth/login", json={"email": u, "password": PW})
    if lr.status_code != 200:
        print(u, "LOGIN FAIL", lr.status_code, lr.text[:200])
        continue
    tok = lr.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    out[u] = tok
    me = lr.json().get("user", {})
    b = requests.get(f"{BASE}/home/bundle?period=month", headers=h)
    print(f"\n== {u} role={me.get('role_name')} status={b.status_code}")
    if b.status_code != 200:
        print(b.text[:300]); continue
    d = b.json()
    keys = list(d["widgets"].keys())
    vis = [w["id"] for w in d["layout"]["widgets"] if w["visible"]]
    print(" layout visible:", vis, "is_default:", d["layout"]["is_default"])
    print(" widgets keys:", keys)
    print(" available:", [a["id"] for a in d["layout"]["available"]])
    exp = EXPECT.get(u, ALL)
    print(" MATCH default set:", sorted(keys) == sorted(exp), "order ok:", vis == exp)
    bad = [k for k, v in d["widgets"].items() if not v.get("ok")]
    print(" not-ok widgets:", bad, [d["widgets"][k] for k in bad][:2])
    json.dump(d, open(f"/tmp/bundle_{u.split('@')[0]}.json", "w"), indent=1)
    for p in ("today", "fy"):
        r2 = requests.get(f"{BASE}/home/bundle?period={p}", headers=h)
        print(f" period={p}: {r2.status_code} label={r2.json().get('period') if r2.ok else r2.text[:100]}")
    projs = d.get("projects", [])
    print(" projects:", [(p["name"], p["code"]) for p in projs])
    ye = next((p for p in projs if p.get("code") == "YE"), None)
    if ye:
        r3 = requests.get(f"{BASE}/home/bundle?period=month&project_id={ye['id']}", headers=h)
        json.dump(r3.json(), open(f"/tmp/bundle_{u.split('@')[0]}_ye.json", "w"), indent=1)
        print(" Ye bundle:", r3.status_code)
    # outside-role widget attempt via layout PUT
    if u == "sales@kkt.in":
        bad_w = [w for w in ALL if w not in EXPECT[u]][:1]
        if bad_w:
            r4 = requests.put(f"{BASE}/me/home-layout", headers=h,
                              json={"widgets": [{"id": bad_w[0], "size": "M", "visible": True}]})
            print(f" PUT forbidden widget {bad_w}: {r4.status_code} {r4.text[:120]}")
    r5 = requests.get(f"{BASE}/home/bundle?period=bogus", headers=h)
    print(" bad period:", r5.status_code)

json.dump(out, open("/tmp/tokens.json", "w"))
