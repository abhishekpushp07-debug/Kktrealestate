"""Phase F report tie-outs: every report/tile vs. raw collections on the current DB. Read-only.
Usage: python tools/tieout.py [--base URL]  → prints PASS/FAIL table and writes /app/memory/qa/journey/tieout_raw.md"""
import argparse
import os
import sys
from datetime import date, datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}


def main(base):
    A = base.rstrip("/") + "/api"
    tok = requests.post(f"{A}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=BYPASS, timeout=20).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({})["id"]

    def g(p, **k):
        return requests.get(A + p, headers=H, params=k, timeout=60).json()

    rows = []

    def tie(name, report_val, raw_val, note=""):
        ok = report_val == raw_val
        rows.append((name, report_val, raw_val, "PASS" if ok else "FAIL", note))

    FY0, FY1 = "2025-04-01", "2026-12-31"
    cleared = {"company_id": cid, "status": "Cleared", "payment_date": {"$gte": FY0, "$lte": FY1}}
    raw_cleared = sum(p["amount_paise"] for p in db.payments.find(cleared, {"amount_paise": 1}))
    col = g("/reports/collections", from_date=FY0, to_date=FY1)
    tie("collections FY total == Σ cleared receipts", (col.get("totals") or {}).get("total_paise"), raw_cleared)

    pend = list(db.payments.find({"company_id": cid, "status": "Pending"}, {"amount_paise": 1}))
    cih = g("/payments/cheques-in-hand")
    tie("cheques-in-hand count == Pending payments", cih.get("total"), len(pend))
    tie("cheques-in-hand amount == Σ Pending", cih.get("amount_paise"), sum(p["amount_paise"] for p in pend))
    chq = g("/reports/cheques")
    by_status = {}
    for p in db.payments.find({"company_id": cid, "payment_mode_code": {"$in": ["CHEQUE", "DD"]}}, {"status": 1}):
        by_status[p["status"]] = by_status.get(p["status"], 0) + 1
    tie("cheque register rows == instrument payments", len(chq.get("rows", [])), sum(by_status.values()), f"raw by status {by_status}")

    inv = g("/reports/inventory")
    raw_inv = {}
    for f in db.flats.find({"company_id": cid, "is_active": {"$ne": False}}, {"status": 1}):
        raw_inv[f["status"]] = raw_inv.get(f["status"], 0) + 1
    t = inv.get("totals", {}); rep_inv = {"Available": t.get("available"), "Hold": t.get("hold"), "Booked": t.get("booked"), "Sold": t.get("sold"), "Blocked": t.get("blocked")}
    tie("inventory report by_status == flats", {k: v for k, v in rep_inv.items() if v}, {k: v for k, v in raw_inv.items() if v})
    home = g("/dashboard/home", fresh=1)
    tie("home units/available tiles == flats", (home["totals"]["units"], home["totals"]["available"]), (sum(raw_inv.values()), raw_inv.get("Available", 0)))
    leg_inv = g("/dashboard")["inventory"]
    tie("legacy dashboard inventory == flats", {k: v for k, v in leg_inv.items() if k in raw_inv}, raw_inv)

    out = g("/reports/outstanding")
    raw_due = 0
    for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1}):
        s = b.get("summary") or {}
        raw_due += max(s.get("cash_due_paise", 0), 0) + max(s.get("account_due_paise", 0), 0) + max(s.get("other_charges_due_paise", 0), 0)  # definitions.outstanding
    tie("outstanding total == Σ booking summary dues", out["totals"]["due_paise"], raw_due)
    sys.path.insert(0, "/app/backend")
    from services.definitions import ageing_bands, overdue_of
    overdue_raw, bands_raw = 0, {}
    for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"id": 1, "summary": 1, "other_charges": 1}):
        bb = ageing_bands(b.get("summary") or {}, list(db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}})), b.get("other_charges") or [], datetime.now(IST).date())
        overdue_raw += overdue_of(bb)
        for k, v in bb.items():
            bands_raw[k] = bands_raw.get(k, 0) + v
    tie("home overdue tile == Σ bookings overdue (definitions.ageing_bands)", home["totals"]["overdue_paise"], overdue_raw)
    tie("report overdue == Σ bookings overdue", out["totals"]["overdue_paise"], overdue_raw)
    tie("dashboard overdue == report overdue", home["totals"]["overdue_paise"], out["totals"]["overdue_paise"])
    tie("ageing bands sum == report total outstanding", sum(a["amount_paise"] for a in out["ageing"]), out["totals"]["due_paise"])
    tie("report bands == Σ booking bands", {a["bucket"]: a["amount_paise"] for a in out["ageing"]}, bands_raw)

    tie("home outstanding tile == Σ booking dues", home["totals"]["outstanding_paise"], raw_due)
    tie("home outstanding tile == outstanding report due", home["totals"]["outstanding_paise"], out["totals"]["due_paise"])
    sum_summ = sum(((b.get("summary") or {}).get("outstanding_paise") or 0) for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1}))
    tie("ONE NUMBER: Home outstanding == Outstanding report total", home["totals"]["outstanding_paise"], out["totals"]["due_paise"])
    tie("ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise", out["totals"]["due_paise"], sum_summ)
    sum_adv = sum(((b.get("summary") or {}).get("advance_paise") or 0) for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1}))
    tie("Home advance held == Σ booking.summary.advance_paise", home["totals"].get("advance_paise", 0), sum_adv)
    rf_api = g("/refunds", page_size=1)
    rf_paid_raw = sum(r.get("amount_total_paise") or r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid", "parent_refund_id": {"$exists": False}}, {"amount_paise": 1, "amount_total_paise": 1}))
    tie("refunds API Paid total == Σ paid refunds", (rf_api.get("totals", {}).get("Paid") or {}).get("amount_paise", 0), rf_paid_raw)
    canc = g("/reports/cancellations", from_date="2020-01-01", to_date="2030-12-31")
    tie("cancellations report refund paid == Σ paid refunds", canc["totals"].get("refund_paid_paise", 0), rf_paid_raw)
    ledger_refund = sum(-r["amount_paise"] for r in db.ledger_entries.find({"type": "REFUND"}, {"amount_paise": 1}))
    tie("ledger REFUND contra rows == Σ paid refunds (all buckets)", ledger_refund, sum(r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid"}, {"amount_paise": 1})))
    bounce_lines = sum(1 for b in db.bookings.find({"company_id": cid, "other_charges.demand_at": "on_bounce"}, {"other_charges": 1}) for l in b["other_charges"] if l.get("demand_at") == "on_bounce")
    bounce_audits = db.audit_logs.count_documents({"action": "booking.other_charge_demand", "after.source": "bounce", "entity_id": {"$in": [b["id"] for b in db.bookings.find({"company_id": cid}, {"id": 1})]}})  # audit is immutable across reseeds
    tie("bounce charges on bookings == bounce-charge audit rows", bounce_lines, bounce_audits)
    tr_bookings = list(db.bookings.find({"company_id": cid, "transfers.0": {"$exists": True}, "status": "Active"}, {"flat_id": 1, "transfers": 1, "id": 1}))
    tie("transferred bookings' flats point back to booking", sum(1 for b in tr_bookings), sum(1 for b in tr_bookings if (db.flats.find_one({"id": b["flat_id"]}, {"booking_id": 1}) or {}).get("booking_id") == b["id"]))
    stale_demands = db.demands.count_documents({"booking_id": {"$in": [b["id"] for b in db.bookings.find({"company_id": cid, "status": "Cancelled"}, {"id": 1})]}, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}})
    tie("cancelled bookings carry no open demands", stale_demands, 0)
    dvc = g("/reports/demand-vs-collection")
    raw_demanded = sum(d["total_demand_paise"] for d in db.demands.find({"company_id": cid, "voided": {"$ne": True}}, {"total_demand_paise": 1}))
    tie("demand-vs-collection demanded == Σ non-void demands", dvc["totals"]["demand_paise"], raw_demanded)

    month = date.today().isoformat()[:7]
    legacy = g("/dashboard")
    raw_month = sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Cleared", "payment_date": {"$regex": f"^{month}"}}, {"amount_paise": 1}))
    tie("legacy dashboard collections.month == Σ cleared this month", (legacy.get("collections", {}).get("month", {}).get("total_paise")), raw_month, f"month={month}")

    canc = g("/reports/cancellations")
    tie("cancellations rows == Cancelled bookings", len(canc.get("rows", [])), db.bookings.count_documents({"company_id": cid, "status": "Cancelled"}))
    sl = g("/reports/sales-leads", from_date="2020-01-01", to_date="2099-12-31")
    tie("sales-leads total == leads", sl["totals"]["leads"], db.leads.count_documents({"company_id": cid}))

    # per-booking ledger invariant: Σ cleared cash payments == summary.cash_paid for every active booking
    bad = 0
    for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"id": 1, "summary": 1}):
        paid = sum(p["amount_paise"] for p in db.payments.find({"booking_id": b["id"], "payment_category": "Cash", "against": "FLAT_VALUE", "status": "Cleared"}, {"amount_paise": 1}))
        if paid != (b.get("summary") or {}).get("cash_paid_paise", 0):
            bad += 1
    tie("Σ cleared cash receipts == booking.summary.cash_paid (all active)", 0, bad, "count of bookings that differ")

    bad2 = 0
    for b in db.bookings.find({"company_id": cid}, {"summary": 1}):
        s = b.get("summary") or {}
        if "total_udhar_paise" in s and s["total_udhar_paise"] - s["total_jama_paise"] != s.get("outstanding_paise", 0) - s.get("advance_paise", 0):
            bad2 += 1
    tie("Σ Udhar − Σ Jama == outstanding − advance (every booking)", 0, bad2, "two-sided ledger law")

    # Phase I: every report has its own tie-out set (tools/tieout_reports.py) — folded in so this stays the one scoreboard
    from tools.tieout_reports import main as reports_main
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        reports_ok = reports_main(base)
    rep_lines = [l for l in buf.getvalue().splitlines() if l.startswith(("PASS", "FAIL"))]
    for l in rep_lines:
        rows.append((f"report {l[5:].split(' report=')[0].strip()}", "", "", l[:4], "tools/tieout_reports.py"))
    tie("Phase I report tie-outs all PASS", True, reports_ok, f"{len(rep_lines)} report ties")

    os.makedirs("/app/memory/qa/journey", exist_ok=True)
    with open("/app/memory/qa/journey/tieout_raw.md", "w") as f:
        f.write(f"# Report tie-outs · DB `{os.environ['DB_NAME']}` · {date.today()}\n\n| Tie-out | Report value | Raw value | Result | Note |\n|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r[0]} | `{str(r[1])[:70]}` | `{str(r[2])[:70]}` | **{r[3]}** | {r[4]} |\n")
    for r in rows:
        print(f"{r[3]:4s} {r[0]:60s} report={str(r[1])[:40]} raw={str(r[2])[:40]} {r[4]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    main(ap.parse_args().base)
