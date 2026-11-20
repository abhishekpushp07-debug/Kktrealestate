# Phase 2D: layout PUT -> bundle layout reflects it (stale-cache check); then DELETE reset (admin's own pref row)
import time, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
lr = requests.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"})
H = {"Authorization": f"Bearer {lr.json()['access_token']}"}
vis = lambda d: [w["id"] for w in d["widgets"] if w["visible"]]
b0 = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()
cur = requests.get(f"{BASE}/me/home-layout", headers=H).json()
ws = [dict(id=w["id"], size=w["size"], visible=w["id"] != "inflow_30") for w in cur["widgets"]]
ws.insert(0, ws.pop([w["id"] for w in ws].index("ageing")))
p = requests.put(f"{BASE}/me/home-layout", headers=H, json={"widgets": ws, "version": cur["version"]})
print("PUT", p.status_code, vis(p.json())[:4])
print("GET layout", vis(requests.get(f"{BASE}/me/home-layout", headers=H).json())[:4])
for t in (0, 4, 11):
    time.sleep(t and t - (4 if t == 11 else 0))
    b = requests.get(f"{BASE}/home/bundle?period=month", headers=H).json()
    print(f"bundle t~{t}s layout:", vis(b["layout"])[:4], "inflow in widgets:", "inflow_30" in b["widgets"], "computed_at", b["computed_at"])
r = requests.delete(f"{BASE}/me/home-layout", headers=H)
print("DELETE", r.status_code, r.json()["is_default"])
