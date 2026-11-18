"""Phase I report tie-outs: every report's totals vs an independent computation from raw collections (to the paisa) + filter invariants.
Usage: python tools/tieout_reports.py [--base URL]  → prints PASS/FAIL lines and writes /app/memory/qa/reports/status.md. Read-only."""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

HTTP = requests.Session()  # keep-alive: thousands of reads would otherwise exhaust ephemeral ports (TIME-WAIT)
from _env import DEMO_PASSWORD
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from services import clock

IST = timezone(timedelta(hours=5, minutes=30))
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
LIVE = {"$in": ["Active", "Completed"]}
F0, F1 = "2020-01-01", "2030-12-31"


def main(base):
    A = base.rstrip("/") + "/api"
    tok = requests.post(
        f"{A}/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}, headers=BYPASS, timeout=20
    ).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({})["id"]
    bk_ids = [b["id"] for b in db.bookings.find({"company_id": cid}, {"id": 1})]
    live = list(
        db.bookings.find(
            {"company_id": cid, "status": LIVE},
            {
                "id": 1,
                "summary": 1,
                "agreement_value_paise": 1,
                "cash_agreed_paise": 1,
                "account_agreed_paise": 1,
                "other_charges": 1,
                "sales_user_id": 1,
                "project_id": 1,
            },
        )
    )
    out = []

    def g(p, **k):
        r = HTTP.get(A + p, headers=H, params=k, timeout=90)
        r.raise_for_status()
        return r.json()

    def tie(report, name, a, b, note=""):
        out.append((report, name, a, b, "PASS" if a == b else "FAIL", note))

    def inv(report, path, total_key, by, **params):  # filter invariant: Σ per group == ungrouped total
        tot = g(path, **params)["totals"].get(total_key)
        grouped = g(path, **params, group_by=by)
        # a sheet shows at most its display cap of rows (flagged truncated); its totals are over every row
        got = (
            grouped["totals"].get(total_key)
            if grouped.get("truncated")
            else sum(r.get(total_key, 0) for r in grouped["rows"])
        )
        tie(report, f"Σ by {by} == total ({total_key})", got, tot)

    # 1 Collections (Jama) — both date bases vs raw payments
    pays = list(
        db.payments.find({"company_id": cid, "booking_id": {"$in": bk_ids}, "status": {"$in": ["Cleared", "Reversed"]}})
    )
    FY0, FY1 = "2025-04-01", "2026-03-31"

    def raw_coll(basis, f0, f1):
        tot = 0
        for p in pays:
            d = clock.day_of(p.get("cleared_at") or p["payment_date"]) if basis == "clearance" else p["payment_date"]
            if f0 <= d <= f1:
                tot += p["amount_paise"]
            if (
                p["status"] == "Reversed"
                and f0 <= clock.day_of((p.get("reversal") or {}).get("at") or p["updated_at"]) <= f1
            ):
                tot -= p["amount_paise"]
        return tot

    col = g("/reports/collections-v2", from_date=F0, to_date=F1)
    tie(
        "collections-v2",
        "net Jama (receipt basis, all time) == Σ cleared receipts",
        col["totals"]["total_paise"],
        sum(p["amount_paise"] for p in pays if p["status"] == "Cleared"),
    )
    jama = sum(
        r.get("jama_paise", 0)
        for r in db.ledger_entries.find(
            {"booking_id": {"$in": bk_ids}, "type": {"$in": ["PAYMENT", "OTHER_CHARGE_PAYMENT", "REVERSAL"]}},
            {"jama_paise": 1},
        )
    )
    tie("collections-v2", "net Jama == Σ ledger Jama rows (receipts + reversals)", col["totals"]["total_paise"], jama)
    for basis in ("receipt", "clearance"):
        c = g("/reports/collections-v2", from_date=FY0, to_date=FY1, date_basis=basis)
        tie(
            "collections-v2",
            f"FY total ({basis} basis) == raw payments by {basis} date",
            c["totals"]["total_paise"],
            raw_coll(basis, FY0, FY1),
        )
        tie("collections-v2", f"basis label present ({basis})", c["basis_text"], f"Date basis: {basis} date")
    legacy = g("/reports/collections", from_date=FY0, to_date=FY1)
    tie(
        "collections-v2",
        "receipt basis == legacy collections (payment_date, Cleared)",
        g("/reports/collections-v2", from_date=FY0, to_date=FY1)["totals"]["total_paise"],
        legacy["totals"]["total_paise"],
    )
    for by in ("project", "block", "bucket", "mode", "bank", "rm", "day"):
        inv("collections-v2", "/reports/collections-v2", "total_paise", by, from_date=F0, to_date=F1)

    # 2 Outstanding & ageing — law: Outstanding · Advance held · Net balance
    from services.definitions import (
        advance,
        ageing_bands,
        net_balance,
        outstanding,
    )

    o = g("/reports/outstanding-v2")
    raw_out = sum(outstanding(b.get("summary") or {})["total_paise"] for b in live)
    raw_adv = sum(advance(b.get("summary") or {}) for b in live)
    tie(
        "outstanding-v2", "outstanding == Σ definitions.outstanding(summary)", o["totals"]["outstanding_paise"], raw_out
    )
    tie("outstanding-v2", "advance held == Σ definitions.advance", o["totals"]["advance_paise"], raw_adv)
    tie(
        "outstanding-v2",
        "net == outstanding − advance == Σ Udhar − Σ Jama (received + waived)",
        (o["totals"]["net_balance_paise"], o["totals"]["net_balance_paise"]),
        (
            o["totals"]["outstanding_paise"] - o["totals"]["advance_paise"],
            o["totals"]["udhar_paise"] - o["totals"]["jama_paise"] - o["totals"].get("waived_paise", 0),
        ),
    )
    by_bk = {r["group"]: r for r in o["rows"]}
    bad = []
    for b in live:
        bn = db.bookings.find_one({"id": b["id"]}, {"booking_number": 1})["booking_number"]
        r = by_bk.get(bn)
        led = list(db.ledger_entries.find({"booking_id": b["id"]}, {"udhar_paise": 1, "jama_paise": 1}))
        led_net = sum(x.get("udhar_paise", 0) for x in led) - sum(x.get("jama_paise", 0) for x in led)
        s = b.get("summary") or {}
        if (
            not r
            or r["net_balance_paise"] != led_net
            or r["net_balance_paise"] != net_balance(s)
            or r["outstanding_paise"] != outstanding(s)["total_paise"]
            or r["net_balance_paise"] != r["outstanding_paise"] - r["advance_paise"]
        ):
            bad.append(bn)
    tie(
        "outstanding-v2",
        "per booking: report net == ledger net == summary net; report outstanding == summary outstanding",
        bad,
        [],
    )
    home = g("/dashboard/home", fresh=1)
    tie(
        "outstanding-v2",
        "outstanding == Home outstanding tile",
        o["totals"]["outstanding_paise"],
        home["totals"]["outstanding_paise"],
    )
    bands = {}
    for b in live:
        bb = ageing_bands(
            b.get("summary") or {},
            list(db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}})),
            b.get("other_charges") or [],
            datetime.now(IST).date(),
        )
        for k, v in bb.items():
            bands[k] = bands.get(k, 0) + v
    tie(
        "outstanding-v2",
        "bands Σ == outstanding",
        sum(o["totals"].get(f"band_{k}", 0) for k in ("Not due", "0-30", "31-60", "61-90", "90+")),
        o["totals"]["outstanding_paise"],
    )
    tie(
        "outstanding-v2",
        "report bands == Σ definitions.ageing_bands",
        {k: o["totals"].get(f"band_{k}", 0) for k in bands},
        bands,
    )
    for by in ("customer", "project", "block"):
        inv("outstanding-v2", "/reports/outstanding-v2", "outstanding_paise", by)
        inv("outstanding-v2", "/reports/outstanding-v2", "net_balance_paise", by)

    # 3 Demand vs collection
    dvc = g("/reports/demand-vs-collection")
    tie(
        "demand-vs-collection",
        "demanded == Σ non-void demands",
        dvc["totals"]["demand_paise"],
        sum(
            d["total_demand_paise"]
            for d in db.demands.find(
                {"company_id": cid, "voided": {"$ne": True}, "status": {"$nin": ["Voided", "Cancelled"]}},
                {"total_demand_paise": 1},
            )
        ),
    )
    tie(
        "demand-vs-collection",
        "collected == Σ demand.paid",
        dvc["totals"]["collected_paise"],
        sum(
            d.get("paid_paise", 0)
            for d in db.demands.find(
                {"company_id": cid, "voided": {"$ne": True}, "status": {"$nin": ["Voided", "Cancelled"]}},
                {"paid_paise": 1},
            )
        ),
    )

    # 4 Cash vs account
    cva = g("/reports/cash-vs-account")
    s = lambda k: sum((b.get("summary") or {}).get(k, 0) for b in live)  # noqa: E731
    tie(
        "cash-vs-account",
        "cash raised == Σ summary.cash_order_raised",
        cva["totals"]["cash_raised_paise"],
        s("cash_order_raised_paise"),
    )
    tie(
        "cash-vs-account",
        "account received == Σ summary.account_paid",
        cva["totals"]["account_received_paise"],
        s("account_paid_paise"),
    )
    tie(
        "cash-vs-account",
        "cash agreed == Σ booking.cash_agreed",
        cva["totals"]["cash_agreed_paise"],
        sum(b.get("cash_agreed_paise", 0) for b in live),
    )
    for by in ("project", "block"):
        inv("cash-vs-account", "/reports/cash-vs-account", "cash_balance_paise", by)

    # 5 Cheque register
    chq = g("/reports/cheques")
    tie(
        "cheques",
        "rows == cheque/DD payments",
        chq.get("total_rows") or len(chq["rows"]),
        db.payments.count_documents({"company_id": cid, "payment_mode_code": {"$in": ["CHEQUE", "DD"]}}),
    )
    tie(
        "cheques",
        "amount == Σ instrument amounts",
        chq["totals"]["amount_paise"],
        sum(
            p["amount_paise"]
            for p in db.payments.find(
                {"company_id": cid, "payment_mode_code": {"$in": ["CHEQUE", "DD"]}}, {"amount_paise": 1}
            )
        ),
    )

    # 6 Receivables forecast
    rf = g("/reports/receivables-forecast")
    tie(
        "receivables-forecast",
        "Σ forecast + Σ raised == Σ agreement (live bookings)",
        rf["totals"]["expected_paise"] + rf["totals"]["raised_paise"],
        sum(b["agreement_value_paise"] for b in live),
    )
    tie(
        "receivables-forecast",
        "per booking: forecast == agreement − raised",
        sum(1 for p in rf["per_booking"] if p["forecast_paise"] != p["agreement_paise"] - p["raised_paise"]),
        0,
    )
    for by in ("project", "block", "booking", "stage", "month"):
        inv("receivables-forecast", "/reports/receivables-forecast", "expected_paise", by)
    rf_stage = g("/reports/receivables-forecast", group_by="stage")
    tie(
        "receivables-forecast",
        "default grouping is tower → stage when no planned dates",
        rf["group_by"] in ("stage", "month"),
        True,
    )
    tie(
        "receivables-forecast",
        "stage grouping: one row per tower·stage, Σ == total",
        sum(r["expected_paise"] for r in rf_stage["rows"]),
        rf["totals"]["expected_paise"],
    )

    # 7 Cancellations & refunds
    canc = g("/reports/cancellations", from_date=F0, to_date=F1)
    tie(
        "cancellations",
        "rows == Cancelled bookings",
        len(canc["rows"]),
        db.bookings.count_documents({"company_id": cid, "status": "Cancelled"}),
    )
    tie(
        "cancellations",
        "refund paid == Σ paid refunds",
        canc["totals"]["refund_paid_paise"],
        sum(
            r.get("amount_total_paise") or r["amount_paise"]
            for r in db.refunds.find(
                {"company_id": cid, "status": "Paid", "parent_refund_id": {"$exists": False}},
                {"amount_paise": 1, "amount_total_paise": 1},
            )
        ),
    )
    tie(
        "cancellations",
        "ledger REFUND rows == Σ paid refunds",
        sum(-r["amount_paise"] for r in db.ledger_entries.find({"type": "REFUND"}, {"amount_paise": 1})),
        sum(r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid"}, {"amount_paise": 1})),
    )

    # 8 Bank-wise
    bw = g("/reports/bank-receipts", from_date=F0, to_date=F1)
    tie(
        "bank-receipts",
        "cleared == Σ non-cash cleared",
        bw["totals"]["cleared_paise"],
        sum(
            p["amount_paise"]
            for p in db.payments.find(
                {"company_id": cid, "status": "Cleared", "payment_mode_code": {"$ne": "CASH"}}, {"amount_paise": 1}
            )
        ),
    )
    tie(
        "bank-receipts",
        "pending == Σ non-cash pending",
        bw["totals"]["pending_paise"],
        sum(
            p["amount_paise"]
            for p in db.payments.find(
                {"company_id": cid, "status": "Pending", "payment_mode_code": {"$ne": "CASH"}}, {"amount_paise": 1}
            )
        ),
    )

    # 9 Other charges
    oc = g("/reports/other-charges")
    all_bk = list(db.bookings.find({"company_id": cid}, {"other_charges": 1}))
    tie(
        "other-charges",
        "demanded == Σ other_charges.demanded",
        oc["totals"]["demanded_paise"],
        sum(c.get("demanded_paise", 0) for b in all_bk for c in b.get("other_charges") or []),
    )
    tie(
        "other-charges",
        "collected == Σ other_charges.(paid − waived)",
        oc["totals"]["collected_paise"],
        sum(c.get("paid_paise", 0) - c.get("waived_paise", 0) for b in all_bk for c in b.get("other_charges") or []),
    )
    tie(
        "other-charges",
        "collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals/refunds)",
        oc["totals"]["collected_paise"],
        sum(
            r.get("jama_paise", 0)
            for r in db.ledger_entries.find(
                {
                    "booking_id": {"$in": bk_ids},
                    "$or": [
                        {"type": "OTHER_CHARGE_PAYMENT"},
                        {"type": {"$in": ["REVERSAL", "REFUND"]}, "category": {"$in": [None, "Other"]}},
                    ],  # same rule as services/ledger.py
                },
                {"jama_paise": 1},
            )
        ),
    )
    for by in ("project", "booking"):
        inv("other-charges", "/reports/other-charges", "demanded_paise", by)

    # 10 Roznamcha summary
    rz = g("/reports/roznamcha-summary", from_date=F0, to_date=F1)
    tie(
        "roznamcha-summary",
        "cash received == Σ cleared CASH receipts",
        rz["totals"]["cash_in_paise"],
        sum(
            p["amount_paise"]
            for p in db.payments.find(
                {"company_id": cid, "status": "Cleared", "payment_mode_code": "CASH"}, {"amount_paise": 1}
            )
        ),
    )
    tie(
        "roznamcha-summary",
        "deposits == Σ contra DEPOSIT",
        rz["totals"]["deposit_paise"],
        sum(
            c["amount_paise"]
            for c in db.contra_entries.find(
                {"company_id": cid, "kind": "DEPOSIT", "is_active": {"$ne": False}}, {"amount_paise": 1}
            )
        ),
    )
    tie(
        "roznamcha-summary",
        "closing == opening + cash in − deposits + withdrawals − cash refunds",
        rz["totals"]["closing_paise"],
        rz["totals"]["opening_paise"]
        + rz["totals"]["cash_in_paise"]
        - rz["totals"]["deposit_paise"]
        + rz["totals"]["withdrawal_paise"]
        - rz["totals"]["cash_refund_paise"],
    )
    rzm = g("/reports/roznamcha-summary", from_date=F0, to_date=F1, group_by="month")
    tie(
        "roznamcha-summary",
        "Σ by month == range total (cash in)",
        sum(r["cash_in_paise"] for r in rzm["rows"]),
        rz["totals"]["cash_in_paise"],
    )
    tie(
        "roznamcha-summary",
        "monthly closing == daily closing",
        rzm["totals"]["closing_paise"],
        rz["totals"]["closing_paise"],
    )

    # 11 Inventory
    inv_r = g("/reports/inventory")
    raw = {}
    for f in db.flats.find({"company_id": cid, "is_active": {"$ne": False}}, {"status": 1}):
        raw[f["status"]] = raw.get(f["status"], 0) + 1
    tie("inventory", "units by status == flats", {k: inv_r["totals"].get(k.lower()) for k in raw}, raw)
    tie(
        "inventory",
        "sold value == Σ price of booked/sold flats",
        inv_r["totals"].get("sold_value_paise"),
        sum(
            f.get("price_paise") or 0
            for f in db.flats.find(
                {"company_id": cid, "is_active": {"$ne": False}, "status": {"$in": ["Booked", "Sold"]}},
                {"price_paise": 1},
            )
        ),
    )

    # 12 Lead funnel
    sl = g("/reports/sales-leads", from_date=F0, to_date=F1)
    tie(
        "sales-leads", "leads == leads collection", sl["totals"]["leads"], db.leads.count_documents({"company_id": cid})
    )
    tie(
        "sales-leads",
        "converted == Converted leads",
        sl["totals"]["converted"],
        db.leads.count_documents({"company_id": cid, "status": "Converted"}),
    )

    # 13 Site visits
    sv = g("/reports/site-visits", from_date=F0, to_date=F1)
    tie(
        "site-visits",
        "visits == site_visits",
        sv["totals"]["scheduled"],
        db.site_visits.count_documents(
            {"company_id": cid, "is_active": {"$ne": False}, "date": {"$gte": F0, "$lte": F1}}
        ),
    )
    tie(
        "site-visits",
        "completed == Completed visits",
        sv["totals"]["completed"],
        db.site_visits.count_documents(
            {"company_id": cid, "is_active": {"$ne": False}, "status": "Completed", "date": {"$gte": F0, "$lte": F1}}
        ),
    )
    for by in ("project", "month"):
        inv("site-visits", "/reports/site-visits", "scheduled", by, from_date=F0, to_date=F1)

    # 14 Sales team
    st = g("/reports/sales-team", from_date=F0, to_date=F1)
    tie(
        "sales-team",
        "sold value == Σ live agreement values",
        st["totals"]["sold_paise"],
        sum(b["agreement_value_paise"] for b in live),
    )
    tie(
        "sales-team",
        "collections == Σ cleared receipts of live bookings",
        st["totals"]["collected_paise"],
        sum(
            p["amount_paise"]
            for p in db.payments.find(
                {"company_id": cid, "status": "Cleared", "booking_id": {"$in": [b["id"] for b in live]}},
                {"amount_paise": 1},
            )
        ),
    )
    tie(
        "sales-team",
        "overdue == outstanding report overdue",
        st["totals"]["overdue_paise"],
        o["totals"]["overdue_paise"],
    )

    # 15 Construction vs plan — per-stage rows, subtotals excluded from totals
    cvp = g("/reports/construction-vs-plan")
    blocks = list(
        db.blocks.find({"company_id": cid, "is_active": {"$ne": False}}, {"id": 1, "construction_stages": 1, "name": 1})
    )
    stage_rows = [r for r in cvp["rows"] if not r.get("_subtotal")]
    tie(
        "construction-vs-plan",
        "stage rows == Σ stages of active towers",
        len(stage_rows),
        sum(len(b.get("construction_stages") or []) for b in blocks),
    )
    tie(
        "construction-vs-plan",
        "stage demands == Σ ON_STAGE/ON_POSSESSION demands",
        cvp["totals"]["stage_demanded_paise" if "stage_demanded_paise" in cvp["totals"] else "demanded_paise"],
        sum(
            d["total_demand_paise"]
            for d in db.demands.find(
                {
                    "company_id": cid,
                    "voided": {"$ne": True},
                    "trigger_type": {"$in": ["ON_STAGE", "ON_POSSESSION"]},
                    "block_id": {
                        "$in": [
                            b["id"] for b in db.blocks.find({"company_id": cid, "is_active": {"$ne": False}}, {"id": 1})
                        ]
                    },
                },
                {"total_demand_paise": 1},
            )
        ),
    )
    tie(
        "construction-vs-plan",
        "subtotals == Σ their stage rows (demanded)",
        sum(r["demanded_paise"] for r in cvp["rows"] if r.get("_subtotal")),
        sum(r["demanded_paise"] for r in stage_rows),
    )
    tie(
        "construction-vs-plan",
        "no tower name with leading/trailing space",
        [r["tower"] for r in cvp["rows"] if r["tower"] != r["tower"].strip()],
        [],
    )
    dem_block = g("/payments/demands", block_id=blocks[0]["id"], page_size=200)
    tie(
        "construction-vs-plan",
        "GET /payments/demands honours block_id",
        [d["block_id"] for d in dem_block["items"] if d["block_id"] != blocks[0]["id"]],
        [],
    )

    # 16 Service SLA
    sla = g("/reports/service-sla", from_date=F0, to_date=F1)
    tie(
        "service-sla",
        "tickets == service_requests",
        sla["totals"]["total"],
        db.service_requests.count_documents(
            {"company_id": cid, "is_active": {"$ne": False}, "created_at": clock.day_range(F0, F1)}
        ),
    )

    # 17 Audit trail
    # audit_logs is append-only and written live (logins, after-commit work): the report must fall between a raw count
    # taken just before and just after it — exact when nothing was written in between
    aq = {"company_id": cid, "created_at": clock.day_range(F0, F1)}
    lo = db.audit_logs.count_documents(aq)
    act = g("/reports/activity", from_date=F0, to_date=F1)
    hi = db.audit_logs.count_documents(aq)
    rep_n = sum(a["count"] for a in act["actions"])
    tie(
        "activity",
        "audit actions == audit_logs (live log)",
        rep_n if lo <= rep_n <= hi else f"{rep_n}∉[{lo},{hi}]",
        rep_n,
    )

    # 18 Data quality
    dq = g("/reports/data-quality")
    integ = g("/admin/integrity-report", fresh=1)
    tie(
        "data-quality",
        "open demands on cancelled bookings == 0 (integrity)",
        next(r["count"] for r in dq["rows"] if r["group"].startswith("Open bills on cancelled")),
        0,
    )
    tie(
        "data-quality",
        "towers without stage plan excludes inactive towers",
        next(r["which"] for r in dq["rows"] if r["group"].startswith("Active towers")).count("QA Tower"),
        0,
    )
    tie(
        "data-quality",
        "payment plans not summing 100 == 0",
        next(r["count"] for r in dq["rows"] if r["group"].startswith("Payment plans")),
        0,
    )
    tie("data-quality", "integrity report ok", integ.get("ok"), True)
    _customer_status(g, tie, db, cid, live)
    _customers_f2(g, tie, db, cid, live)
    _finance_f3(g, tie)
    _bookings_f4(g, tie, db, cid)

    def g_as(email):
        t = requests.post(
            f"{A}/auth/login", json={"email": email, "password": DEMO_PASSWORD}, headers=BYPASS, timeout=20
        ).json()["access_token"]
        return lambda p, **k: HTTP.get(A + p, headers={"Authorization": f"Bearer {t}"}, params=k, timeout=90).json()

    _inventory_f5(g, g_as("accounts@kkt.in"), tie, db, cid, g_as("sales@kkt.in"))
    _leads_f6(g, tie, db, cid)
    _bridges_f7(g, tie)

    os.makedirs("/app/memory/qa/reports", exist_ok=True)
    with open("/app/memory/qa/reports/status.md", "w") as f:
        f.write(
            f"# Phase I reports — tie-out status · DB `{os.environ['DB_NAME']}` · {datetime.now(IST).isoformat(timespec='seconds')}\n\n"
        )
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


def _v3_rows(g, key, **params):
    out, page = [], 1
    while True:
        d = g(f"/reports/v3/{key}", page=page, page_size=500, **params)
        out += d["rows"]
        if page * 500 >= d["count"]:
            return d, out
        page += 1


def _customer_status(g, tie, db, cid, live):
    """Phase 3F pilot (REQ-276…278): Customer status vs definitions, the customer card and the ledger."""
    import asyncio

    from services import cards
    from services import definitions as D

    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    R = "customer-status"
    cols = "account_dues,cash_dues,bills_raised,final_status,booking_number"
    d, rows = _v3_rows(g, R, cols=cols)
    t = d["totals"]
    raw = [D.outstanding(b.get("summary") or {}) for b in live]
    tie(
        R,
        "Σ Account dues + Σ Cash dues == instalment outstanding",
        t["account_dues"] + t["cash_dues"],
        sum(o["cash_paise"] + o["account_paise"] for o in raw),
    )
    tie(R, "rows == live bookings", d["count"], len(live))
    ss = [b.get("summary") or {} for b in live]
    tie(
        R,
        "Σ bills raised == Σ Cash + Account order raised",
        t["bills_raised"],
        sum(s.get("cash_order_raised_paise", 0) + s.get("account_order_raised_paise", 0) for s in ss),
    )
    f = t["bills_raised"] - t["account_received"] - t["cash_received"] - t["waived"] + t["instalment_advance"]
    tie(R, "formula: raised − received − waived + advance == dues", f, t["account_dues"] + t["cash_dues"])
    full = {b["id"]: b for b in db.bookings.find({"id": {"$in": [b["id"] for b in live]}}, {"_id": 0})}
    card = run(cards.booking_cards(list(full.values())))
    kind = {}
    for bid, c in card.items():
        bal = c["balance"]
        kind[bid] = ("overdue" if bal["overdue_days"] else "due") if bal["state"] == "due" else bal["state"]
    got = {r["booking_id"]: r for r in rows}
    tie(
        R,
        "final status kind == customer card, every booking",
        sum(1 for b, k in kind.items() if got.get(b, {}).get("status_kind") != k),
        0,
    )
    od = {b: c["balance"]["overdue_days"] for b, c in card.items()}
    lab = sum(
        1
        for b, n in od.items()
        if n and not (got.get(b, {}).get("final_status") or "").startswith(f"Overdue {n} day{'s' if n != 1 else ''}")
    )
    tie(R, "overdue days == customer card, every booking", lab, 0)
    today = clock.today()
    snap = run(D.shares_as_of(list(full), today))
    keys = (
        "cash_due_paise",
        "account_due_paise",
        "other_charges_due_paise",
        "outstanding_paise",
        "advance_paise",
        "cash_paid_paise",
        "account_paid_paise",
        "cash_waived_paise",
        "account_waived_paise",
    )
    bad = sum(
        1
        for b in full.values()
        if any((snap.get(b["id"]) or {}).get(k, 0) != (b.get("summary") or {}).get(k, 0) for k in keys)
    )
    tie(R, "ledger share state today == booking summary (as-of path)", bad, 0)
    fy = today.year if today.month >= 4 else today.year - 1
    eom = f"{fy}-03-31"
    d31, rows31 = _v3_rows(g, R, as_of=eom, include_cancelled=1, cols="booking_number")
    ids31 = [r["booking_id"] for r in rows31 if r.get("status_kind") not in ("cancelled", "transferred")]
    net31 = d31["totals"]["account_dues"] + d31["totals"]["cash_dues"] - d31["totals"]["instalment_advance"]
    raw31 = 0
    for b in ids31:
        e = db.ledger_entries.find_one({"booking_id": b, "date": {"$lte": eom}}, sort=[("seq", -1)])
        raw31 += (e or {}).get("cash_due_paise", 0) + (e or {}).get("account_due_paise", 0)
    tie(R, f"as of {eom}: instalment net dues == ledger rows on that day", net31, raw31)
    oc31 = 0
    for b in ids31:
        e = db.ledger_entries.find_one({"booking_id": b, "date": {"$lte": eom}}, sort=[("seq", -1)])
        # other-charge net billed − received on that day = running balance − instalment shares (row's other due counts unbilled)
        oc31 += (
            (e or {}).get("balance_paise", 0)
            - (e or {}).get("cash_due_paise", 0)
            - (e or {}).get("account_due_paise", 0)
        )
    car = run(D.carried(ids31, f"{fy}-04-01", today.isoformat()))
    tie(
        R,
        f"as of {eom} instalment net + other-charge net == carried from before at {fy}-04-01",
        net31 + oc31,
        car["opening_paise"],
    )
    grp = g(f"/reports/v3/{R}", group="project,tower")
    tie(
        R,
        "Σ project subtotals == total dues",
        sum(x["totals"]["account_dues"] + x["totals"]["cash_dues"] for x in grp["groups"]),
        t["account_dues"] + t["cash_dues"],
    )
    tie(
        R,
        "Σ tower subtotals == project subtotal",
        sum(sum(c["totals"]["cash_dues"] for c in x["children"]) == x["totals"]["cash_dues"] for x in grp["groups"]),
        len(grp["groups"]),
    )


def _customers_f2(g, tie, db, cid, live):
    """Phase 3F F2: the other Customers reports against definitions / raw collections."""
    from services import definitions as D

    out = [D.outstanding(b.get("summary") or {})["total_paise"] for b in live]
    d, rows = _v3_rows(g, "customer-ageing")
    t = d["totals"]
    bands = sum(t[k] for k in ("band_not_due", "band_0_30", "band_31_60", "band_61_90", "band_90p"))
    tie("customer-ageing", "Σ bands == Σ total due", bands, t["total_due"])
    tie("customer-ageing", "Σ total due == Σ outstanding (definitions) of live bookings", t["total_due"], sum(out))
    tie("customer-ageing", "rows == live bookings with dues", d["count"], sum(1 for o in out if o > 0))
    ov = g("/reports/outstanding-v2")
    tot = (ov.get("totals") or {}).get("total_paise") or (ov.get("totals") or {}).get("outstanding_paise")
    if tot is not None:
        tie("customer-ageing", "Σ total due == Outstanding & ageing report total", t["total_due"], tot)
    cs = g("/reports/v3/customer-status", page_size=10)["totals"]
    tie("customer-status", "formula bridge: total due == Overdue & ageing total due", cs["total_due"], t["total_due"])
    a = g("/reports/v3/advance-holders", page_size=500)
    tie(
        "advance-holders",
        "Σ advance == Σ booking advance (definitions)",
        a["totals"]["advance_total"],
        sum(D.advance(b.get("summary") or {}) for b in live),
    )
    c = g("/reports/v3/call-list", page_size=500)
    tie("call-list", "Σ due == ageing Σ total due", c["totals"]["total_due"], t["total_due"])
    tie("call-list", "Σ overdue == ageing Σ overdue", c["totals"]["overdue_amount"], t["overdue_amount"])
    days = [r["days_overdue"] for r in c["rows"]]
    tie("call-list", "sorted oldest first", days == sorted(days, reverse=True), True)
    k = g("/reports/v3/kyc-pending", page_size=500, pending="agreement", show_complete=1)
    raw = db.bookings.count_documents(
        {"company_id": cid, "status": LIVE, "plan_acceptance.accepted_on": {"$in": [None, ""]}}
    )
    tie("kyc-pending", "agreement pending == live bookings without signed agreement", k["count"], raw)
    pb = g("/reports/v3/payment-behaviour", page_size=500)
    rows_pb = pb["rows"]
    tie(
        "payment-behaviour",
        "customers == customers with live bookings",
        pb["count"],
        len({b.get("customer_id") for b in db.bookings.find({"company_id": cid, "status": LIVE}, {"customer_id": 1})}),
    )
    tie(
        "payment-behaviour",
        "on time ≤ bills due on every row",
        all(r["on_time"] <= r["bills_due"] for r in rows_pb),
        True,
    )
    dr = g("/reports/v3/customer-directory", page_size=10)
    tie(
        "customer-directory",
        "rows == customers (not deleted)",
        dr["count"],
        db.customers.count_documents({"company_id": cid, "deleted_at": None}),
    )
    cc = g("/reports/v3/cancelled-customers", page_size=500)
    canc = list(db.bookings.find({"company_id": cid, "status": "Cancelled"}, {"id": 1, "cancellation": 1}))
    tie(
        "cancelled-customers",
        "Σ refund payable == Σ cancellation refund",
        cc["totals"]["refund_payable"],
        sum((b.get("cancellation") or {}).get("refund_paise") or 0 for b in canc),
    )
    rp = sum(
        (r.get("amount_paise") or 0)
        for r in db.refunds.find({"booking_id": {"$in": [b["id"] for b in canc]}, "status": "Paid"})
    )
    tie("cancelled-customers", "Σ refund paid == Σ refunds paid on cancelled bookings", cc["totals"]["refund_paid"], rp)
    b0 = max(live, key=lambda b: (b.get("summary") or {}).get("waived_paise", 0))
    cust = db.bookings.find_one({"id": b0["id"]})["customer_id"]
    st = g("/reports/v3/customer-statement", customer=cust, page_size=500)
    bal = sum(st["totals"][x] * s for x, s in (("bill", 1), ("received", -1), ("waived", -1)))
    last = {}
    for r in st["rows"]:
        last[r["booking_id"]] = r["balance"]
    tie("customer-statement", "bills − received − waived == Σ last running balance", bal, sum(last.values()))
    s0 = sum((db.bookings.find_one({"id": i})["summary"] or {}).get("total_udhar_paise", 0) for i in last)
    tie("customer-statement", "Σ bills == Σ booking Udhar", st["totals"]["bill"], s0)


def _finance_f3(g, tie):
    """Phase 3F F3: each Finance report on the new sheet == the existing report it replaced (before/after), at the
    existing report's own default grouping and at its finest grouping, plus a filtered pair."""
    from reports_v3.registry import REGISTRY

    pairs = {
        "collections": ("collections-v2", ["group_by=month", "group_by=receipt"]),
        "day-book": ("roznamcha-summary", ["group_by=month", "group_by=day"]),
        "bank-receipts": ("bank-receipts", [""]),
        "cheques": ("cheques", [""]),
        "bills-vs-collection": ("demand-vs-collection", [""]),
        "outstanding": ("outstanding-v2", ["group_by=project", "group_by=booking"]),
        "cash-vs-account": ("cash-vs-account", ["group_by=project", "group_by=booking"]),
        "other-charges": ("other-charges", ["group_by=charge", "group_by=booking"]),
        "receivables-forecast": ("receivables-forecast", ["group_by=stage", "group_by=booking"]),
        "waivers": ("waiver-register", [""]),
    }
    for key, (old, groupings) in pairs.items():
        resp = g(f"/reports/v3/{key}", page_size=10)
        new = resp["totals"]
        dflt = resp.get("defaults") or {}
        period = {"from_date": dflt["period_from"], "to_date": dflt["period_to"]} if dflt.get("_default_period") else {}
        money = [t for t in REGISTRY[key]["totals"] if t.endswith("_paise")]
        for gp in groupings:
            q = dict(x.split("=") for x in gp.split("&") if x) | period
            before = g(f"/reports/{old}", **q).get("totals") or {}
            same = [k for k in money if k in before]
            tie(
                key,
                f"new sheet == {old}{' (' + gp + ')' if gp else ''}: {len(same)} money totals",
                {k: round(new[k]) for k in same},
                {k: round(before[k]) for k in same},
            )
    pid = g("/reports/v3/outstanding")["options"]["project"][0]["value"]
    a = g("/reports/v3/outstanding", project=pid)["totals"]["outstanding_paise"]
    b = (g("/reports/outstanding-v2", project_id=pid).get("totals") or {}).get("outstanding_paise")
    tie("outstanding", "filtered by one project == existing report filtered the same way", a, b)
    fr, to = "2026-04-01", "2026-09-30"
    a = g("/reports/v3/collections", period_from=fr, period_to=to)["totals"]["total_paise"]
    b = (g("/reports/collections-v2", from_date=fr, to_date=to).get("totals") or {}).get("total_paise")
    tie("collections", f"period {fr}…{to} == existing report same period", a, b)


def _bookings_f4(g, tie, db, cid):
    """Phase 3F F4: Bookings reports tie to the bookings collection, Customer status and the existing reports."""
    wide = {"period_from": "2000-01-01", "period_to": "2099-12-31"}
    reg = g("/reports/v3/booking-register", booking_status="Active,Completed", page_size=1)["totals"]
    raw = sum(
        b.get("agreement_value_paise") or 0
        for b in db.bookings.find(
            {"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"agreement_value_paise": 1}
        )
    )
    tie(
        "booking-register", "Σ agreement value (Active + Completed) == bookings collection", reg["agreement_value"], raw
    )
    d = g("/reports/v3/sales-summary", page_size=1)
    fy = d["defaults"]
    r = g(
        "/reports/v3/booking-register",
        booking_status="Active,Completed",
        period_from=fy["period_from"],
        period_to=fy["period_to"],
        page_size=1,
    )
    tie(
        "sales-summary",
        "Σ bookings this FY == booking register (not cancelled) this FY",
        d["totals"]["bookings"],
        r["count"],
    )
    tie(
        "sales-summary",
        "Σ agreement value this FY == booking register this FY",
        d["totals"]["agreement_value"],
        r["totals"]["agreement_value"],
    )
    new = g("/reports/v3/discount-register", **wide)["totals"]
    old = g("/reports/discount-register", from_date="2000-01-01", to_date="2099-12-31")["totals"]
    tie(
        "discount-register",
        "Σ discount (all dates) == existing Discount register",
        new["discount_paise"],
        old["discount_paise"],
    )
    tie(
        "discount-register",
        "Σ discount (all dates) == booking register discount (Active + Completed)",
        new["discount_paise"],
        reg["discount"],
    )
    cs = g("/reports/v3/customer-status", page_size=1)["totals"]
    pp = g("/reports/v3/plan-position", page_size=1)["totals"]
    tie("plan-position", "Σ bills raised == Customer status", pp["bills_raised"], cs["bills_raised"])
    tie(
        "plan-position",
        "Σ received == Customer status Account + Cash received",
        pp["received"],
        cs["account_received"] + cs["cash_received"],
    )
    ag = g("/reports/v3/agreements", page_size=1)
    signed = db.bookings.count_documents(
        {
            "company_id": cid,
            "status": {"$in": ["Active", "Completed"]},
            "plan_acceptance.accepted_on": {"$nin": [None, ""]},
        }
    )
    tie(
        "agreements",
        "signed + pending == live bookings",
        ag["totals"]["signed"] + ag["totals"]["pending"],
        pp and g("/reports/v3/plan-position", page_size=1)["count"],
    )
    tie("agreements", "signed == live bookings with an accepted plan", ag["totals"]["signed"], signed)
    new = g("/reports/v3/cancellations", **wide)["totals"]
    old = g("/reports/cancellations", from_date="2000-01-01", to_date="2099-12-31")["totals"]
    tie("cancellations", "Σ refund payable == existing Cancellations report", new["refund_paise"], old["refund_paise"])
    tie(
        "cancellations",
        "Σ refund paid == existing Cancellations report",
        new["refund_paid_paise"],
        old["refund_paid_paise"],
    )
    tr = g("/reports/v3/transfers", **wide)
    n = sum(
        len(b.get(k) or [])
        for b in db.bookings.find({"company_id": cid}, {"transfers": 1, "agreement_revisions": 1, "discount_events": 1})
        for k in ("transfers", "agreement_revisions", "discount_events")
    )
    ids = db.bookings.distinct("id", {"company_id": cid})
    n += db.audit_logs.count_documents({"company_id": cid, "action": "booking.plan_change", "entity_id": {"$in": ids}})
    tie(
        "transfers",
        "changes == transfers + revisions + price events on bookings + plan changes in audit log (bookings that exist)",
        tr["totals"]["changes"],
        n,
    )
    new = g("/reports/v3/sales-team", **wide)["totals"]
    old = g("/reports/sales-team", from_date="2000-01-01", to_date="2099-12-31")["totals"]
    tie("sales-team", "Σ sold (all dates) == existing Sales team report", new["sold_paise"], old["sold_paise"])
    tie("sales-team", "Σ bookings (all dates) == existing Sales team report", new["bookings"], old["bookings"])
    rr = g("/reports/v3/realised-rate", page_size=1)["totals"]
    tie("realised-rate", "Σ agreement value == Plan & stage position", rr["agreement_value"], pp["agreement_value"])
    tie("realised-rate", "Σ list − Σ agreement == Σ discount", rr["list_value"] - rr["agreement_value"], rr["discount"])
    bh = g("/reports/v3/booking-health", page_size=1)["totals"]
    tie(
        "booking-health",
        "Σ overdue == Customer status overdue",
        bh["overdue_amount"],
        cs.get("overdue_amount", g("/reports/v3/customer-ageing", page_size=1)["totals"]["overdue_amount"]),
    )
    tie("booking-health", "Σ total due == Customer status total due", bh["total_due"], cs["total_due"])
    tie(
        "booking-health",
        "healthy + watch + at risk == live bookings",
        sum(bh["health_counts"].values()),
        g("/reports/v3/plan-position", page_size=1)["count"],
    )


def _inventory_f5(g, g_acc, tie, db, cid, g_sales=None):
    """Phase 3F F5: Project & inventory reports tie to the flats / parking masters, the existing reports and Customer
    status — and a viewer without real-status sees exactly the display layer the existing report gives a privileged viewer."""
    from datetime import date, timedelta

    pid = db.projects.find_one({"company_id": cid, "code": "SGH"})["id"]
    new = g("/reports/v3/project-statement", project=pid)["totals"]
    old = g("/reports/project-statement", project_id=pid)["totals"]
    for k in ("bill_raised_paise", "received_paise", "balance_signed_paise"):
        tie("project-statement", f"SGH Σ {k[:-6].replace('_', ' ')} == existing Project statement", new[k], old[k])
    inv = g("/reports/v3/inventory-status", page_size=1)["totals"]
    ctl = g("/reports/inventory-control")["totals"]
    for s in ("Available", "Hold", "Blocked", "Booked", "Sold"):
        tie(
            "inventory-status",
            f"{s} flats (real layer) == existing Inventory control",
            inv["by_status"][s],
            ctl[s.lower()],
        )
    acc = g_acc("/reports/v3/inventory-status", page_size=1)["totals"]
    for s, k in (("Available", "show_available"), ("Hold", "show_hold"), ("Sold", "show_sold")):
        tie(
            "inventory-status",
            f"{s} flats for a display-layer viewer == shown-as {s.lower()} in Inventory control",
            acc["by_status"].get(s, 0),
            ctl[k],
        )
    tie(
        "inventory-status",
        "display-layer viewer sees no Booked / Blocked",
        acc["by_status"].get("Booked", 0) + acc["by_status"].get("Blocked", 0),
        0,
    )
    st = g("/reports/v3/stacking-plan", page_size=1)
    cells = sum(len(f["flats"]) for p in st["illustration"]["projects"] for t in p["towers"] for f in t["floors"])
    tie("stacking-plan", "cells == flats in Inventory status", cells, inv["flats"])
    pl = g("/reports/v3/price-list", page_size=1)["totals"]
    tie(
        "price-list",
        "Σ list price of available flats == existing Inventory available value",
        pl["value_by_status"]["Available"],
        g("/reports/inventory")["totals"]["available_value_paise"],
    )
    tie(
        "price-list",
        "unsold == available + hold in Inventory status",
        pl["flats"],
        inv["by_status"]["Available"] + inv["by_status"]["Hold"],
    )
    hr = g("/reports/v3/hold-register", page_size=1)["totals"]
    tie(
        "hold-register",
        "active holds == flats on Hold in the flats master",
        hr["holds"],
        db.flats.count_documents({"company_id": cid, "status": "Hold", "deleted_at": None}),
    )
    leg = g("/reports/hold-register")["totals_extra"]
    tie("hold-register", "holds == existing Hold register active holds", hr["holds"], leg["active"])
    tie("hold-register", "lapsing within 48 h == existing Hold register expiring", hr["expiring"], leg["expiring_48h"])
    sal = g_sales("/reports/v3/inventory-status", page_size=1)["totals"]
    for s_, k in (("Available", "show_available"), ("Hold", "show_hold"), ("Sold", "show_sold")):
        tie(
            "inventory-status",
            f"{s_} flats for Sales (display layer) == shown-as {s_.lower()} in Inventory control",
            sal["by_status"].get(s_, 0),
            ctl[k],
        )
    lo = g("/reports/v3/landowner", page_size=1)["totals"]
    tie(
        "landowner",
        "landowner units == existing Landowner share",
        (lo.get("kinds") or {}).get("Landowner", 0),
        g("/reports/landowner-share")["totals"]["landowner"],
    )
    tie(
        "landowner",
        "masked units == existing Masked inventory",
        (lo.get("kinds") or {}).get("Masked", 0),
        len([r for r in g("/reports/masked-inventory")["rows"] if not r.get("_subtotal")]),
    )
    pk = g("/reports/v3/parking", page_size=1)["totals"]
    for s in db.parking_slots.distinct("status", {"company_id": cid}):
        tie(
            "parking",
            f"{s} slots == parking slots master",
            pk["by_status"].get(s, 0),
            db.parking_slots.count_documents({"company_id": cid, "status": s, "deleted_at": None}),
        )
    new = g("/reports/v3/construction-vs-plan", page_size=1)["totals"]
    old = g("/reports/construction-vs-plan")["totals"]
    for k in ("demanded_paise", "collected_paise", "balance_paise"):
        tie("construction-vs-plan", f"Σ {k[:-6]} == existing Construction vs plan", new[k], old[k])
    sb = g("/reports/v3/stage-bills", page_size=1)["totals"]
    cs = g("/reports/v3/customer-status", page_size=1)["totals"]
    tie("stage-bills", "Σ bills raised == Customer status", sb["bills_raised"], cs["bills_raised"])
    tie(
        "stage-bills",
        "Σ received == Customer status Account + Cash",
        sb["received"],
        cs["account_received"] + cs["cash_received"],
    )
    tie(
        "stage-bills",
        "Σ instalment dues == Customer status",
        sb["instalment_dues"],
        cs["account_dues"] + cs["cash_dues"],
    )
    sv = g("/reports/v3/sales-velocity", page_size=1)["totals"]
    tie(
        "sales-velocity",
        "Σ unsold == Inventory status available + hold",
        sv["unsold"],
        inv["by_status"]["Available"] + inv["by_status"]["Hold"],
    )
    today = date.fromisoformat(g("/reports/v3/sales-summary", page_size=1)["defaults"]["period_to"])
    frm = (today - timedelta(days=round(30.44 * 12)) + timedelta(days=1)).isoformat()
    reg = g(
        "/reports/v3/booking-register",
        booking_status="Active,Completed",
        period_from=frm,
        period_to=today.isoformat(),
        page_size=1,
    )
    tie("sales-velocity", "Σ booked in the last 12 months == booking register same window", sv["m12"], reg["count"])


def _bridges_f7(g, tie):
    """Phase 3F F7: sibling reports that count on a different basis reconcile to the paisa through their bridge."""
    bw = g("/reports/v3/bank-receipts", page_size=1)["totals"]
    co = g("/reports/v3/collections", page_size=1)["totals"]
    tie(
        "bank-receipts",
        "Collections == Bank-wise total − pending + cash receipts − reversals (this FY, to the paisa)",
        co["total_paise"],
        bw["total_paise"] - bw["pending_paise"] + bw["br_cash"] + bw["br_reversal"],
    )
    tie("bank-receipts", "bridge has no unexplained remainder", bw["br_rest"], 0)
    bv = g("/reports/v3/bills-vs-collection", page_size=1)["totals"]
    cs = g("/reports/v3/customer-status", page_size=1)["totals"]
    tie(
        "bills-vs-collection",
        "bill raised − on cancelled/transferred ± transfer adjustments == Customer status bills raised",
        bv["demand_paise"] - bv["br_not_live"] + bv["br_adjust"],
        cs["bills_raised"],
    )
    tie(
        "customer-status",
        "Customer status bridge line == Bills vs Collection bridge",
        (cs["br_instalment"], cs["br_not_live"], cs["br_adjust"]),
        (bv["demand_paise"], bv["br_not_live"], bv["br_adjust"]),
    )


def _leads_f6(g, tie, db, cid):
    """Phase 3F F6: Leads reports tie to the leads / site-visit masters and the existing Sales & leads and Site visit reports."""
    fn = g("/reports/v3/lead-funnel")
    fy = fn["defaults"]
    old = g("/reports/sales-leads", from_date=fy["period_from"], to_date=fy["period_to"])
    by = {r["stage"]: r["leads"] for r in fn["rows"]}
    for s in old["funnel"]:
        tie(
            "lead-funnel", f"{s['stage']} (this FY) == existing Sales & leads funnel", by.get(s["stage"], 0), s["count"]
        )
    tie("lead-funnel", "Σ leads (this FY) == existing Sales & leads", fn["totals"]["leads"], old["totals"]["leads"])
    sp = {r["source"]: r for r in g("/reports/v3/source-performance", page_size=50)["rows"]}
    for r in old["rows"]:
        tie(
            "source-performance",
            f"{r['source']} leads / converted == existing Sales & leads",
            (sp[r["source"]]["leads"], sp[r["source"]]["converted"]),
            (r["leads"], r["converted"]),
        )
    reg = g("/reports/v3/lead-register", page_size=1)
    live = db.leads.count_documents({"company_id": cid, "deleted_at": None})
    tie("lead-register", "leads == leads master (live)", reg["count"], live)
    wide = {"from_date": "2000-01-01", "to_date": "2099-12-31"}
    fu = g("/reports/v3/follow-ups", page_size=1)["totals"]
    tie(
        "follow-ups",
        "overdue == existing Sales & leads follow-ups overdue (all dates)",
        fu["fu"]["Overdue"],
        g("/reports/sales-leads", **wide)["follow_ups_overdue"],
    )
    vr = g("/reports/v3/visit-register", page_size=1)
    sv = g("/reports/site-visits", from_date=vr["defaults"]["period_from"], to_date=vr["defaults"]["period_to"])[
        "totals"
    ]
    c = vr["totals"]["by_status"]
    tie(
        "visit-register",
        "completed / no-show / cancelled (this FY) == existing Site visit conversion",
        (c.get("Completed", 0), c.get("No-show", 0), c.get("Cancelled", 0)),
        (sv["completed"], sv["no_show"], sv["cancelled"]),
    )
    tie("visit-register", "visits (this FY) == existing scheduled", vr["count"], sv["scheduled"])
    tie(
        "visit-register",
        "booked after visit (this FY) == existing converted",
        vr["totals"]["converted_n"],
        sv["converted"],
    )
    vc = g("/reports/v3/visit-conversion", page_size=1)["totals"]
    tie(
        "visit-conversion",
        "scheduled / completed / booked == existing Site visit conversion",
        (vc["scheduled"], vc["completed"], vc["converted"]),
        (sv["scheduled"], sv["completed"], sv["converted"]),
    )
    lo = g("/reports/v3/lost-leads", page_size=1)
    tie(
        "lost-leads",
        "lost == leads master status Lost",
        lo["count"],
        db.leads.count_documents({"company_id": cid, "deleted_at": None, "status": "Lost"}),
    )
    rt = g("/reports/v3/response-time", page_size=1)
    tie(
        "response-time",
        "responded + not yet == leads this FY (Lead funnel)",
        sum(rt["totals"]["bands"].values()),
        fn["totals"]["leads"],
    )
    ag = g("/reports/v3/lead-ageing", page_size=1)
    tie(
        "lead-ageing",
        "open leads == leads master open stages",
        ag["count"],
        db.leads.count_documents(
            {
                "company_id": cid,
                "deleted_at": None,
                "status": {"$in": ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation"]},
            }
        ),
    )
    tp = g("/reports/v3/team-pipeline", page_size=50)["totals"]
    tie("team-pipeline", "Σ open == Lead ageing open leads", tp["open"], ag["count"])
    tie("team-pipeline", "Σ follow-ups overdue == Follow-ups overdue", tp["fu_overdue"], fu["fu"]["Overdue"])
    rt_t = rt["totals"]
    tie(
        "response-time",
        "average first response (this FY) == existing Sales & leads avg_response_hours",
        rt_t["avg_h"],
        old["avg_response_hours"],
    )
    sla = g("/reports/v3/service-sla", period_from="2000-01-01", period_to="2099-12-31", page_size=1)["totals"]
    old = g("/reports/service-sla", **wide)["totals"]
    tie(
        "service-sla",
        "requests / open / resolved == existing Service requests & SLA",
        (sla["total"], sla["open"], sla["resolved"]),
        (old["total"], old["open"], old["resolved"]),
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    sys.exit(0 if main(ap.parse_args().base) else 1)
