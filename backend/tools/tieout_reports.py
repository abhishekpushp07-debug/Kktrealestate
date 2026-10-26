"""Phase I report tie-outs: every report's totals vs an independent computation from raw collections (to the paisa) + filter invariants.
Usage: python tools/tieout_reports.py [--base URL]  → prints PASS/FAIL lines and writes /app/memory/qa/reports/status.md. Read-only."""
import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
IST = timezone(timedelta(hours=5, minutes=30))
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
LIVE = {"$in": ["Active", "Completed"]}
F0, F1 = "2020-01-01", "2030-12-31"


def main(base):
    A = base.rstrip("/") + "/api"
    tok = requests.post(f"{A}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=BYPASS, timeout=20).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({})["id"]
    bk_ids = [b["id"] for b in db.bookings.find({"company_id": cid}, {"id": 1})]
    live = list(db.bookings.find({"company_id": cid, "status": LIVE}, {"id": 1, "summary": 1, "agreement_value_paise": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "other_charges": 1, "sales_user_id": 1, "project_id": 1}))
    out = []

    def g(p, **k):
        r = requests.get(A + p, headers=H, params=k, timeout=90)
        r.raise_for_status()
        return r.json()

    def tie(report, name, a, b, note=""):
        out.append((report, name, a, b, "PASS" if a == b else "FAIL", note))

    def inv(report, path, total_key, by, **params):  # filter invariant: Σ per group == ungrouped total
        tot = g(path, **params)["totals"].get(total_key)
        grouped = g(path, **params, group_by=by)
        tie(report, f"Σ by {by} == total ({total_key})", sum(r.get(total_key, 0) for r in grouped["rows"]), tot)

    # 1 Collections (Jama)
    jama = sum(r.get("jama_paise", 0) for r in db.ledger_entries.find({"booking_id": {"$in": bk_ids}, "type": {"$in": ["PAYMENT", "OTHER_CHARGE_PAYMENT", "REVERSAL"]}, "date": {"$gte": F0, "$lte": F1}}, {"jama_paise": 1}))
    col = g("/reports/collections-v2", from_date=F0, to_date=F1)
    tie("collections-v2", "net Jama == Σ Jama rows (receipts + reversals)", col["totals"]["total_paise"], jama)
    cleared = sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Cleared"}, {"amount_paise": 1}))
    tie("collections-v2", "net Jama == Σ cleared receipts", col["totals"]["total_paise"], cleared)
    for by in ("project", "block", "bucket", "mode", "bank", "rm", "day"):
        inv("collections-v2", "/reports/collections-v2", "total_paise", by, from_date=F0, to_date=F1)

    # 2 Outstanding & ageing
    from services.definitions import ageing_bands, overdue_of, outstanding, advance
    o = g("/reports/outstanding-v2")
    raw_bal = sum(outstanding(b.get("summary") or {})["total_paise"] for b in live)
    raw_adv = sum(advance(b.get("summary") or {}) for b in live)
    tie("outstanding-v2", "balance == Σ definitions.outstanding(summary)", o["totals"]["balance_paise"], raw_bal)
    tie("outstanding-v2", "Σ Udhar − Σ Jama == balance − advance", o["totals"]["udhar_paise"] - o["totals"]["jama_paise"], o["totals"]["balance_paise"] - o["totals"]["advance_paise"])
    tie("outstanding-v2", "advance held == Σ definitions.advance", o["totals"]["advance_paise"], raw_adv)
    home = g("/dashboard/home", fresh=1)
    tie("outstanding-v2", "balance == Home outstanding tile", o["totals"]["balance_paise"], home["totals"]["outstanding_paise"])
    bands = {}
    for b in live:
        bb = ageing_bands(b.get("summary") or {}, list(db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}})), b.get("other_charges") or [], datetime.now(IST).date())
        for k, v in bb.items():
            bands[k] = bands.get(k, 0) + v
    tie("outstanding-v2", "bands Σ == total balance", sum(o["totals"].get(f"band_{k}", 0) for k in ("Not due", "0-30", "31-60", "61-90", "90+")), o["totals"]["balance_paise"])
    tie("outstanding-v2", "report bands == Σ definitions.ageing_bands", {k: o["totals"].get(f"band_{k}", 0) for k in bands}, bands)
    for by in ("customer", "project", "block"):
        inv("outstanding-v2", "/reports/outstanding-v2", "balance_paise", by)

    # 3 Demand vs collection
    dvc = g("/reports/demand-vs-collection")
    tie("demand-vs-collection", "demanded == Σ non-void demands", dvc["totals"]["demand_paise"], sum(d["total_demand_paise"] for d in db.demands.find({"company_id": cid, "voided": {"$ne": True}}, {"total_demand_paise": 1})))
    tie("demand-vs-collection", "collected == Σ demand.paid", dvc["totals"]["collected_paise"], sum(d.get("paid_paise", 0) for d in db.demands.find({"company_id": cid, "voided": {"$ne": True}}, {"paid_paise": 1})))

    # 4 Cash vs account
    cva = g("/reports/cash-vs-account")
    s = lambda k: sum((b.get("summary") or {}).get(k, 0) for b in live)  # noqa: E731
    tie("cash-vs-account", "cash raised == Σ summary.cash_order_raised", cva["totals"]["cash_raised_paise"], s("cash_order_raised_paise"))
    tie("cash-vs-account", "account received == Σ summary.account_paid", cva["totals"]["account_received_paise"], s("account_paid_paise"))
    tie("cash-vs-account", "cash agreed == Σ booking.cash_agreed", cva["totals"]["cash_agreed_paise"], sum(b.get("cash_agreed_paise", 0) for b in live))
    for by in ("project", "block"):
        inv("cash-vs-account", "/reports/cash-vs-account", "cash_balance_paise", by)

    # 5 Cheque register
    chq = g("/reports/cheques")
    tie("cheques", "rows == cheque/DD payments", len(chq["rows"]), db.payments.count_documents({"company_id": cid, "payment_mode_code": {"$in": ["CHEQUE", "DD"]}}))
    tie("cheques", "amount == Σ instrument amounts", chq["totals"]["amount_paise"], sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "payment_mode_code": {"$in": ["CHEQUE", "DD"]}}, {"amount_paise": 1})))

    # 6 Receivables forecast
    rf = g("/reports/receivables-forecast")
    tie("receivables-forecast", "Σ forecast + Σ raised == Σ agreement (live bookings)", rf["totals"]["expected_paise"] + rf["totals"]["raised_paise"], sum(b["agreement_value_paise"] for b in live))
    tie("receivables-forecast", "per booking: forecast == agreement − raised", sum(1 for p in rf["per_booking"] if p["forecast_paise"] != p["agreement_paise"] - p["raised_paise"]), 0)
    for by in ("project", "block", "booking"):
        inv("receivables-forecast", "/reports/receivables-forecast", "expected_paise", by)

    # 7 Cancellations & refunds
    canc = g("/reports/cancellations", from_date=F0, to_date=F1)
    tie("cancellations", "rows == Cancelled bookings", len(canc["rows"]), db.bookings.count_documents({"company_id": cid, "status": "Cancelled"}))
    tie("cancellations", "refund paid == Σ paid refunds", canc["totals"]["refund_paid_paise"], sum(r.get("amount_total_paise") or r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid", "parent_refund_id": {"$exists": False}}, {"amount_paise": 1, "amount_total_paise": 1})))
    tie("cancellations", "ledger REFUND rows == Σ paid refunds", sum(-r["amount_paise"] for r in db.ledger_entries.find({"type": "REFUND"}, {"amount_paise": 1})), sum(r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid"}, {"amount_paise": 1})))

    # 8 Bank-wise
    bw = g("/reports/bank-receipts", from_date=F0, to_date=F1)
    tie("bank-receipts", "cleared == Σ non-cash cleared", bw["totals"]["cleared_paise"], sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Cleared", "payment_mode_code": {"$ne": "CASH"}}, {"amount_paise": 1})))
    tie("bank-receipts", "pending == Σ non-cash pending", bw["totals"]["pending_paise"], sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Pending", "payment_mode_code": {"$ne": "CASH"}}, {"amount_paise": 1})))

    # 9 Other charges
    oc = g("/reports/other-charges")
    all_bk = list(db.bookings.find({"company_id": cid}, {"other_charges": 1}))
    tie("other-charges", "demanded == Σ other_charges.demanded", oc["totals"]["demanded_paise"], sum(c.get("demanded_paise", 0) for b in all_bk for c in b.get("other_charges") or []))
    tie("other-charges", "collected == Σ other_charges.paid", oc["totals"]["collected_paise"], sum(c.get("paid_paise", 0) for b in all_bk for c in b.get("other_charges") or []))
    tie("other-charges", "collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals)", oc["totals"]["collected_paise"], sum(r.get("jama_paise", 0) for r in db.ledger_entries.find({"booking_id": {"$in": bk_ids}, "$or": [{"type": "OTHER_CHARGE_PAYMENT"}, {"type": "REVERSAL", "category": "Other"}]}, {"jama_paise": 1})))
    for by in ("project", "booking"):
        inv("other-charges", "/reports/other-charges", "demanded_paise", by)

    # 10 Roznamcha summary
    rz = g("/reports/roznamcha-summary", from_date=F0, to_date=F1)
    tie("roznamcha-summary", "cash received == Σ cleared CASH receipts", rz["totals"]["cash_in_paise"], sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Cleared", "payment_mode_code": "CASH"}, {"amount_paise": 1})))
    tie("roznamcha-summary", "deposits == Σ contra DEPOSIT", rz["totals"]["deposit_paise"], sum(c["amount_paise"] for c in db.contra_entries.find({"company_id": cid, "kind": "DEPOSIT", "is_active": {"$ne": False}}, {"amount_paise": 1})))
    tie("roznamcha-summary", "closing == opening + cash in − deposits + withdrawals − cash refunds", rz["totals"]["closing_paise"], rz["totals"]["opening_paise"] + rz["totals"]["cash_in_paise"] - rz["totals"]["deposit_paise"] + rz["totals"]["withdrawal_paise"] - rz["totals"]["cash_refund_paise"])
    rzm = g("/reports/roznamcha-summary", from_date=F0, to_date=F1, group_by="month")
    tie("roznamcha-summary", "Σ by month == range total (cash in)", sum(r["cash_in_paise"] for r in rzm["rows"]), rz["totals"]["cash_in_paise"])
    tie("roznamcha-summary", "monthly closing == daily closing", rzm["totals"]["closing_paise"], rz["totals"]["closing_paise"])

    # 11 Inventory
    inv_r = g("/reports/inventory")
    raw = {}
    for f in db.flats.find({"company_id": cid, "is_active": {"$ne": False}}, {"status": 1}):
        raw[f["status"]] = raw.get(f["status"], 0) + 1
    tie("inventory", "units by status == flats", {k: inv_r["totals"].get(k.lower()) for k in raw}, raw)
    tie("inventory", "sold value == Σ price of booked/sold flats", inv_r["totals"].get("sold_value_paise"), sum(f.get("price_paise") or 0 for f in db.flats.find({"company_id": cid, "is_active": {"$ne": False}, "status": {"$in": ["Booked", "Sold"]}}, {"price_paise": 1})))

    # 12 Lead funnel
    sl = g("/reports/sales-leads", from_date=F0, to_date=F1)
    tie("sales-leads", "leads == leads collection", sl["totals"]["leads"], db.leads.count_documents({"company_id": cid}))
    tie("sales-leads", "converted == Converted leads", sl["totals"]["converted"], db.leads.count_documents({"company_id": cid, "status": "Converted"}))

    # 13 Site visits
    sv = g("/reports/site-visits", from_date=F0, to_date=F1)
    tie("site-visits", "visits == site_visits", sv["totals"]["scheduled"], db.site_visits.count_documents({"company_id": cid, "is_active": {"$ne": False}, "date": {"$gte": F0, "$lte": F1}}))
    tie("site-visits", "completed == Completed visits", sv["totals"]["completed"], db.site_visits.count_documents({"company_id": cid, "is_active": {"$ne": False}, "status": "Completed", "date": {"$gte": F0, "$lte": F1}}))
    for by in ("project", "month"):
        inv("site-visits", "/reports/site-visits", "scheduled", by, from_date=F0, to_date=F1)

    # 14 Sales team
    st = g("/reports/sales-team", from_date=F0, to_date=F1)
    tie("sales-team", "sold value == Σ live agreement values", st["totals"]["sold_paise"], sum(b["agreement_value_paise"] for b in live))
    tie("sales-team", "collections == Σ cleared receipts of live bookings", st["totals"]["collected_paise"], sum(p["amount_paise"] for p in db.payments.find({"company_id": cid, "status": "Cleared", "booking_id": {"$in": [b["id"] for b in live]}}, {"amount_paise": 1})))
    tie("sales-team", "overdue == outstanding report overdue", st["totals"]["overdue_paise"], o["totals"]["overdue_paise"])

    # 15 Construction vs plan
    cvp = g("/reports/construction-vs-plan")
    blocks = list(db.blocks.find({"company_id": cid, "is_active": {"$ne": False}}, {"construction_stages": 1}))
    tie("construction-vs-plan", "stages done == Σ Completed stage records", cvp["totals"]["completed"], sum(1 for b in blocks for s_ in b.get("construction_stages") or [] if s_.get("status") == "Completed"))
    tie("construction-vs-plan", "stage demands == Σ ON_STAGE demands", cvp["totals"]["stage_demanded_paise"], sum(d["total_demand_paise"] for d in db.demands.find({"company_id": cid, "voided": {"$ne": True}, "trigger_type": "ON_STAGE"}, {"total_demand_paise": 1})))

    # 16 Service SLA
    sla = g("/reports/service-sla", from_date=F0, to_date=F1)
    tie("service-sla", "tickets == service_requests", sla["totals"]["total"], db.service_requests.count_documents({"company_id": cid, "is_active": {"$ne": False}, "created_at": {"$gte": F0, "$lte": F1 + "T23:59:59"}}))

    # 17 Audit trail
    act = g("/reports/activity", from_date=F0, to_date=F1)
    tie("activity", "audit actions == audit_logs", sum(a["count"] for a in act["actions"]), db.audit_logs.count_documents({"company_id": cid, "created_at": {"$gte": F0, "$lte": F1 + "T23:59:59"}}))

    # 18 Data quality
    dq = g("/reports/data-quality")
    integ = g("/admin/integrity-report", fresh=1)
    tie("data-quality", "open demands on cancelled bookings == 0 (integrity)", next(r["count"] for r in dq["rows"] if r["group"].startswith("Open demands on cancelled")), 0)
    tie("data-quality", "payment plans not summing 100 == 0", next(r["count"] for r in dq["rows"] if r["group"].startswith("Payment plans")), 0)
    tie("data-quality", "integrity report ok", integ.get("ok"), True)

    os.makedirs("/app/memory/qa/reports", exist_ok=True)
    with open("/app/memory/qa/reports/status.md", "w") as f:
        f.write(f"# Phase I reports — tie-out status · DB `{os.environ['DB_NAME']}` · {datetime.now(IST).isoformat(timespec='seconds')}\n\n")
        for rep in dict.fromkeys(r[0] for r in out):
            rows = [r for r in out if r[0] == rep]
            f.write(f"## {rep} — {'DONE' if all(r[4] == 'PASS' for r in rows) else 'FAIL'}\n")
            for r in rows:
                f.write(f"- **{r[4]}** {r[1]} · report=`{str(r[2])[:60]}` raw=`{str(r[3])[:60]}`\n")
            f.write("\n")
        f.write(f"**{sum(1 for r in out if r[4] == 'PASS')}/{len(out)} PASS**\n")
    for r in out:
        print(f"{r[4]:4s} [{r[0]}] {r[1]:70s} report={str(r[2])[:30]} raw={str(r[3])[:30]}")
    print(f"{sum(1 for r in out if r[4] == 'PASS')}/{len(out)} PASS")
    return all(r[4] == "PASS" for r in out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    sys.exit(0 if main(ap.parse_args().base) else 1)
