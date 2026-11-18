# 3-3 (iteration 44) setup: creates one TEST_ customer and picks an Available flat outside project 'Ye'. Prints ids.
import json, uuid, requests
BASE = "https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); assert r.ok, r.text
tok = r.json().get("access_token")
if tok: s.headers["Authorization"] = f"Bearer {tok}"
body = {"full_name": "TEST_T1 It44 Buyer", "phone": f"97{uuid.uuid4().int % 10**8:08d}", "salutation": "Mr"}
c = s.post(f"{BASE}/customers", json=body); print("customer", c.status_code, c.json().get("id"), c.json().get("customer_code"))
fl = s.get(f"{BASE}/flats", params={"status": "Available", "limit": 50}).json()
items = fl.get("items", fl if isinstance(fl, list) else [])
pick = None
for f in items:
    pn = (f.get("project_name") or "")
    if f.get("status") == "Available" and pn.strip().lower() != "ye":
        pick = f; break
print("flat", pick and {k: pick.get(k) for k in ("id", "flat_number", "unit_code", "project_name", "block_name", "project_id", "block_id", "status")})
json.dump({"customer": c.json().get("id"), "flat": pick and pick.get("id"), "project": pick and pick.get("project_id"), "block": pick and pick.get("block_id")}, open("/tmp/t1_44.json", "w"))
