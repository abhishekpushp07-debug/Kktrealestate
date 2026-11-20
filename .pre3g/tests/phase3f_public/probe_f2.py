import sys
sys.path.insert(0, "/app/tests/phase3f_public")
from test_reports_v3_f2 import J, get, H, BASE, F2
import requests

adv = J("advance-holders")
print("advance count", adv["count"], adv["totals"])
r0 = adv["rows"][0] if adv["rows"] else None
st = J("customer-statement")
opts = st["options"]["customer"]
print("statement options", len(opts))
if r0:
    s = J("customer-statement", {"customer": r0["customer_id"]})
    print("adv cust", r0["customer_name"], "last balances", [x["balance"] for x in s["rows"][-2:]], s["formula"])
# find waiver customers via scanning (limit)
found = 0
for o in opts[:80]:
    s = J("customer-statement", {"customer": o["value"]})
    if s["totals"]["waived"]:
        print("waiver cust", o["label"], s["totals"], s["formula"])
        print({x["particulars"] for x in s["rows"] if x["waived"]})
        found += 1
        if found > 1:
            break
# options and kind filter
print("kind opts", J("customer-statement", {"customer": opts[0]["value"]})["options"].get("kind"))
# call-list None handling
cl = J("call-list")
print("call days first/last", [x["days_overdue"] for x in cl["rows"][:3]], [x["days_overdue"] for x in cl["rows"][-3:]])
print("call-list cols", [c["key"] for c in cl["cols"]], cl["sentence"])
print("call reasons opts", cl["options"].get("reason"))
# ageing asc sort with None
ag = J("customer-ageing", {"sort": "last_payment", "dir": "desc"})
print("ageing last_payment desc first", [x.get("last_payment") for x in ag["rows"][:3]])
# kyc
k = J("kyc-pending")
print("kyc count", k["count"], "complete incl", J("kyc-pending", {"show_complete": "true"})["count"], k["totals"], k["formula"])
print("kyc sample", {x: k["rows"][0].get(x) for x in ("kyc_status", "agreement", "docs_missing")})
print("kyc multi", J("kyc-pending", {"pending": "kyc,agreement"})["count"], J("kyc-pending", {"pending": "agreement"})["count"], J("kyc-pending", {"pending": "kyc"})["count"])
# behaviour
b = J("payment-behaviour")
print("beh", b["count"], b["totals"], b["formula"], b["options"].get("behaviour"))
print("beh sample", {x: b["rows"][0].get(x) for x in ("customer_name", "bills_due", "on_time", "on_time_pct", "avg_days_late", "behaviour")})
# directory
d = J("customer-directory")
c = requests.get(f"{BASE}/api/customers", headers=H("admin@kkt.in"), params={"page_size": 1}, timeout=30).json()
print("directory", d["count"], "customers list total", c.get("total") if isinstance(c, dict) else len(c), d["sentence"], d["formula"])
print("dir sample", {x: d["rows"][0].get(x) for x in ("customer_name", "customer_code", "phone", "email", "co_applicants", "city", "source", "sales_person")})
# cancelled
cc = J("cancelled-customers")
for x in cc["rows"]:
    print(x["kind"], x["customer_name"], x.get("received"), x.get("forfeit"), x.get("refund_payable"), x.get("refund_paid"), x.get("new_flat"))
print(cc["formula"])
# accounts perms on all
print("accounts", {k: get(k, email="accounts@kkt.in").status_code for k in F2})
print("hub tiles", [(t["key"], t.get("headline"), t.get("caption")) for t in requests.get(f"{BASE}/api/reports/v3", headers=H("admin@kkt.in")).json()["segments"][0]["tiles"]])
# validation
print("bad", get("customer-ageing", {"due_min": "abc"}).status_code, get("call-list", {"window_from": "x"}).status_code, get("customer-ageing", {"foo": 1}).status_code, get("customer-statement", {"customer": "nonexistent"}).status_code)
