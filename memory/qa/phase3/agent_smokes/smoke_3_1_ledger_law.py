# Phase 3 chunk 3-1 API smoke 3 (read-only): ledger law Σ Udhar − Σ Jama = outstanding − advance on every booking
import sys, time, json, requests

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
r = requests.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"})
s = requests.Session(); s.headers["Authorization"] = "Bearer " + r.json()["access_token"]
items, page = [], 1
while True:
    d = s.get(f"{BASE}/bookings", params={"page": page, "page_size": 100, "include_cancelled": "true"}).json()
    items += d["items"]
    if len(items) >= d["total"] or not d["items"]: break
    page += 1
bad = 0
for b in items:
    sm = s.get(f"{BASE}/bookings/{b['id']}").json().get("summary", {})
    lhs = round((sm.get("total_udhar") or 0) - (sm.get("total_jama") or 0), 2)
    rhs = round((sm.get("outstanding") or 0) - (sm.get("advance") or 0), 2)
    if b["booking_number"] in ("BK-2526-2331", "BK-2526-2357", "BK-2526-2366"):
        print(b["booking_number"], {k: sm.get(k) for k in ("total_udhar", "total_jama", "outstanding", "advance", "total_received", "total_bill_raised", "due", "other_charges_due")})
    if abs(lhs - rhs) > 1 or sm.get("total_udhar") is None:
        bad += 1; print("MISMATCH", b["booking_number"], b["status"], lhs, rhs)
print(f"checked {len(items)} bookings, mismatches {bad}")
