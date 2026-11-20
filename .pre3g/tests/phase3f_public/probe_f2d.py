import sys, requests
sys.path.insert(0, ".")
from test_reports_v3_f2 import J, H, API, get
a = J("customer-ageing")
B = ["band_0_30","band_31_60","band_61_90","band_90p"]
bad = [(r["customer_name"], r["days_overdue"], [r[b] for b in B]) for r in a["rows"] if (r["days_overdue"] or 0) == 0 and any(r[b] for b in B)]
bad2 = [(r["customer_name"], r["days_overdue"]) for r in a["rows"] if (r["days_overdue"] or 0) > 90 and not r["band_90p"]]
print("ageing total_due", a["totals"]["total_due"], "inconsistent 0-day w/ overdue bands", bad[:5], "90+ days w/o 90+ band", bad2[:5])
c = J("call-list", {"cols":"customer_name,overdue_amount,days_overdue"})
print("due soon with overdue amt", [(r["customer_name"], r["overdue_amount"]) for r in J("call-list", {"reason":"Due soon"})["rows"] if r.get("overdue_amount")][:5])
s = requests.get(API, headers=H("sales@kkt.in"), timeout=60).json()
print("sales hub customers tiles", [t["key"] for x in s["segments"] if x["segment"]=="Customers" for t in x["tiles"]])
ac = requests.get(API, headers=H("accounts@kkt.in"), timeout=60).json()
print("accounts hub customers tiles", [(t["key"], t.get("headline")) for x in ac["segments"] if x["segment"]=="Customers" for t in x["tiles"]])
print("sales export 403", get("customer-ageing", email="sales@kkt.in", suffix="/export.xlsx").status_code)
print("statement other customer bad id share", get("customer-statement", {"customer":"x,y"}).json()["sentence"])
