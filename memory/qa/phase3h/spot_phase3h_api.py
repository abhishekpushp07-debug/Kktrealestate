# Phase 3H read-only API spot checks (run directly with python, not part of pytest suite)
import os, json, requests
BASE = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": os.environ["DEMO_PASSWORD"]})
tok = r.json().get("access_token") or r.json().get("token")
s.headers["Authorization"] = f"Bearer {tok}"

def get(key, **q):
    r = s.get(f"{BASE}/api/reports/v3/{key}", params=q)
    return r

def show(key, **q):
    r = get(key, **q)
    print("==", key, q, r.status_code)
    if r.status_code != 200:
        print(r.text[:300]); return None
    d = r.json()
    print(" keys:", list(d.keys()))
    print(" lines:", json.dumps(d.get("lines"), ensure_ascii=False))
    print(" totals:", json.dumps(d.get("totals"), ensure_ascii=False)[:600])
    print(" count:", d.get("count") or d.get("total_rows") or len(d.get("rows", [])))
    return d

c = show("collections")
b = show("bank-receipts")
bvc = show("bills-vs-collection")
bvc2 = show("bills-vs-collection", include_cancelled="1")
cs = show("customer-status")
o = show("outstanding", as_of="2026-10-31")
cs31 = show("customer-status", as_of="2026-10-31")
r = get("outstanding", as_of="2099-01-01"); print("future", r.status_code, r.text[:200])
br = show("booking-register")
sp = show("stacking-plan")
if sp:
    txt = json.dumps(sp.get("rows"))
    print(" stacking CUST- present:", "CUST-" in txt, "customer_id present:", "customer_id" in txt)
show("cash-vs-account")
can = show("cancellations")
if can: print(" cancellations cols:", [c.get("label") for c in can.get("columns", [])])
if b: print(" bank cols:", [c.get("label") for c in b.get("columns", [])])
if o: print(" outstanding groups:", [g.get("key") for g in (o.get("spec") or o).get("groups", [])])

print("---- extra")
for k in ("cancellations", "bank-receipts", "outstanding"):
    d = get(k).json()
    m = d["meta"]
    print(k, "meta keys", list(m.keys()))
    print(" cols:", [c.get("label") for c in m.get("columns", [])])
    print(" groups:", [g.get("key") for g in m.get("groups", [])])
    print(" filters:", [(f.get("key"), f.get("kind")) for f in m.get("filters", [])])
    print(" defaults", d.get("defaults"))
d = get("cancellations", period_from="2025-04-01", period_to="2026-11-19")
print("cancel wide", d.status_code, d.text[:200])
for k, q in [("cancellations", {}), ("collections", {"period_from": "2025-04-01", "period_to": "2026-03-31"})]:
    pass
d = get("collections", period_from="2026-02-01", period_to="2026-02-28").json()
print("collections feb26 lines", d["lines"])
d = get("bank-receipts", period_from="2026-02-01", period_to="2026-02-28").json()
print("bank feb26 lines", d["lines"])
d = get("outstanding", group="floor,flat")
print("outstanding floor,flat", d.status_code, len(d.json().get("rows", [])), str(d.json().get("rows", [])[:1])[:400])
