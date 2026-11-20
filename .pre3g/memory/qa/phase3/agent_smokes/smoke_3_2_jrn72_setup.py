# JRN-72 setup: 2 TEST_ leads with a brand-new typed source; prints ids. Data change: creates 2 leads (no delete endpoint).
import requests, random, json
BASE = "https://flat-ledger-11--18pq6xp9.preview.emergentagent.com/api"
SRC = "Hoarding QA T1"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); assert r.ok, r.text
tok = r.json().get("access_token")
if tok: s.headers["Authorization"] = f"Bearer {tok}"
print("before", s.get(f"{BASE}/catalogues/lead_source/typed-value", params={"value": SRC}).json())
ids = []
for i in range(2):
    ph = "9" + "".join(random.choice("0123456789") for _ in range(9))
    r = s.post(f"{BASE}/leads", json={"name": f"TEST_T1 Hoarding {i+1}", "phone": ph, "source": SRC})
    print("create", r.status_code, r.json().get("id"), r.json().get("lead_number"), r.json().get("source"))
    ids.append(r.json().get("id"))
print("after", s.get(f"{BASE}/catalogues/lead_source/typed-value", params={"value": SRC}).json())
print("after lowercase", s.get(f"{BASE}/catalogues/lead_source/typed-value", params={"value": SRC.lower()}).json())
json.dump(ids, open("/tmp/t1_leads.json", "w"))
