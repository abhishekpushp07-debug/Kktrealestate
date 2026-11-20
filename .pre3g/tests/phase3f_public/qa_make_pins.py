"""Create QA presets for pin-limit UI test: 5 pinned + 1 unpinned. Prints ids."""
import requests

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
t = requests.post(f"{B}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}).json()["access_token"]
h = {"Authorization": f"Bearer {t}"}
ids = []
for i in range(5):
    r = requests.post(f"{B}/api/reports/presets", headers=h, json={"report_key": "customer-status", "name": f"QA view pin {i}", "filters": {"status": "overdue"}, "pinned": True})
    ids.append(r.json()["id"])
r = requests.post(f"{B}/api/reports/presets", headers=h, json={"report_key": "customer-status", "name": "QA view seventh", "filters": {}})
ids.append(r.json()["id"])
print(" ".join(ids))
