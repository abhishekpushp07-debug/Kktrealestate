# Iteration 44 retest helper (read-only): prints a service-request id and a recent active booking id for UI checks.
import requests, json
BASE = "https://kkt-reports-hub--7kz2bq77.preview.emergentagent.com/api"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); assert r.ok, r.text
s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
sr = s.get(f"{BASE}/service-requests", params={"limit": 3}).json()
items = sr.get("items", sr if isinstance(sr, list) else [])
print("sr", [(i.get("id"), i.get("ticket_no") or i.get("number"), i.get("status")) for i in items[:3]])
