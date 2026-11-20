"""Inspect xlsx export content: header lines, column labels, totals, numeric cells; and grouped export."""
import io
import requests
from openpyxl import load_workbook

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
t = requests.post(f"{B}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}).json()["access_token"]
h = {"Authorization": f"Bearer {t}"}
for params in ({}, {"group": "project,tower", "status": "overdue"}):
    r = requests.get(f"{B}/api/reports/v3/customer-status/export.xlsx", headers=h, params=params)
    ws = load_workbook(io.BytesIO(r.content)).active
    rows = list(ws.iter_rows(values_only=True))
    print(params, "rows", len(rows), "cd", r.headers.get("content-disposition"))
    for x in rows[:6]:
        print("  ", x[:10])
    print("  last", rows[-1][:10])
    print("  types row", [type(v).__name__ for v in rows[5][:10]])
p = requests.get(f"{B}/api/reports/v3/customer-status/export.pdf", headers=h)
print("pdf", p.status_code, len(p.content), p.headers.get("content-disposition"))
