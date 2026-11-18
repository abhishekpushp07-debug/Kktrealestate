# Phase 3H close-out (F-57) read-only API spot checks - GET only, run with python directly (not pytest)
import os, json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
PW = os.environ["DEMO_PASSWORD"]
s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": PW})
tok = r.json().get("access_token") or r.json().get("token")
s.headers["Authorization"] = f"Bearer {tok}"


def get(key, **q):
    return s.get(f"{BASE}/api/reports/v3/{key}", params=q)


def lines(key, **q):
    r = get(key, **q)
    d = r.json() if r.status_code == 200 else {}
    print("==", key, q, r.status_code)
    for l in d.get("lines") or []:
        print("   ", l.get("key"), "|", l.get("text"), "|", l.get("link"))
    rows = d.get("rows") or []
    print("   rows:", len(rows), "count:", d.get("count"))
    return d


lines("booking-register")
for st in ("Active,Completed", "Cancelled"):
    d = lines("booking-register", booking_status=st)
lines("collections")
lines("bank-receipts")
lines("outstanding")
o31 = lines("outstanding", as_of="2026-10-31")
print(" outstanding 31oct totals:", json.dumps(o31.get("totals"), ensure_ascii=False)[:400])
c31 = lines("customer-status", as_of="2026-10-31")
print(" cust-status 31oct totals:", json.dumps(c31.get("totals"), ensure_ascii=False)[:400])
d = lines("cheques", in_hand_on="2026-11-19")
for r in d.get("rows", []):
    print("    ", {k: v for k, v in r.items() if not k.startswith("_")})
d = lines("cheques", in_hand_on="2026-10-31")
for r in d.get("rows", []):
    print("    ", {k: v for k, v in r.items() if not k.startswith("_")})
lines("collections", period_from="2026-02-01", period_to="2026-02-28")
lines("cash-vs-account")
d = lines("cancellations", period_from="2000-01-01")
for r in d.get("rows", []):
    print("    ", {k: v for k, v in r.items() if k in ("booking_no", "booking_id", "customer", "cancelled_on", "refund")} or list(r.keys())[:8])
r = s.get(f"{BASE}/api/reports/v3/outstanding/export.pdf")
print("pdf", r.status_code, r.headers.get("content-type"), len(r.content))
open("/tmp/outstanding.pdf", "wb").write(r.content)
r = s.get(f"{BASE}/api/reports/v3/outstanding/export.pdf", params={"as_of": "2026-10-31"})
print("pdf31", r.status_code, len(r.content))
open("/tmp/outstanding31.pdf", "wb").write(r.content)
