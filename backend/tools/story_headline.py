"""Write /app/memory/qa/story/headline_numbers.{json,md} from the live API (run right after tools/story_seed.py)."""
import collections
import json
import os
import sys

import requests

A = os.environ.get("STORY_BASE_URL", "http://localhost:8001") + "/api"
H = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
H["Authorization"] = "Bearer " + requests.post(A + "/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=H, timeout=30).json()["access_token"]
AS_OF = sys.argv[1] if len(sys.argv) > 1 else "2026-10-26"
OUT = "/app/memory/qa/story"
g = lambda p, **k: requests.get(A + p, headers=H, params=k, timeout=60).json()  # noqa: E731
inr = lambda p: f"₹{p / 100:,.2f}"  # noqa: E731

home = g("/dashboard/home", fresh=1)["totals"]
out = g("/reports/outstanding")
coll = g("/reports/collections", from_date="2025-04-01", to_date=AS_OF, group_by="month")
canc_rows = [r for r in g("/reports/cancellations", from_date="2025-04-01", to_date=AS_OF)["rows"] if r["booking_number"] in ("BK-2526-0037", "BK-2526-0047")]  # the two story cancellations
canc = {k: sum(r[k] for r in canc_rows) for k in ("paid_paise", "forfeiture_paise", "refund_paise", "refund_paid_paise")}
sl = g("/reports/sales-leads", from_date="2025-04-01", to_date=AS_OF)
bands = {k: sum(r.get(k, 0) for r in out["rows"]) for k in ("age_Not due", "age_0-30", "age_31-60", "age_61-90", "age_90+")}
inv = collections.Counter()
for b in g("/blocks", page_size=50)["items"]:
    for f in g("/flats", block_id=b["id"], page_size=200)["items"]:
        inv[f"{b['name']}|{f['status']}"] += 1
modes = {m["code"]: m["id"] for m in g("/master/payment-modes")["items"]}
chq_reg = {s: sum(p["amount_paise"] for p in g("/payments", page_size=200, payment_mode_id=modes["CHEQUE"], status=s)["items"] if (p.get("remarks") or "").startswith("story:")) for s in ("Cleared", "Bounced", "Pending")}
rows = coll["rows"]
months = [(m["period"], m["total_paise"]) for m in rows]
by_mode = {m["mode"]: m["total_paise"] for m in coll["by_mode"]}
hn = {"as_of": AS_OF, "agreement_paise": home["agreement_paise"], "paid_paise": home["paid_paise"], "outstanding_paise": home["outstanding_paise"], "overdue_paise": home["overdue_paise"], "advance_paise": home["advance_paise"],
      "refunds_paid_paise": home["refunds_paid_paise"], "bands_paise": bands, "cash_paise": sum(m["cash_paise"] for m in rows), "account_paise": sum(m["account_paise"] for m in rows), "other_paise": sum(m["other_paise"] for m in rows),
      "inventory": dict(inv), "cheque_register_paise": chq_reg, "cancellations": canc, "cancelled_bookings": ["BK-2526-0037", "BK-2526-0047"], "leads": sl["totals"], "bookings": home["bookings"], "units": home["units"], "available": home["available"], "by_mode_paise": by_mode, "collections_by_month_paise": dict(months)}
json.dump(hn, open(f"{OUT}/headline_numbers.json", "w"), indent=1)
L = [f"# Story dataset — headline numbers (as of {AS_OF}, seed 2526)", "", "Produced by `tools/story_seed.py` through the real API (~2,700 calls, audited X-As-Of clock). `POST /api/admin/reseed {confirm:'RESEED', story:true, as_of:'" + AS_OF + "'}` reproduces the dataset; `python tools/story_headline.py` rewrites this file. Asserted by `tests/test_story_headline.py`.", "",
     "| Metric | Value |", "|---|---|", f"| Units / booked / available | {home['units']} / {home['bookings']} / {home['available']} |", f"| Total sold (agreement) | {inr(home['agreement_paise'])} |", f"| Collected (cleared) | {inr(home['paid_paise'])} |", f"| Outstanding (bucket-capped) | {inr(home['outstanding_paise'])} |", f"| Overdue | {inr(home['overdue_paise'])} ({home['overdue_count']} demands) |", f"| Advance held | {inr(home['advance_paise'])} |", f"| Refunds paid | {inr(home['refunds_paid_paise'])} |",
     f"| Cash / Account / Other charges collected | {inr(hn['cash_paise'])} / {inr(hn['account_paise'])} / {inr(hn['other_paise'])} |", f"| Cheque register (cleared / bounced / pending) | {inr(chq_reg['Cleared'])} / {inr(chq_reg['Bounced'])} / {inr(chq_reg['Pending'])} |",
     f"| Cancellations: gross paid / forfeiture / refund | {inr(canc['paid_paise'])} / {inr(canc['forfeiture_paise'])} / {inr(canc['refund_paise'])} |", f"| Leads / converted | {sl['totals']['leads']} / {sl['totals']['converted']} |", "", "## Ageing bands (outstanding)", "", "| Band | Amount |", "|---|---|"] + [f"| {k[4:]} | {inr(v)} |" for k, v in bands.items()]
L += ["", "## Inventory per tower", "", "| Tower · status | Units |", "|---|---|"] + [f"| {k} | {v} |" for k, v in sorted(inv.items())] + ["", "## Collections by month (sanity: looks like a business)", "", "| Month | Collected |", "|---|---|"] + [f"| {p} | {inr(v)} |" for p, v in months] + ["", "## By mode", "", "| Mode | Amount |", "|---|---|"] + [f"| {k} | {inr(v)} |" for k, v in by_mode.items()]
L += ["", "## Personas in the data", "", "- BK-2526-0005 — fully paid villa, **Completed** (possession)", "- **BK-2526-0009 — SECOND ANCHOR (owner's worked example)**: ₹1 Cr, 60 L cash / 40 L account, lump-sum plan (100 % on booking), owner's 10-payment table → due ₹0 (`tests/test_ledger_example.py`)", "- **BK-2526-0014 — NEW REGRESSION ANCHOR**: cheque bounce + auto ₹500 bounce charge, replaced by NEFT — 23 ledger rows, due ₹500.00 (the unpaid bounce charge)", "- BK-2526-0020 — agreement **revision** 60/40 → 50/50", "- BK-2526-0026 — **transfer** to a cheaper unit @55 % cash, schedule telescoped", "- BK-2526-0031 ↔ partner — **unit swap**", "- BK-2526-0037 — **cancelled**, 10 % of received deducted, refund Pending → Paid NEFT; a second cancellation is a **forfeiture**",
      "- late30/late60/late90/late90p personas populate the ageing bands; `advance` personas hold bucket advances; `loan` personas receive disbursements in two tranches", "- 2 holds, 1 blocked unit, 1 hold released; rate edits on Tower C before sale; monthly cash deposits to bank (opening cash ₹25,000 on 01-Apr-2025; cash book never negative)", "- Leads at every stage from 6 sources, visits completed/no-show/cancelled, 14 service tickets across categories (open → in progress → resolved → closed → reopened), 2 notices; portal enabled for the first 8 buyers (Amit Kumar Sinha 9431012345 / Priya Verma 9431023456, password Buyer@12345)"]
open(f"{OUT}/headline_numbers.md", "w").write("\n".join(L) + "\n")
print(json.dumps({k: hn[k] for k in ("agreement_paise", "paid_paise", "outstanding_paise", "overdue_paise", "advance_paise", "refunds_paid_paise")}))
