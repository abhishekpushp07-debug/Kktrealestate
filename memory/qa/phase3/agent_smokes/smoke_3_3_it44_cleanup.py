# Iteration 44 cleanup: cancels the TEST_ booking created as sales (BK-2627-2467, no money on it) so GGV Villa P1 is Available again.
import requests
BASE = "https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
BK = "603a85cd-e35c-46ca-a755-1c871e446f9c"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); assert r.ok, r.text
s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
b = s.get(f"{BASE}/bookings/{BK}").json()
print("before", b.get("booking_number"), b.get("status"), b.get("customer_name") or b.get("customer", {}).get("full_name"))
if b.get("status") == "Active":
    c = s.post(f"{BASE}/bookings/{BK}/cancel", json={"reason": "TEST_T1 it44 cleanup (no money)", "deduction": 0, "version": b.get("version")})
    print("cancel", c.status_code, c.text[:300])
print("after", s.get(f"{BASE}/bookings/{BK}").json().get("status"))
f = s.get(f"{BASE}/flats/050fd11f-4826-468f-8bc2-b87941fa030a").json()
print("flat P1", f.get("status"))
