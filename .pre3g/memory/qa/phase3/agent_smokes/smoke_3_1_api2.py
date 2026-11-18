# Phase 3 chunk 3-1 API smoke 2 (read-only): ledger foot, refunds of cancelled bookings, inventory parity, sales masking
import sys, time, json, requests

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
PW = "Kkt@12345"


def login(email):
    for _ in range(3):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW})
        if r.status_code == 200:
            s = requests.Session(); s.headers["Authorization"] = "Bearer " + r.json()["access_token"]; return s
        print("login", email, r.status_code, r.text[:200]); time.sleep(20)
    sys.exit(1)


ids = json.load(open("/tmp/bk_ids.json"))
a = login("admin@kkt.in")
for num, bid in ids.items():
    lj = a.get(f"{BASE}/bookings/{bid}/ledger").json()
    print(num, "total:", json.dumps(lj["total"]))
    print("  last row:", json.dumps(lj["rows"][-1])[:400] if lj["rows"] else None)
    b = lj["booking"]; print("  booking keys:", {k: v for k, v in b.items() if isinstance(v, (int, float))})
    print("  refunds:", a.get(f"{BASE}/bookings/{bid}/refunds").text[:300])

# any cancelled booking with refund Pending?
r = a.get(f"{BASE}/bookings", params={"status": "Cancelled", "page_size": 50, "include_cancelled": "true"}).json()
for b in r.get("items", []):
    if b["status"] != "Cancelled": continue
    act = a.get(f"{BASE}/bookings/{b['id']}/actions").json()["actions"]
    print("cancelled", b["booking_number"], b["id"], "pay_refund:", act["pay_refund"])

bun = a.get(f"{BASE}/home/bundle").json()
print("bundle keys:", list(bun.keys()) if isinstance(bun, dict) else bun)
w = bun.get("widgets", bun)
print(str(w.get("inventory"))[:1500] if isinstance(w, dict) else "")
projs = a.get(f"{BASE}/projects").json()
projs = projs.get("items", projs) if isinstance(projs, dict) else projs
for p in projs:
    print("project", p.get("code"), p.get("name"), p.get("id"))
