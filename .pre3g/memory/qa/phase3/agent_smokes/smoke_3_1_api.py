# Phase 3 chunk 3-1 API smoke (read-only): booking actions reasons, ledger law, inventory counts parity
import os, sys, time, json, requests

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
PW = "Kkt@12345"


def login(email):
    for _ in range(3):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW})
        if r.status_code == 200:
            s = requests.Session()
            s.headers["Authorization"] = "Bearer " + r.json()["access_token"]
            return s
        print("login", email, r.status_code, r.text[:200]); time.sleep(20)
    sys.exit(1)


def bk(s, number):
    r = s.get(f"{BASE}/bookings", params={"search": number, "page_size": 5, "include_cancelled": "true"})
    items = r.json().get("items", [])
    m = [b for b in items if b.get("booking_number") == number]
    return m[0] if m else None


a = login("admin@kkt.in")
out = {}
for num in ["BK-2526-2331", "BK-2526-2366", "BK-2526-2357"]:
    b = bk(a, num)
    if not b:
        print(num, "NOT FOUND"); continue
    act = a.get(f"{BASE}/bookings/{b['id']}/actions")
    print(num, b["status"], b["id"], "actions", act.status_code, json.dumps(act.json().get("actions")), "plans", len(act.json().get("plans", [])))
    full = a.get(f"{BASE}/bookings/{b['id']}").json()
    keys = {k: full.get(k) for k in full if any(x in k for x in ("balance", "outstanding", "advance", "paid", "billed", "received", "total"))}
    print("  booking money keys:", json.dumps(keys)[:900])
    led = a.get(f"{BASE}/bookings/{b['id']}/ledger")
    lj = led.json()
    print("  ledger", led.status_code, list(lj.keys()) if isinstance(lj, dict) else type(lj))
    out[num] = b["id"]

# inventory parity: Home bundle inventory widget vs /flats per tower
bun = a.get(f"{BASE}/home/bundle").json()
inv = bun.get("inventory", {})
print("bundle inventory ok:", inv.get("ok"), str(inv)[:300])
json.dump(out, open("/tmp/bk_ids.json", "w"))
