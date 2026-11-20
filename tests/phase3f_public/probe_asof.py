"""Probe: rows whose Final status says Overdue/Due while Account+Cash dues are 0 (today and past as-of)."""
import requests

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
t = requests.post(f"{B}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}).json()["access_token"]
h = {"Authorization": f"Bearer {t}"}
cols = "customer_name,flat_code,bills_raised,account_received,cash_received,account_dues,cash_dues,other_charges_due,overdue_amount,next_due_date,final_status,waived"
for asof in ("", "2026-03-31", "2025-12-31"):
    d = requests.get(f"{B}/api/reports/v3/customer-status", headers=h, params={"as_of": asof, "cols": cols, "page_size": 500}).json()
    rows = d["rows"]
    bad = [r for r in rows if r["status_kind"] in ("overdue", "due") and r["account_dues"] + r["cash_dues"] == 0]
    bad_od = [r for r in rows if r["status_kind"] == "overdue" and not r["overdue_amount"]]
    clear_with_dues = [r for r in rows if r["status_kind"] == "clear" and r["account_dues"] + r["cash_dues"] > 0]
    print(f"as_of={asof or 'today'} count={d['count']} overdue/due-but-zero-dues={len(bad)} overdue-with-0-overdue_amt={len(bad_od)} clear-with-dues={len(clear_with_dues)}")
    for r in bad[:4]:
        print("   ", r["customer_name"], r["flat_code"], r["final_status"], "acc", r["account_dues"], "cash", r["cash_dues"], "oc", r["other_charges_due"], "od", r["overdue_amount"])
