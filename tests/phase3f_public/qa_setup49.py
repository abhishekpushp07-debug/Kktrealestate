"""Iteration 49 UI setup: 5 pinned QA views + 2 unpinned (grouped/flat) for admin, 1 shared QA view by accounts. `python qa_setup49.py clean` deletes QA ones by id."""
import json
import sys
import requests

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")


def h(email):
    t = requests.post(f"{B}/api/auth/login", json={"email": email, "password": "Kkt@12345"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


F = "/tmp/qa49.json"
if sys.argv[1:] == ["clean"]:
    ids = json.load(open(F))
    for who, pid in ids:
        print(who, pid, requests.delete(f"{B}/api/reports/presets/{pid}", headers=h(who)).status_code)
    sys.exit()
a, acc = h("admin@kkt.in"), h("accounts@kkt.in")
ids = []
for i in range(5):
    r = requests.post(f"{B}/api/reports/presets", headers=a, json={"report_key": "customer-status", "name": f"QA49 pin {i}", "filters": {"status": "overdue"}, "pinned": True})
    ids.append(["admin@kkt.in", r.json()["id"]])
r = requests.post(f"{B}/api/reports/presets", headers=a, json={"report_key": "customer-status", "name": "QA49 grouped", "filters": {"group": "project,tower"}})
ids.append(["admin@kkt.in", r.json()["id"]])
r = requests.post(f"{B}/api/reports/presets", headers=a, json={"report_key": "customer-status", "name": "QA49 flat", "filters": {"status": "overdue"}})
ids.append(["admin@kkt.in", r.json()["id"]])
r = requests.post(f"{B}/api/reports/presets", headers=acc, json={"report_key": "customer-status", "name": "QA49 shared acc", "filters": {"group": "status"}, "shared": True})
print("accounts create", r.status_code)
ids.append(["accounts@kkt.in", r.json()["id"]])
json.dump(ids, open(F, "w"))
print(json.dumps(ids))
