# Phase 2D retest (iter 38): layout cache invalidation, drill.to links, sales inventory masking (public URL)
import json, time, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
PW = "Kkt@12345"


def login(u):
    r = requests.post(f"{BASE}/auth/login", json={"email": u, "password": PW})
    assert r.status_code == 200, (u, r.status_code, r.text[:200])
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


vis = lambda d: [w["id"] for w in d["widgets"] if w["visible"]]
H = login("admin@kkt.in")
toks = {"admin@kkt.in": H["Authorization"].split()[1]}
# (1) layout persistence
cur = requests.get(f"{BASE}/me/home-layout", headers=H).json()
print("admin layout is_default before:", cur.get("is_default"))
b0 = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()  # warm cache
ws = [dict(id=w["id"], size=w["size"], visible=w["id"] != "inflow_30") for w in cur["widgets"]]
p = requests.put(f"{BASE}/me/home-layout", headers=H, json={"widgets": ws, "version": cur["version"]})
print("PUT", p.status_code)
b1 = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()
print("[1] immediate bundle: inflow_30 visible:", "inflow_30" in vis(b1["layout"]), "| in widgets:", "inflow_30" in b1["widgets"],
      "| is_default", b1["layout"]["is_default"], "->", "PASS" if "inflow_30" not in vis(b1["layout"]) else "FAIL")
if cur.get("is_default"):
    r = requests.delete(f"{BASE}/me/home-layout", headers=H)
    b2 = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()
    print("[1] DELETE", r.status_code, "immediate bundle inflow_30 visible:", "inflow_30" in vis(b2["layout"]),
          "is_default", b2["layout"]["is_default"], "->", "PASS" if b2["layout"]["is_default"] and "inflow_30" in vis(b2["layout"]) else "FAIL")
else:
    # restore exactly
    requests.put(f"{BASE}/me/home-layout", headers=H, json={"widgets": [dict(id=w["id"], size=w["size"], visible=w["visible"]) for w in cur["widgets"]]})

W = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()["widgets"]
json.dump(W, open("/tmp/iter38_admin_widgets.json", "w"), indent=1)


def walk(o, path=""):
    if isinstance(o, dict):
        if isinstance(o.get("drill"), dict):
            yield path, o
        for k, v in o.items():
            if k != "drill":
                yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")


print("\n== drill.to links (admin)")
for wid in ("attention", "inventory", "flat_status", "construction", "next_milestone", "pipeline", "call_today", "ageing"):
    if wid not in W:
        print(wid, "MISSING"); continue
    seen = 0
    for path, n in walk(W[wid].get("data")):
        if seen < 6 or wid in ("ageing", "pipeline", "attention"):
            print(f" {wid}{path}: count={n.get('count')} amt={n.get('amount_paise')} to={n['drill'].get('to')}")
        seen += 1
    print(f" {wid}: {seen} drills; x=1 present:", any("x=1" in (n['drill'].get('to') or '') for _, n in walk(W[wid].get('data'))))

# (7) sales inventory masking
time.sleep(8)
S = login("sales@kkt.in")
toks["sales@kkt.in"] = S["Authorization"].split()[1]
SW = requests.get(f"{BASE}/home/bundle?period=month", headers=S).json()["widgets"]
json.dump(SW, open("/tmp/iter38_sales_widgets.json", "w"), indent=1)
inv = SW.get("inventory", {}).get("data")
print("\n== sales inventory raw:", json.dumps(inv)[:1500])
json.dump(toks, open("/tmp/tokens.json", "w"))
