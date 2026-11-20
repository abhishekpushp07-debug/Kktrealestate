"""List/cleanup helper for QA presets (only by id)."""
import sys
import requests

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
t = requests.post(f"{B}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}).json()["access_token"]
h = {"Authorization": f"Bearer {t}"}
items = requests.get(f"{B}/api/reports/presets", headers=h).json()["items"]
for i in items:
    print(i["id"], i["name"], "pinned", i.get("pinned"), "shared", i.get("shared"), i.get("report_key"), i.get("filters"))
for pid in sys.argv[1:]:
    print("delete", pid, requests.delete(f"{B}/api/reports/presets/{pid}", headers=h).status_code)
