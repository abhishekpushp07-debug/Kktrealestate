# JRN-73 check (read-only): MAINT head GST in master vs new-booking preview vs an older booking's snapshot.
import requests, sys
BASE = "https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
FLAT = "eaf1dfc6-fa8d-4ce8-b0fe-aab507bdb16c"  # SGH A-101 Available
OLD = "696d665b-1086-4e56-8442-b765a4fef405"  # BK-2526-2331
MAINT = "07d28d8d-1be6-4126-afb2-bde31fd6f40d"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); assert r.ok, r.text
tok = r.json().get("access_token") or r.json().get("token")
if tok: s.headers["Authorization"] = f"Bearer {tok}"
h = s.get(f"{BASE}/master/charge-types/{MAINT}").json()
print("master MAINT gst", h.get("default_gst_percent"))
r = s.post(f"{BASE}/bookings/breakdown-preview", json={"flat_id": FLAT, "agreement_value": 6000000, "has_plan": True})
print("preview", r.status_code)
d = r.json()
for l in d.get("lines", d.get("snapshot", {}).get("lines", [])) or []:
    print("  line", l.get("code"), l.get("gst_percent"))
print("  heads", [(x["code"], x.get("default_gst_percent")) for x in d.get("heads", [])])
if r.status_code != 200: print(str(d)[:500])
b = s.get(f"{BASE}/bookings/{OLD}").json()
oc = b.get("other_charges") or b.get("booking", {}).get("other_charges") or []
print("old booking", [(c.get("code"), c.get("gst_percent")) for c in oc])
if len(sys.argv) > 1 and sys.argv[1] == "restore":
    r = s.patch(f"{BASE}/master/charge-types/{MAINT}", json={"default_gst_percent": 18, "version": h.get("version")})
    print("restore", r.status_code, r.json().get("default_gst_percent"))
