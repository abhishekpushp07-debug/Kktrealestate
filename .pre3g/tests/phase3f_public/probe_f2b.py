import sys
sys.path.insert(0, "/app/tests/phase3f_public")
from collections import Counter
from test_reports_v3_f2 import J

opts = J("customer-statement")["options"]["customer"]
bad = []
for o in opts:
    s = J("customer-statement", {"customer": o["value"]})
    t = s["totals"]
    last = {}
    for r in s["rows"]:
        last[r["flat_code"]] = r["balance"]
    if sum(last.values()) != t["bill"] - t["received"] - t["waived"]:
        bad.append((o["label"], sum(last.values()), t))
    if "Jyoti" in o["label"]:
        for r in s["rows"]:
            if r["waived"] or "Waiver" in r["particulars"]:
                print(r["date"], r["particulars"][:40], r["bill"], r["received"], r["waived"], r["balance"])
print("mismatch", len(bad), bad[:3])
# multi-customer
two = ",".join(o["value"] for o in opts[:2])
m = J("customer-statement", {"customer": two})
print("multi", m["count"], m["sentence"])
k = J("kyc-pending")
print(Counter(r["agreement"][:6] for r in k["rows"]), Counter(r["agreement"] for r in k["rows"]).most_common(3))
# kind filter + period
cid = opts[0]["value"]
f = J("customer-statement", {"customer": cid, "kind": "Receipt"})
print("kind Receipt", f["count"], {r["particulars"].split(" ·")[0] for r in f["rows"]})
