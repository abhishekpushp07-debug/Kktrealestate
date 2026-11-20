# Phase 3G preview read-only API checks (manual bill preview, outstanding law, ops uniqueness, integrity)
# Named qa_* (not test_*) so the committed suite / conftest snapshot does not collect it; run explicitly with -p no:conftest style env.
import os
import datetime
import requests

BASE = None
for line in open("/app/frontend/.env"):
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE = line.split("=", 1)[1].strip().rstrip("/")
S = requests.Session()
res = {}


def check(name, cond, info=""):
    res[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name, info)


r = S.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"})
check("login", r.status_code == 200, r.status_code)
S.headers["Authorization"] = "Bearer " + r.json()["access_token"]

r = S.get(f"{BASE}/api/openapi.json")
check("1 openapi 200", r.status_code == 200 and "paths" in r.json(), r.status_code)

r = S.get(f"{BASE}/api/reports/outstanding-v2")
check("3 outstanding-v2 200", r.status_code == 200, r.status_code)
data = r.json()
rows = data.get("rows") if isinstance(data, dict) else data
print("keys:", list(data.keys()) if isinstance(data, dict) else "list", "rows:", len(rows))
print("sample row keys:", sorted(rows[0].keys()) if rows else None)
bad_law, bad_band = [], []
for x in rows:
    o, a, n = x.get("outstanding_paise"), x.get("advance_paise"), x.get("net_balance_paise")
    u, j, w = x.get("udhar_paise"), x.get("jama_paise"), x.get("waived_paise", 0)
    if not (n == o - a == u - j - w):
        bad_law.append((x.get("booking_number"), n, o, a, u, j, w))
    bands = sum(v for k, v in x.items() if k.startswith("band_") and isinstance(v, int))
    if bands != o:
        bad_band.append((x.get("booking_number"), bands, o))
check("3 law net==out-adv==udhar-jama-waived", not bad_law, bad_law[:3])
check("3 sum(band_*)==outstanding", not bad_band, bad_band[:3])

# 4 booking summary vs report
picked = [x for x in rows if x.get("_link", "").startswith("/bookings/")][:3]
for x in picked:
    bid = x["_link"].split("/bookings/")[1]
    b = S.get(f"{BASE}/api/bookings/{bid}").json()
    sm = b.get("summary") or b.get("booking", {}).get("summary") or {}
    ok = sm.get("outstanding_paise") == x["outstanding_paise"] and sm.get("net_balance_paise") == sm.get(
        "total_udhar_paise", 0
    ) - sm.get("total_jama_paise", 0)
    check(f"4 summary vs report {x.get('booking_number')}", ok,
          (sm.get("outstanding_paise"), x["outstanding_paise"], sm.get("net_balance_paise"),
           sm.get("total_udhar_paise"), sm.get("total_jama_paise")))

# 2 manual bill preview (no write)
if picked:
    bid = picked[0]["_link"].split("/bookings/")[1]
    before = S.get(f"{BASE}/api/bookings/{bid}").json()
    sm0 = before.get("summary") or {}
    today = datetime.date.today().isoformat()
    r = S.post(f"{BASE}/api/demands/manual", json={"booking_id": bid, "name": "QA manual", "account_amount": 1000,
                                                   "due_date": today, "preview": True})
    print("manual preview:", r.status_code, r.text[:400])
    check("2 manual preview 2xx & preview", r.status_code in (200, 201) and r.json().get("preview") is True
          and r.json()["effect"]["udhar_delta_paise"] == 100000)
    after = S.get(f"{BASE}/api/bookings/{bid}").json()
    sm1 = after.get("summary") or {}
    check("2 preview did not write", sm0.get("total_udhar_paise") == sm1.get("total_udhar_paise")
          and sm0.get("outstanding_paise") == sm1.get("outstanding_paise"))
    r = S.post(f"{BASE}/api/demands/manual", json={"booking_id": bid, "name": "QA manual", "account_amount": 0,
                                                   "due_date": today, "preview": True})
    check("2 zero amount 422", r.status_code == 422, r.status_code)
    r = S.post(f"{BASE}/api/demands/manual", json={"booking_id": bid, "name": "QA manual", "account_amount": 10,
                                                   "due_date": "2000-01-01", "preview": True})
    check("2 due<demand 422", r.status_code == 422, r.status_code)

r = S.get(f"{BASE}/api/admin/ops")
check("5 ops 200", r.status_code == 200, r.status_code)
u = r.json().get("uniqueness") or []
print("uniqueness:", u)
need = {"uniq_waiver_number", "uniq_cn_number", "uniq_refund_number_bucket", "uniq_ledger_seq", "uniq_live_booking_per_flat"}
names = {(i.get("name") or i.get("rule") or i.get("index")): i.get("status") for i in u}
check("5 uniqueness 5 rules applied", len(u) == 5 and all(names.get(n) == "applied" for n in need), names)

r = S.get(f"{BASE}/api/admin/integrity-report", params={"fresh": "true"}, timeout=120)
j = r.json()
fc = j.get("findings_count", len(j.get("findings", []) or []))
check("6 integrity ok & 0 findings", r.status_code == 200 and j.get("ok") is True and fc == 0,
      (r.status_code, j.get("ok"), fc, {k: v for k, v in j.items() if k != "findings"}))

print("\nSUMMARY", sum(res.values()), "/", len(res))
