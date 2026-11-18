import sys
sys.path.insert(0, ".")
from test_reports_v3_f2 import J
d = J("call-list", {"cols": "customer_name,last_follow_up,next_follow_up,last_note,days_overdue,next_due_date"})
print(d["count"], sum(1 for r in d["rows"] if r.get("last_follow_up")), sum(1 for r in d["rows"] if r.get("next_follow_up")), sum(1 for r in d["rows"] if r.get("last_note")))
print([ (r["customer_name"], r.get("days_overdue"), r.get("next_due_date")) for r in d["rows"] if not r.get("next_due_date")][:5])
b = J("payment-behaviour")
print([(r["customer_name"], r["waivers"]) for r in b["rows"] if r["waivers"]])
