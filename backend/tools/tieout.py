"""Phase F report tie-outs: every report/tile vs. raw collections on the current DB. Read-only.
Usage: python tools/tieout.py [--base URL]  → prints PASS/FAIL table and writes /app/memory/qa/journey/tieout_raw.md"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from _env import DEMO_PASSWORD

IST = timezone(timedelta(hours=5, minutes=30))

import requests

HTTP = requests.Session()  # keep-alive: thousands of reads would otherwise exhaust ephemeral ports (TIME-WAIT)
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}


OUT = "/app/memory/qa/journey/tieout_raw.md"


def main(base):
    A = base.rstrip("/") + "/api"
    tok = requests.post(
        f"{A}/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}, headers=BYPASS, timeout=20
    ).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({})["id"]

    def g(p, **k):
        return HTTP.get(A + p, headers=H, params=k, timeout=60).json()

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
    tie(
        "cheque register rows == instrument payments",
        chq.get("total_rows") or len(chq.get("rows", [])),
        sum(by_status.values()),
        f"raw by status {by_status}",
    )

    inv = g("/reports/inventory")
    raw_inv = {}
    for f in db.flats.find({"company_id": cid, "is_active": {"$ne": False}}, {"status": 1}):
        raw_inv[f["status"]] = raw_inv.get(f["status"], 0) + 1
    t = inv.get("totals", {})
    rep_inv = {
        "Available": t.get("available"),
        "Hold": t.get("hold"),
        "Booked": t.get("booked"),
        "Sold": t.get("sold"),
        "Blocked": t.get("blocked"),
    }
    tie(
        "inventory report by_status == flats",
        {k: v for k, v in rep_inv.items() if v},
        {k: v for k, v in raw_inv.items() if v},
    )
    home = g("/dashboard/home", fresh=1)
    tie(
        "home units/available tiles == flats",
        (home["totals"]["units"], home["totals"]["available"]),
        (sum(raw_inv.values()), raw_inv.get("Available", 0)),
    )
    leg_inv = g("/dashboard")["inventory"]
    tie("legacy dashboard inventory == flats", {k: v for k, v in leg_inv.items() if k in raw_inv}, raw_inv)

    out = g("/reports/outstanding")
    raw_due = 0
    for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1}):
        s = b.get("summary") or {}
        raw_due += (
            max(s.get("cash_due_paise", 0), 0)
            + max(s.get("account_due_paise", 0), 0)
            + max(s.get("other_charges_due_paise", 0), 0)
        )  # definitions.outstanding
    tie("outstanding total == Σ booking summary dues", out["totals"]["due_paise"], raw_due)
    sys.path.insert(0, "/app/backend")
    from services.definitions import ageing_bands, overdue_of

    overdue_raw, bands_raw = 0, {}
    for b in db.bookings.find(
        {"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"id": 1, "summary": 1, "other_charges": 1}
    ):
        bb = ageing_bands(
            b.get("summary") or {},
            list(db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}})),
            b.get("other_charges") or [],
            datetime.now(IST).date(),
        )
        overdue_raw += overdue_of(bb)
        for k, v in bb.items():
            bands_raw[k] = bands_raw.get(k, 0) + v
    tie(
        "home overdue tile == Σ bookings overdue (definitions.ageing_bands)",
        home["totals"]["overdue_paise"],
        overdue_raw,
    )
    tie("report overdue == Σ bookings overdue", out["totals"]["overdue_paise"], overdue_raw)
    tie("dashboard overdue == report overdue", home["totals"]["overdue_paise"], out["totals"]["overdue_paise"])
    out2 = g("/reports/outstanding-v2")["totals"]
    byb = g("/reports/outstanding-v2")["rows"]
    byc = g("/reports/outstanding-v2", group_by="customer")["rows"]
    tie(  # iteration 12: grouped by customer id, not by name (same-name customers stay apart)
        "Outstanding by customer: one row per customer id",
        len(byc),
        len({r["customer_id"] for r in byb}),
    )
    tie(
        "Outstanding by customer Σ net balance == by booking Σ net balance",
        sum(r["net_balance_paise"] for r in byc),
        sum(r["net_balance_paise"] for r in byb),
    )
    for k, v in bands_raw.items():  # REQ-209: per band, not just the total
        tie(
            f"Outstanding & Ageing band {k} == Σ bookings band {k} (definitions.ageing_bands)", out2.get(f"band_{k}"), v
        )
    from services.definitions import overdue_days

    days_raw = {
        b["id"]: overdue_days(
            b.get("summary") or {},
            list(db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}})),
            b.get("other_charges") or [],
            datetime.now(IST).date(),
        )
        for b in db.bookings.find(
            {"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"id": 1, "summary": 1, "other_charges": 1}
        )
    }
    bcards, pg = {}, 1
    while True:
        r = g("/bookings", page_size=200, page=pg, include="card")
        bcards |= {b["id"]: b.get("card") or {} for b in r["items"]}
        if pg * 200 >= r.get("total", 0):
            break
        pg += 1
    tie(
        "booking card overdue days == definitions.overdue_days (every live booking)",
        sum(1 for i, d in days_raw.items() if ((bcards.get(i) or {}).get("balance") or {}).get("overdue_days") == d),
        len(days_raw),
    )
    # REQ-205 (iteration 12): every other-charge part carries its bill day; due_on = stage bill due or bill_day + days-to-pay
    from datetime import date as _date

    from services.definitions import days_to_pay

    dtp = days_to_pay(db.companies.find_one({"id": cid}, {"demand_due_days": 1}))
    from services.oc_parts_migration import _bill_of

    bills = {}
    for d in db.demands.find(
        {"company_id": cid, "voided": {"$ne": True}},
        {"_id": 0, "booking_id": 1, "trigger_stage_id": 1, "demand_date": 1, "due_date": 1, "cumulative_percent": 1},
    ):
        bills.setdefault(d["booking_id"], []).append(d)
    parts = [
        (h, _bill_of(h, bills.get(b["id"]) or []))
        for b in db.bookings.find({"company_id": cid}, {"id": 1, "other_charges": 1})
        for ln in b.get("other_charges") or []
        for h in ln.get("demand_history") or []
    ]
    tie(
        "other-charge parts with bill_day <= due_on",
        sum(1 for h, _ in parts if h.get("bill_day") and h.get("due_on") and h["bill_day"] <= h["due_on"]),
        len(parts),
    )
    tie(
        "GST-with-stage part bill_day == the day of the instalment bill it was billed with",
        sum(1 for h, bill in parts if bill and h.get("bill_day") == bill["demand_date"]),
        sum(1 for _, bill in parts if bill),
    )
    tie(
        "other-charge part due_on == its bill's due, else bill_day + days-to-pay",
        sum(
            1
            for h, bill in parts
            if h.get("bill_day")
            and h.get("due_on")
            == (bill["due_date"] if bill else (_date.fromisoformat(h["bill_day"]) + timedelta(days=dtp)).isoformat())
        ),
        len(parts),
    )
    tie(
        "ageing bands sum == report total outstanding",
        sum(a["amount_paise"] for a in out["ageing"]),
        out["totals"]["due_paise"],
    )
    tie("report bands == Σ booking bands", {a["bucket"]: a["amount_paise"] for a in out["ageing"]}, bands_raw)

    tie("home outstanding tile == Σ booking dues", home["totals"]["outstanding_paise"], raw_due)
    tie(
        "home outstanding tile == outstanding report due",
        home["totals"]["outstanding_paise"],
        out["totals"]["due_paise"],
    )
    sum_summ = sum(
        ((b.get("summary") or {}).get("outstanding_paise") or 0)
        for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1})
    )
    tie(
        "ONE NUMBER: Home outstanding == Outstanding report total",
        home["totals"]["outstanding_paise"],
        out["totals"]["due_paise"],
    )
    tie(
        "ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise",
        out["totals"]["due_paise"],
        sum_summ,
    )
    sum_adv = sum(
        ((b.get("summary") or {}).get("advance_paise") or 0)
        for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"summary": 1})
    )
    tie("Home advance held == Σ booking.summary.advance_paise", home["totals"].get("advance_paise", 0), sum_adv)
    rf_api = g("/refunds", page_size=1)
    rf_paid_raw = sum(
        r.get("amount_total_paise") or r["amount_paise"]
        for r in db.refunds.find(
            {"company_id": cid, "status": "Paid", "parent_refund_id": {"$exists": False}},
            {"amount_paise": 1, "amount_total_paise": 1},
        )
    )
    tie(
        "refunds API Paid total == Σ paid refunds",
        (rf_api.get("totals", {}).get("Paid") or {}).get("amount_paise", 0),
        rf_paid_raw,
    )
    canc = g("/reports/cancellations", from_date="2020-01-01", to_date="2030-12-31")
    tie("cancellations report refund paid == Σ paid refunds", canc["totals"].get("refund_paid_paise", 0), rf_paid_raw)
    ledger_refund = sum(-r["amount_paise"] for r in db.ledger_entries.find({"type": "REFUND"}, {"amount_paise": 1}))
    tie(
        "ledger REFUND contra rows == Σ paid refunds (all buckets)",
        ledger_refund,
        sum(r["amount_paise"] for r in db.refunds.find({"company_id": cid, "status": "Paid"}, {"amount_paise": 1})),
    )
    bounce_lines = sum(
        1
        for b in db.bookings.find({"company_id": cid, "other_charges.demand_at": "on_bounce"}, {"other_charges": 1})
        for l in b["other_charges"]
        if l.get("demand_at") == "on_bounce"
    )
    bounce_audits = db.audit_logs.count_documents(
        {
            "action": "booking.other_charge_demand",
            "after.source": "bounce",
            "entity_id": {"$in": [b["id"] for b in db.bookings.find({"company_id": cid}, {"id": 1})]},
        }
    )  # audit is immutable across reseeds
    tie("bounce charges on bookings == bounce-charge audit rows", bounce_lines, bounce_audits)
    tr_bookings = list(
        db.bookings.find(
            {"company_id": cid, "transfers.0": {"$exists": True}, "status": "Active"},
            {"flat_id": 1, "transfers": 1, "id": 1},
        )
    )
    tie(
        "transferred bookings' flats point back to booking",
        sum(1 for b in tr_bookings),
        sum(
            1
            for b in tr_bookings
            if (db.flats.find_one({"id": b["flat_id"]}, {"booking_id": 1}) or {}).get("booking_id") == b["id"]
        ),
    )
    stale_demands = db.demands.count_documents(
        {
            "booking_id": {
                "$in": [b["id"] for b in db.bookings.find({"company_id": cid, "status": "Cancelled"}, {"id": 1})]
            },
            "voided": {"$ne": True},
            "status": {"$in": ["Open", "Partially Paid"]},
        }
    )
    tie("cancelled bookings carry no open demands", stale_demands, 0)
    dvc = g("/reports/demand-vs-collection")
    raw_demanded = sum(
        d["total_demand_paise"]
        for d in db.demands.find(
            {"company_id": cid, "voided": {"$ne": True}, "status": {"$nin": ["Voided", "Cancelled"]}},
            {"total_demand_paise": 1},
        )
    )
    tie("demand-vs-collection demanded == Σ non-void demands", dvc["totals"]["demand_paise"], raw_demanded)

    month = datetime.now(IST).date().isoformat()[:7]
    legacy = g("/dashboard")
    raw_month = sum(
        p["amount_paise"]
        for p in db.payments.find(
            {"company_id": cid, "status": "Cleared", "payment_date": {"$regex": f"^{month}"}}, {"amount_paise": 1}
        )
    )
    tie(
        "legacy dashboard collections.month == Σ cleared this month",
        (legacy.get("collections", {}).get("month", {}).get("total_paise")),
        raw_month,
        f"month={month}",
    )

    canc = g("/reports/cancellations")
    tie(
        "cancellations rows == Cancelled bookings",
        len(canc.get("rows", [])),
        db.bookings.count_documents({"company_id": cid, "status": "Cancelled"}),
    )
    sl = g("/reports/sales-leads", from_date="2020-01-01", to_date="2099-12-31")
    tie("sales-leads total == leads", sl["totals"]["leads"], db.leads.count_documents({"company_id": cid}))

    # per-booking ledger invariant: Σ cleared cash payments == summary.cash_paid for every active booking
    from services.definitions import SPLIT_KEYS, receipt_parts

    bad = 0
    for b in db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"id": 1, "summary": 1}):
        paid = sum(receipt_parts(p)["Cash"] for p in db.payments.find({"booking_id": b["id"], "status": "Cleared"}))
        if paid != (b.get("summary") or {}).get("cash_paid_paise", 0):
            bad += 1
    tie("Σ cleared cash receipts == booking.summary.cash_paid (all active)", 0, bad, "count of bookings that differ")

    bad2 = 0
    for b in db.bookings.find({"company_id": cid}, {"summary": 1}):
        s = b.get("summary") or {}
        if "total_udhar_paise" in s and s["total_udhar_paise"] - s["total_jama_paise"] != s.get(
            "outstanding_paise", 0
        ) - s.get("advance_paise", 0):
            bad2 += 1
    tie("Σ Udhar − Σ Jama == outstanding − advance (every booking)", 0, bad2, "two-sided ledger law")

    # PRE-01 (owner A): every manual bill is in the order raised (→ Outstanding), per share, on every live booking
    from services.money import pct_of

    bad3 = 0
    live_ids = db.demands.distinct("booking_id", {"company_id": cid, "trigger_type": "MANUAL", "voided": {"$ne": True}})
    for b in db.bookings.find({"id": {"$in": live_ids}, "status": {"$in": ["Active", "Completed"]}}):
        s, pct = b.get("summary") or {}, b.get("raised_percent", b.get("construction_percent", 0))
        man = list(db.demands.find({"booking_id": b["id"], "trigger_type": "MANUAL", "voided": {"$ne": True}}))
        for k in ("cash", "account"):
            if s.get(f"{k}_order_raised_paise", 0) - pct_of(b[f"{k}_agreed_paise"], pct) != sum(
                d.get(f"{k}_demand_paise", 0) for d in man
            ):
                bad3 += 1
    tie(
        "manual bills counted in Outstanding (order = plan % + Σ manual)", 0, bad3, f"{len(live_ids)} with manual bills"
    )

    # 3L cards: every card figure == the same definition summed straight from the bookings
    live_q = {"company_id": cid, "status": {"$in": ["Active", "Completed"]}}
    raw_due = sum(
        (b.get("summary") or {}).get("outstanding_paise", 0) for b in db.bookings.find(live_q, {"summary": 1})
    )
    raw_jama = sum(  # REQ-253: collected = Jama − waived (a waiver is Jama credit, not money in)
        (b.get("summary") or {}).get("total_jama_paise", 0) - (b.get("summary") or {}).get("waived_paise", 0)
        for b in db.bookings.find(live_q, {"summary": 1})
    )
    raw_adv = sum((b.get("summary") or {}).get("advance_paise", 0) for b in db.bookings.find(live_q, {"summary": 1}))
    cust, pg = [], 1
    while True:  # every card, page by page (volume has thousands)
        page = g("/customers", card_segment="all", page_size=200, page=pg)
        cust += page["items"]
        if len(cust) >= page.get("total", 0) or not page["items"]:
            break
        pg += 1
    tie(
        "Σ customer-card Due == Σ live booking outstanding",
        sum((c.get("card") or {}).get("due_paise", 0) for c in cust),
        raw_due,
    )
    tie(
        "Σ customer-card Advance == Σ live booking advance",
        sum((c.get("card") or {}).get("advance_paise", 0) for c in cust),
        raw_adv,
    )
    tie(
        "Σ customer-card Overdue == ageing report overdue (definitions.ageing_for_bookings, incl. other charges)",
        sum((c.get("card") or {}).get("overdue_paise", 0) for c in cust),
        g("/reports/outstanding-v2")["totals"]["overdue_paise"],
    )
    projs = g("/projects", page_size=100)["items"]
    segs = g("/customers/segments")["counts"]
    tie(
        "customer segments partition All (overdue + on track + all clear + advance-only + no booking)",
        segs["all"],
        segs["overdue"] + segs["on_track"] + segs["clear"] + segs["advance_only"] + segs["no_booking"],
    )
    adv_cust = len(set(db.bookings.distinct("customer_id", {**live_q, "summary.advance_paise": {"$gt": 0}})))
    tie("Advance chip == customers holding an advance (raw bookings)", adv_cust, segs["advance"])
    tie(
        "KYC pending chip == active customers not Verified (raw)",
        db.customers.count_documents({"company_id": cid, "is_active": True, "kyc_status": {"$ne": "Verified"}}),
        segs["kyc_pending"],
    )
    raw_unsigned = len(
        set(db.bookings.distinct("customer_id", {**live_q, "plan_acceptance.accepted_on": {"$in": [None, ""]}}))
        | set(db.bookings.distinct("customer_id", {**live_q, "plan_acceptance.accepted_on": {"$exists": False}}))
    )
    tie(
        "customer-card 'agreement pending' == customers with an unsigned live booking (raw)",
        raw_unsigned,
        sum(1 for c in cust if (c.get("card") or {}).get("agreement_pending")),
    )
    for p in projs:  # one "booked or sold" definition: banner (unit_counts) == project-page tower chart == raw flats
        ts = g(f"/projects/{p['id']}/tower-sales", view="real", weeks=4)
        uc = p.get("unit_counts") or {}
        tie(
            f"{p['code']} banner 'booked or sold' == tower chart == raw flats",
            (uc.get("booked", 0) + uc.get("sold", 0), ts["total"]["sold"]),
            (
                db.flats.count_documents(
                    {"project_id": p["id"], "is_active": {"$ne": False}, "status": {"$in": ["Booked", "Sold"]}}
                ),
            )
            * 2,
        )

    tie(
        "Σ project-card Collected == Σ live booking Jama − waived",
        sum((p.get("card") or {}).get("collected_paise", 0) for p in projs),
        raw_jama,
    )
    tie(
        "Σ project-card Outstanding == Σ live booking outstanding",
        sum((p.get("card") or {}).get("outstanding_paise", 0) for p in projs),
        raw_due,
    )
    bks = g("/bookings", status="Active", page_size=200)["items"]
    bad3 = sum(
        1
        for b in bks
        if (b.get("card") or {}).get("balance", {}).get("due_paise")
        != (b.get("summary") or {}).get("outstanding_paise")
        or len((b.get("card") or {}).get("plan", {}).get("segments", []))
        != len(
            (b.get("payment_plan_snapshot") or {}).get("installments")
            or (b.get("card") or {}).get("plan", {}).get("segments", [])
        )
    )
    tie(
        "booking-card Due == booking outstanding, one plan segment per instalment",
        0,
        bad3,
        f"{len(bks)} active bookings",
    )
    _m = {"part": "part_paid", "awaiting": "not_billed"}
    bad4 = 0
    for b in bks[:25]:
        tl = g(f"/bookings/{b['id']}/plan-timeline")
        segs = (b.get("card") or {}).get("plan", {}).get("segments", [])
        if [_m.get(s["status"], s["status"]) for s in segs] != [r["bill"]["state"] for r in tl["rows"]]:
            bad4 += 1
    tie("plan-timeline row states == booking-card plan segments", 0, bad4, f"{min(len(bks), 25)} bookings")
    for path in ("/bookings", "/projects"):
        r = g(path, page_size=1, with_total="true")
        tie(f"{path} segment counts sum == list total", r.get("total"), sum((r.get("status_counts") or {}).values()))

    # Phase 1 F-3 (Q-1): Home / trends / reports Cash · Account · Other == Σ allocation parts per category, to the paise
    def raw_split(match):
        out = dict.fromkeys(SPLIT_KEYS, 0)
        for p in db.payments.find({"company_id": cid, "status": "Cleared", **match}):
            for k, v in receipt_parts(p).items():
                out[k] += v
        return out

    t0 = datetime.now(IST).date()  # the app's business day is IST (clock.today)
    m0 = t0.replace(day=1).isoformat()
    month_raw = raw_split({"payment_date": {"$gte": m0, "$lte": t0.isoformat()}})
    hc = g("/dashboard").get("collections", {}).get("month") or {}
    tie("Home month Cash·Account·Other == Σ allocation parts", {k: hc.get(f"{k}_paise") for k in SPLIT_KEYS}, month_raw)
    tie("Home month total == Cash + Account + Other", hc.get("total_paise"), sum(month_raw.values()))
    tr = g("/trends", scope="company", months=12)
    s = tr.get("series") or tr
    tr_split = {k: (s.get(f"collections_{k.lower()}") or [0])[-1] for k in SPLIT_KEYS}
    tie("trends current month split == Σ allocation parts", tr_split, month_raw)
    cv = g("/reports/collections-v2", from_date=m0, to_date=t0.isoformat(), group_by="bucket")
    rows_cv = {r["group"]: r.get("total_paise", 0) for r in cv.get("rows", [])}
    cv_split = {
        "Cash": rows_cv.get("Cash", 0),
        "Account": rows_cv.get("Account", 0),
        "Other": rows_cv.get("Other charges", 0),
    }
    tie("collections-v2 (this month, by bucket) == Σ allocation parts", cv_split, month_raw)
    fy_raw = raw_split({"payment_date": {"$gte": FY0, "$lte": FY1}})
    tot = col.get("totals") or {}
    tie(
        "collections FY cash/account/other == Σ allocation parts",
        {"Cash": tot.get("cash_paise"), "Account": tot.get("account_paise"), "Other": tot.get("other_paise")},
        fy_raw,
    )

    # REQ-178 carried-from-before line (Collections sheet): opening + billed − received == closing; ties to other reports
    fy0 = f"{t0.year if t0.month >= 4 else t0.year - 1}-04-01"
    cvf = g("/reports/collections-v2", from_date=fy0, to_date=t0.isoformat())
    car = cvf.get("carried") or {}
    tie(
        "carried: opening + billed in period − received − waived in period == closing",
        car.get("opening_paise", 0)
        + car.get("billed_paise", 0)
        - car.get("received_paise", 0)
        - car.get("waived_paise", 0),
        car.get("closing_paise"),
    )
    brg = cvf.get("received_bridge") or {}
    tie(  # iteration 12: exact bridge, receipt date → clearance (ledger) basis, instead of assuming they are equal
        "bridge: received by payment date == Collections net received (receipt basis)",
        brg.get("by_receipt_date_paise"),
        cvf["totals"]["total_paise"],
    )
    tie(
        "bridge: by payment date − not live − dated in, cleared after + dated before, cleared in + refunds == carried received",
        brg.get("by_receipt_date_paise", 0)
        - brg.get("not_live_paise", 0)
        - brg.get("dated_in_cleared_after_paise", 0)
        + brg.get("dated_before_cleared_in_paise", 0)
        + brg.get("refunds_paise", 0),
        car.get("received_paise"),
    )
    for fy_from in ("2025-04-01", (t0 - timedelta(days=16)).isoformat()):  # a past FY and a short window
        cv = g("/reports/collections-v2", from_date=fy_from, to_date=t0.isoformat())
        tie(
            f"bridge from {fy_from}: by clearance == carried received",
            (cv.get("received_bridge") or {}).get("by_clearance_paise"),
            (cv.get("carried") or {}).get("received_paise"),
        )
    tie(
        "carried: closing == Outstanding report net balance (today)",
        car.get("closing_paise"),
        g("/reports/outstanding-v2")["totals"]["net_balance_paise"],
    )
    # report formulas in words: every addend ties to the grand total it explains
    dvc, adv, chq, bnk = (
        g("/reports/demand-vs-collection"),
        g("/reports/advances"),
        g("/reports/cheques"),
        g("/reports/bank-receipts", from_date=fy0, to_date=t0.isoformat()),
    )
    tie(
        "formula: Bills vs Collection cash + account billed == total billed",
        dvc["totals"]["cash_demand_paise"] + dvc["totals"]["account_demand_paise"],
        dvc["totals"]["demand_paise"],
    )
    br = dvc.get("bridge") or {}
    tie(
        "bridge: Bills vs Collection instalment bills → all bills == Outstanding bill raised",
        br.get("all_bills_paise"),
        g("/reports/outstanding-v2")["totals"]["bill_raised_paise"],
    )
    tie(
        "formula: Advances cash + account == total advance",
        adv["totals"]["cash_advance_paise"] + adv["totals"]["account_advance_paise"],
        adv["totals"]["total_advance_paise"],
    )
    tie(
        "formula: Advances total == Outstanding report advance held",
        adv["totals"]["total_advance_paise"],
        g("/reports/outstanding-v2")["totals"]["advance_paise"],
    )
    tie(
        "formula: Cheques cleared + bounced + pending == register amount",
        sum(v["amount_paise"] for v in chq["by_status"].values()),
        chq["totals"]["amount_paise"],
    )
    tie(
        "formula: Bank-wise sum of banks == total",
        sum(r["total_paise"] for r in bnk["rows"]),
        bnk["totals"]["total_paise"],
    )
    tie(
        "formula: Bank-wise cleared + pending == total",
        bnk["totals"]["cleared_paise"] + bnk["totals"]["pending_paise"],
        bnk["totals"]["total_paise"],
    )

    # E1: ONE outstanding number — Home "Due ageing" == Outstanding & ageing report, band by band, to the paisa
    hm, oa = g("/dashboard/home"), g("/reports/outstanding-v2")
    keys = dict(zip(("Not due", "0-30", "31-60", "61-90", "90+"), ("not_due", "d0_30", "d31_60", "d61_90", "d90")))
    tie(
        "Home due ageing == Outstanding report ageing (per band)",
        {b: (hm.get("ageing_paise") or {}).get(k) for b, k in keys.items()},
        {a["bucket"]: a["amount_paise"] for a in oa.get("ageing") or []},
    )
    tie(
        "Home due ageing total == report Outstanding",
        sum((hm.get("ageing_paise") or {}).values()),
        (oa.get("totals") or {}).get("outstanding_paise"),
    )

    # Phase 2D: every Home Command Center number == the list / report it drills to (admin, Today · This month · FY)
    # not tests.test_home_bundle: importing the test package snapshots the preview DB + starts a private backend
    from home_numbers import numbers as _numbers
    from home_numbers import pick as _pick

    for period in ("today", "month", "fy"):
        hb = g("/home/bundle", period=period)
        for wid, w in (hb.get("widgets") or {}).items():
            tie(f"Home {wid} ({period}) loads", True, w.get("ok"))
            for num in _numbers(w.get("data") or {}, []):
                path, params = num["drill"]["api"]
                pick = num["drill"]["pick"]
                want = (
                    num.get("count")
                    if pick.endswith(("count", "total")) and "count" in num
                    else num.get("amount_paise")
                )
                tie(f"Home {wid} ({period}) {path} {pick}", want, _pick(g(path, **params), pick), str(params)[:60])
    hb = g("/home/bundle", period="today")
    ag = hb["widgets"]["ageing"]["data"]
    tie(
        "Home Overdue by age total == report Outstanding (ONE number)",
        ag["total"]["amount_paise"],
        (oa.get("totals") or {}).get("outstanding_paise"),
    )
    tie(
        "Home Money today == Σ today's allocation parts",
        hb["widgets"]["money_today"]["data"]["total"]["amount_paise"],
        sum(raw_split({"payment_date": hb["business_day"]}).values()),
    )

    # Phase I: every report has its own tie-out set (tools/tieout_reports.py) — folded in so this stays the one scoreboard
    import contextlib
    import io

    from tools.tieout_reports import main as reports_main

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        reports_ok = reports_main(base)
    rep_lines = [l for l in buf.getvalue().splitlines() if l.startswith(("PASS", "FAIL"))]
    for l in rep_lines:
        rows.append((f"report {l[5:].split(' report=')[0].strip()}", "", "", l[:4], "tools/tieout_reports.py"))
    tie("Phase I report tie-outs all PASS", True, reports_ok, f"{len(rep_lines)} report ties")

    os.makedirs("/app/memory/qa/journey", exist_ok=True)
    with open(OUT, "w") as f:
        f.write(
            (
                f"# Report tie-outs · DB `{os.environ['DB_NAME']}` · {datetime.now(IST).date()}\n\n| Tie-out | Report value | Raw value | Result | Note "
                f"|\n|---|---|---|---|---|\n"
            )
        )
        for r in rows:
            f.write(f"| {r[0]} | `{str(r[1])[:70]}` | `{str(r[2])[:70]}` | **{r[3]}** | {r[4]} |\n")
    for r in rows:
        print(f"{r[3]:4s} {r[0]:60s} report={str(r[1])[:40]} raw={str(r[2])[:40]} {r[4]}")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    OUT = a.out
    try:
        fails = [r for r in main(a.base) if r[3] != "PASS"]
    except Exception as e:  # a crash must name itself (the nightly refresh reports the first FAIL line)
        print(f"FAIL tieout crashed: {type(e).__name__}: {str(e)[:160]}")
        sys.exit(1)
    print(f"{len(fails)} failed")
    sys.exit(1 if fails else 0)
