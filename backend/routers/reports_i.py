"""Phase I reports: every number comes from definitions / the two-sided ledger / read models. Shared shape: KPI strip + table + totals + drill links."""
import hashlib
import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request, Response

from db import db
from deps import project_scope_filter, require
from services import clock, definitions
from services import pdf as _pdf
from routers.reports import _company, _dates, _scope, _strict_params, respond

router = APIRouter(prefix="/reports", tags=["reports"])
LIVE = ["Active", "Completed"]


def etag_respond(request: Request, out):
    if not isinstance(out, dict):
        return out
    tag = '"' + hashlib.sha1(json.dumps(out, sort_keys=True, default=str).encode()).hexdigest()[:20] + '"'
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers={"ETag": tag})
    return Response(content=json.dumps(out, default=str), media_type="application/json", headers={"ETag": tag, "Cache-Control": "private, no-cache"})


def _month(d: str) -> str:
    return (d or "")[:7]


async def _names(cid: str):
    blocks = {b["id"]: f"{b.get('project_code', '')} {b['name']}" for b in await db.blocks.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1, "project_code": 1}).to_list(None)}
    projects = {p["id"]: p["name"] for p in await db.projects.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    users = {u["id"]: u["name"] for u in await db.users.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    return blocks, projects, users


# ---------- 1b. Collections — Jama side with every grouping ----------
@router.get("/collections-v2")
async def collections_v2(request: Request, from_date: str | None = None, to_date: str | None = None, project_id: str | None = None, block_id: str | None = None, group_by: str = "month", format: str | None = None,
                         user: dict = Depends(require("reports.collections.view"))):
    _strict_params(request, {"from_date", "to_date", "project_id", "block_id", "group_by"})
    f, t = _dates(from_date, to_date)
    cid = user["company_id"]
    blocks, projects, users = await _names(cid)
    bq = {**_scope(user, project_id, block_id)}
    bids = {b["id"]: b for b in await db.bookings.find(bq, {"_id": 0, "id": 1, "booking_number": 1, "project_id": 1, "block_id": 1, "sales_user_id": 1, "customer_name": 1, "customer_id": 1}).to_list(None)}
    # Jama rows: receipts + other-charge receipts; reversals as negative Jama (tag kept)
    rows = await db.ledger_entries.find({"booking_id": {"$in": list(bids)}, "type": {"$in": ["PAYMENT", "OTHER_CHARGE_PAYMENT", "REVERSAL"]}, "date": {"$gte": f, "$lte": t}}, {"_id": 0}).to_list(None)
    pays = {p["receipt_number"]: p for p in await db.payments.find({"company_id": cid, "payment_date": {"$gte": f, "$lte": t}}, {"_id": 0, "receipt_number": 1, "bank_account_name": 1, "payment_mode_name": 1, "received_by_name": 1, "status": 1, "amount_paise": 1, "id": 1}).to_list(None)}

    def gkey(r):
        b = bids[r["booking_id"]]
        p = pays.get(r.get("ref") or "", {})
        if group_by == "day":
            return r["date"]
        if group_by == "week":
            d = date.fromisoformat(r["date"]); y, w, _ = d.isocalendar(); return f"{y}-W{w:02d}"
        if group_by == "project":
            return projects.get(b["project_id"], "?")
        if group_by == "block":
            return blocks.get(b["block_id"], "?")
        if group_by == "bucket":
            return r.get("category") or "Other"
        if group_by == "mode":
            return r.get("mode") or p.get("payment_mode_name") or "—"
        if group_by == "bank":
            return p.get("bank_account_name") or ("Cash in hand" if (r.get("mode") or "").lower() == "cash" else "Unassigned")
        if group_by == "rm":
            return users.get(b.get("sales_user_id"), "Unassigned")
        if group_by == "receipt":
            return r.get("ref") or r["id"]
        return _month(r["date"])
    g: dict[str, dict] = {}
    for r in rows:
        k = gkey(r)
        e = g.setdefault(k, {"group": k, "count": 0, "cash_paise": 0, "account_paise": 0, "other_paise": 0, "reversal_paise": 0, "total_paise": 0, "_link": None})
        j = r.get("jama_paise", 0)
        e["count"] += 1
        if r["type"] == "REVERSAL":
            e["reversal_paise"] += j
        else:
            e[{"Cash": "cash_paise", "Account": "account_paise"}.get(r.get("category"), "other_paise")] += j
        e["total_paise"] += j
        if group_by == "receipt":
            b = bids[r["booking_id"]]
            e.update({"customer_name": b["customer_name"], "booking_number": b["booking_number"], "tag": r.get("tag"), "date": r["date"], "_link": f"/payments?q={r.get('ref') or ''}"})
    out = sorted(g.values(), key=lambda e: (e["group"] if group_by in ("day", "week", "month") else -e["total_paise"]))
    pend = await db.payments.aggregate([{"$match": {**_scope(user, project_id, block_id), "status": "Pending"}}, {"$group": {"_id": None, "n": {"$sum": 1}, "amt": {"$sum": "$amount_paise"}}}]).to_list(1)
    totals = {k: sum(e[k] for e in out) for k in ("count", "cash_paise", "account_paise", "other_paise", "reversal_paise", "total_paise")}
    totals["pending_instruments"] = pend[0]["n"] if pend else 0
    totals["pending_paise"] = pend[0]["amt"] if pend else 0
    label = {"day": "Day", "week": "Week", "month": "Month", "project": "Project", "block": "Tower", "bucket": "Ledger", "mode": "Mode", "bank": "Bank account", "rm": "Relationship manager", "receipt": "Receipt"}.get(group_by, "Group")
    cols = [("group", label, "str", 1.4)] + ([("date", "Date", "date"), ("customer_name", "Customer", "str", 1.3), ("booking_number", "Booking", "str")] if group_by == "receipt" else []) + \
        [("count", "Rows", "num", 0.6), ("cash_paise", "Cash (Jama)", "money"), ("account_paise", "Account (Jama)", "money"), ("other_paise", "Other charges", "money"), ("reversal_paise", "Reversals", "money"), ("total_paise", "Net Jama", "money")]
    payload = {"purpose": "What money came in (Jama side of the ledger), sliced any way you need. Reversals are negative with their tag.", "from_date": f, "to_date": t, "group_by": group_by, "as_of": clock.today().isoformat(),
               "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)} · grouped by {label.lower()}", "group_options": ["day", "week", "month", "project", "block", "bucket", "mode", "bank", "rm", "receipt"]}
    return etag_respond(request, respond(request, format, payload, "Collections (Jama)", await _company(user), cols, out, totals, "collections", landscape=True))


# ---------- 2b. Outstanding & ageing (Udhar − Jama) with advance + bands from definitions ----------
@router.get("/outstanding-v2")
async def outstanding_v2(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "booking", format: str | None = None, user: dict = Depends(require("reports.outstanding.view"))):
    _strict_params(request, {"project_id", "block_id", "group_by"})
    cid = user["company_id"]
    blocks, projects, _ = await _names(cid)
    q = {**_scope(user, project_id, block_id), "status": {"$in": LIVE}}
    today = clock.today()
    ageing, per_bk = await definitions.ageing_for_bookings(q, today)
    bks = await db.bookings.find(q, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "customer_id": 1, "project_id": 1, "block_id": 1, "flat_snapshot.flat_number": 1, "summary": 1, "promise_to_pay": 1}).to_list(None)
    bands = ["Not due", "0-30", "31-60", "61-90", "90+"]
    rows = []
    for b in bks:
        s = b.get("summary") or {}
        a = per_bk.get(b["id"], {})
        rows.append({"group": b["booking_number"], "customer_name": b["customer_name"], "unit": f"{blocks.get(b['block_id'], '')}-{(b.get('flat_snapshot') or {}).get('flat_number', '')}", "project_id": b["project_id"], "block_id": b["block_id"],
                     "udhar_paise": s.get("total_udhar_paise", 0), "jama_paise": s.get("total_jama_paise", 0), "balance_paise": definitions.outstanding(s)["total_paise"], "advance_paise": definitions.advance(s),
                     **{f"band_{k}": a.get(k, 0) for k in bands}, "overdue_paise": definitions.overdue_of(a), "promise": (b.get("promise_to_pay") or {}).get("note") or "", "_link": f"/bookings/{b['id']}", "customer_id": b["customer_id"]})
    if group_by in ("customer", "project", "block"):
        g = {}
        for r in rows:
            k = r["customer_name"] if group_by == "customer" else (projects.get(r["project_id"], "?") if group_by == "project" else blocks.get(r["block_id"], "?"))
            e = g.setdefault(k, {"group": k, "customer_name": "", "unit": "", "udhar_paise": 0, "jama_paise": 0, "balance_paise": 0, "advance_paise": 0, "overdue_paise": 0, "promise": "", **{f"band_{b}": 0 for b in bands}, "_link": f"/customers/{r['customer_id']}" if group_by == "customer" else None, "bookings": 0})
            for kk in ("udhar_paise", "jama_paise", "balance_paise", "advance_paise", "overdue_paise", *[f"band_{b}" for b in bands]):
                e[kk] += r[kk]
            e["bookings"] += 1
        rows = list(g.values())
    rows.sort(key=lambda r: -r["balance_paise"])
    keys = ["udhar_paise", "jama_paise", "balance_paise", "advance_paise", "overdue_paise", *[f"band_{b}" for b in bands]]
    totals = {k: sum(r[k] for r in rows) for k in keys}
    totals["bookings"] = len(bks)
    cols = [("group", {"booking": "Booking", "customer": "Customer", "project": "Project", "block": "Tower"}[group_by if group_by in ("booking", "customer", "project", "block") else "booking"], "str", 1.2)] + ([("customer_name", "Customer", "str", 1.3), ("unit", "Unit", "str", 0.9)] if group_by == "booking" else [("bookings", "Bookings", "num", 0.6)]) + \
        [("udhar_paise", "Udhar", "money"), ("jama_paise", "Jama", "money"), ("balance_paise", "Balance", "money"), ("advance_paise", "Advance held", "money")] + [(f"band_{b}", b, "money", 0.8) for b in bands] + [("overdue_paise", "Overdue", "money")] + ([("promise", "Promise to pay", "str", 1)] if group_by == "booking" else [])
    payload = {"purpose": "Who owes what (Udhar − Jama) and for how long; bands per definitions.ageing_bands; advance held shown separately.", "as_of": today.isoformat(), "group_by": group_by, "group_options": ["booking", "customer", "project", "block"],
               "ageing": [{"bucket": k, "amount_paise": v} for k, v in ageing.items()], "filters_text": f"As of {_pdf.fmt_date(today.isoformat())} · grouped by {group_by}"}
    return etag_respond(request, respond(request, format, payload, "Outstanding & Ageing", await _company(user), cols, rows, totals, "outstanding", landscape=True))


# ---------- 4. Cash vs Account split ----------
@router.get("/cash-vs-account")
async def cash_vs_account(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "booking", format: str | None = None, user: dict = Depends(require("reports.cash_vs_account.view"))):
    _strict_params(request, {"project_id", "block_id", "group_by"})
    blocks, projects, _ = await _names(user["company_id"])
    q = {**_scope(user, project_id, block_id), "status": {"$in": LIVE}}
    rows = []
    for b in await db.bookings.find(q, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "project_id": 1, "block_id": 1, "agreement_value_paise": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "summary": 1}).to_list(None):
        s = b.get("summary") or {}
        r = {"group": b["booking_number"], "customer_name": b["customer_name"], "project_id": b["project_id"], "block_id": b["block_id"], "_link": f"/bookings/{b['id']}",
             "cash_agreed_paise": b.get("cash_agreed_paise", 0), "cash_raised_paise": s.get("cash_order_raised_paise", 0), "cash_received_paise": s.get("cash_paid_paise", 0), "cash_balance_paise": max(s.get("cash_due_paise", 0), 0),
             "account_agreed_paise": b.get("account_agreed_paise", 0), "account_raised_paise": s.get("account_order_raised_paise", 0), "account_received_paise": s.get("account_paid_paise", 0), "account_balance_paise": max(s.get("account_due_paise", 0), 0), "bookings": 1}
        rows.append(r)
    if group_by in ("project", "block"):
        g = {}
        for r in rows:
            k = projects.get(r["project_id"], "?") if group_by == "project" else blocks.get(r["block_id"], "?")
            e = g.setdefault(k, {"group": k, "customer_name": "", "_link": None, "bookings": 0, **{kk: 0 for kk in r if kk.endswith("_paise")}})
            for kk in r:
                if kk.endswith("_paise") or kk == "bookings":
                    e[kk] += r[kk]
        rows = list(g.values())
    for r in rows:
        agreed = r["cash_agreed_paise"] + r["account_agreed_paise"]
        raised = r["cash_raised_paise"] + r["account_raised_paise"]
        r["cash_share_agreed_pct"] = round(100 * r["cash_agreed_paise"] / agreed, 1) if agreed else 0
        r["cash_share_raised_pct"] = round(100 * r["cash_raised_paise"] / raised, 1) if raised else 0
        r["variance"] = "" if raised == 0 or abs(r["cash_share_raised_pct"] - r["cash_share_agreed_pct"]) < 0.5 else ("Cash over" if r["cash_share_raised_pct"] > r["cash_share_agreed_pct"] else "Cash under")
    rows.sort(key=lambda r: -(r["cash_balance_paise"] + r["account_balance_paise"]))
    keys = [k for k in rows[0] if k.endswith("_paise")] if rows else []
    totals = {k: sum(r[k] for r in rows) for k in keys}
    totals["bookings"] = sum(r["bookings"] for r in rows)
    totals["variance"] = f"{sum(1 for r in rows if r['variance'])} flagged"
    cols = [("group", {"project": "Project", "block": "Tower"}.get(group_by, "Booking"), "str", 1.2), ("customer_name", "Customer", "str", 1.2), ("bookings", "Bookings", "num", 0.6),
            ("cash_agreed_paise", "Cash agreed", "money"), ("cash_raised_paise", "Cash raised", "money"), ("cash_received_paise", "Cash received", "money"), ("cash_balance_paise", "Cash balance", "money"),
            ("account_agreed_paise", "Account agreed", "money"), ("account_raised_paise", "Account raised", "money"), ("account_received_paise", "Account received", "money"), ("account_balance_paise", "Account balance", "money"),
            ("cash_share_agreed_pct", "Cash % agreed", "pct", 0.7), ("cash_share_raised_pct", "Cash % raised", "pct", 0.7), ("variance", "Variance", "str", 0.8)]
    payload = {"purpose": "Agreed vs raised vs received vs balance per bucket; flags bookings where the cash share raised drifts from the agreed share.", "as_of": clock.today().isoformat(), "group_by": group_by, "group_options": ["booking", "project", "block"]}
    return etag_respond(request, respond(request, format, payload, "Cash vs Account Split", await _company(user), cols, rows, totals, "cash-vs-account", landscape=True))


# ---------- 6. Receivables forecast ----------
def _expected_date(inst: dict, booking: dict, block: dict | None, today: date) -> tuple[str | None, str]:
    tt = inst.get("trigger_type")
    if tt == "ON_BOOKING":
        return booking["booking_date"], "booked"
    if tt == "DAYS_AFTER_BOOKING" and inst.get("trigger_days") is not None:
        return (date.fromisoformat(booking["booking_date"]) + timedelta(days=int(inst["trigger_days"]))).isoformat(), "dated"
    if tt == "ON_DATE" and inst.get("trigger_date"):
        return inst["trigger_date"], "dated"
    if tt == "ON_STAGE" and block:
        st = next((s for s in block.get("construction_stages") or [] if s["stage_id"] == inst.get("trigger_stage_id")), None)
        if st and st.get("status") == "Completed":
            return st.get("completed_on"), "completed"
        if st and st.get("planned_date"):
            return st["planned_date"], "scheduled"
        if st and st.get("expected_on"):
            return st["expected_on"], "scheduled"
    return None, "on completion"


@router.get("/receivables-forecast")
async def receivables_forecast(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "month", format: str | None = None, user: dict = Depends(require("reports.receivables_forecast.view"))):
    _strict_params(request, {"project_id", "block_id", "group_by"})
    cid = user["company_id"]
    blocks_n, projects, _ = await _names(cid)
    blocks = {b["id"]: b for b in await db.blocks.find({"company_id": cid}, {"_id": 0, "id": 1, "construction_stages": 1}).to_list(None)}
    q = {**_scope(user, project_id, block_id), "status": {"$in": LIVE}}
    today = clock.today()
    lines, per_booking = [], []
    async for b in db.bookings.find(q, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "project_id": 1, "block_id": 1, "booking_date": 1, "agreement_value_paise": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "payment_plan_snapshot": 1, "summary": 1}):
        s = b.get("summary") or {}
        raised = s.get("total_order_raised_paise", 0)
        remaining = b["agreement_value_paise"] - raised
        raised_seqs = {d["installment_seq"] for d in await db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0, "installment_seq": 1}).to_list(None)}
        pend = [i for i in (b.get("payment_plan_snapshot") or {}).get("installments") or [] if i["seq"] not in raised_seqs]
        pend_pct = sum(i["percent"] for i in pend) or 0
        cash_share = (b.get("cash_agreed_paise", 0) / b["agreement_value_paise"]) if b["agreement_value_paise"] else 0
        alloc = 0
        for n, i in enumerate(pend):
            amt = remaining - alloc if n == len(pend) - 1 else int(round(remaining * i["percent"] / pend_pct)) if pend_pct else 0
            alloc += amt
            when, basis = _expected_date(i, b, blocks.get(b["block_id"]), today)
            cash = int(round(amt * cash_share))
            lines.append({"booking_id": b["id"], "booking_number": b["booking_number"], "customer_name": b["customer_name"], "project_id": b["project_id"], "block_id": b["block_id"], "installment": f"{i['seq']}. {i['name']}", "basis": basis,
                          "expected_on": when, "month": when[:7] if when else "On completion", "cash_paise": cash, "account_paise": amt - cash, "expected_paise": amt})
        if not pend and remaining:
            lines.append({"booking_id": b["id"], "booking_number": b["booking_number"], "customer_name": b["customer_name"], "project_id": b["project_id"], "block_id": b["block_id"], "installment": "Unscheduled balance", "basis": "on completion", "expected_on": None, "month": "On completion",
                          "cash_paise": int(round(remaining * cash_share)), "account_paise": remaining - int(round(remaining * cash_share)), "expected_paise": remaining})
        per_booking.append({"booking_number": b["booking_number"], "agreement_paise": b["agreement_value_paise"], "raised_paise": raised, "forecast_paise": remaining})
    if group_by == "booking":
        rows = [{"group": l["installment"], **l, "_link": f"/bookings/{l['booking_id']}"} for l in lines]
        rows.sort(key=lambda r: (r["booking_number"], r["expected_on"] or "9999"))
    else:
        g = {}
        for l in lines:
            k = l["month"] if group_by == "month" else (projects.get(l["project_id"], "?") if group_by == "project" else blocks_n.get(l["block_id"], "?"))
            e = g.setdefault(k, {"group": k, "lines": 0, "bookings": set(), "cash_paise": 0, "account_paise": 0, "expected_paise": 0, "_link": None})
            e["lines"] += 1; e["bookings"].add(l["booking_id"]); e["cash_paise"] += l["cash_paise"]; e["account_paise"] += l["account_paise"]; e["expected_paise"] += l["expected_paise"]
        rows = sorted(({**e, "bookings": len(e["bookings"])} for e in g.values()), key=lambda r: (r["group"] == "On completion", r["group"]))
    totals = {k: sum(r[k] for r in rows) for k in ("cash_paise", "account_paise", "expected_paise")}
    totals["agreement_paise"] = sum(p["agreement_paise"] for p in per_booking); totals["raised_paise"] = sum(p["raised_paise"] for p in per_booking)
    cols = ([("group", "Installment", "str", 1.3), ("booking_number", "Booking", "str"), ("customer_name", "Customer", "str", 1.2), ("expected_on", "Expected on", "date"), ("basis", "Basis", "str", 0.8)] if group_by == "booking" else
            [("group", {"month": "Month", "project": "Project", "block": "Tower"}.get(group_by, "Group"), "str", 1.3), ("bookings", "Bookings", "num", 0.7), ("lines", "Installments", "num", 0.7)]) + \
        [("cash_paise", "Expected Cash (Udhar)", "money"), ("account_paise", "Expected Account (Udhar)", "money"), ("expected_paise", "Expected total", "money")]
    payload = {"purpose": "Udhar still to be raised per booking = agreement − raised, spread over pending plan installments; stage-linked lines are dated from the tower schedule or shown as 'On completion'.", "as_of": today.isoformat(),
               "group_by": group_by, "group_options": ["month", "project", "block", "booking"], "per_booking": per_booking, "filters_text": f"As of {_pdf.fmt_date(today.isoformat())} · Σ forecast + Σ raised == Σ agreement"}
    return etag_respond(request, respond(request, format, payload, "Receivables Forecast", await _company(user), cols, rows, totals, "receivables-forecast", landscape=True))


# ---------- 9. Other charges ----------
@router.get("/other-charges")
async def other_charges(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "charge", format: str | None = None, user: dict = Depends(require("reports.other_charges.view"))):
    _strict_params(request, {"project_id", "block_id", "group_by"})
    _, projects, _ = await _names(user["company_id"])
    q = {**_scope(user, project_id, block_id), "status": {"$in": LIVE + ["Cancelled"]}}
    g = {}
    async for b in db.bookings.find(q, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "project_id": 1, "other_charges": 1}):
        for c in b.get("other_charges") or []:
            k = c.get("name") or "Charge" if group_by == "charge" else (projects.get(b["project_id"], "?") if group_by == "project" else b["booking_number"])
            e = g.setdefault(k, {"group": k, "lines": 0, "agreed_paise": 0, "demanded_paise": 0, "collected_paise": 0, "balance_paise": 0, "_link": f"/bookings/{b['id']}" if group_by == "booking" else None, "customer_name": b["customer_name"] if group_by == "booking" else ""})
            e["lines"] += 1; e["agreed_paise"] += c.get("total_paise", 0); e["demanded_paise"] += c.get("demanded_paise", 0); e["collected_paise"] += c.get("paid_paise", 0); e["balance_paise"] += max(c.get("demanded_paise", 0) - c.get("paid_paise", 0), 0)
    rows = sorted(g.values(), key=lambda r: -r["demanded_paise"])
    for r in rows:
        r["pct_collected"] = round(100 * r["collected_paise"] / r["demanded_paise"], 1) if r["demanded_paise"] else 0
    totals = {k: sum(r[k] for r in rows) for k in ("lines", "agreed_paise", "demanded_paise", "collected_paise", "balance_paise")}
    totals["pct_collected"] = round(100 * totals["collected_paise"] / totals["demanded_paise"], 1) if totals["demanded_paise"] else 0
    cols = [("group", {"charge": "Charge type", "project": "Project", "booking": "Booking"}.get(group_by, "Group"), "str", 1.4)] + ([("customer_name", "Customer", "str", 1.2)] if group_by == "booking" else []) + \
        [("lines", "Lines", "num", 0.6), ("agreed_paise", "Agreed", "money"), ("demanded_paise", "Demanded (Udhar)", "money"), ("collected_paise", "Collected (Jama)", "money"), ("balance_paise", "Balance", "money"), ("pct_collected", "% collected", "pct", 0.7)]
    payload = {"purpose": "Maintenance, registration, parking, bounce and other charges: demanded vs collected per charge type (Other-charges ledger).", "as_of": clock.today().isoformat(), "group_by": group_by, "group_options": ["charge", "project", "booking"]}
    return etag_respond(request, respond(request, format, payload, "Other Charges", await _company(user), cols, rows, totals, "other-charges"))


# ---------- 10. Roznamcha (daybook) summary ----------
@router.get("/roznamcha-summary")
async def roznamcha_summary(request: Request, from_date: str | None = None, to_date: str | None = None, group_by: str = "day", format: str | None = None, user: dict = Depends(require("reports.roznamcha.view"))):
    _strict_params(request, {"from_date", "to_date", "group_by"})
    f, t = _dates(from_date, to_date)
    cid = user["company_id"]
    base = {"company_id": cid, **project_scope_filter(user)}
    opening = await db.cash_openings.find_one({"company_id": cid, "date": {"$lte": f}}, {"_id": 0}, sort=[("date", -1)])
    open_date, open_amt = (opening["date"], opening["amount_paise"]) if opening else (f, 0)
    pays = await db.payments.find({**base, "status": "Cleared", "payment_date": {"$gte": open_date, "$lte": t}}, {"_id": 0, "payment_date": 1, "payment_mode_code": 1, "payment_mode_name": 1, "amount_paise": 1}).to_list(None)
    contra = await db.contra_entries.find({"company_id": cid, "date": {"$gte": open_date, "$lte": t}, "is_active": {"$ne": False}}, {"_id": 0, "date": 1, "kind": 1, "amount_paise": 1}).to_list(None)
    refunds = await db.refunds.find({"company_id": cid, "status": "Paid", "mode": "CASH", "paid_date": {"$gte": open_date, "$lte": t}}, {"_id": 0, "paid_date": 1, "amount_paise": 1}).to_list(None)
    days = {}
    def day(d):
        return days.setdefault(d, {"date": d, "receipts": 0, "cash_in_paise": 0, "bank_in_paise": 0, "deposit_paise": 0, "withdrawal_paise": 0, "cash_refund_paise": 0, "by_mode": {}})
    for p in pays:
        e = day(p["payment_date"]); e["receipts"] += 1
        e["by_mode"][p.get("payment_mode_name") or p["payment_mode_code"]] = e["by_mode"].get(p.get("payment_mode_name") or p["payment_mode_code"], 0) + p["amount_paise"]
        e["cash_in_paise" if p["payment_mode_code"] == "CASH" else "bank_in_paise"] += p["amount_paise"]
    for c in contra:
        day(c["date"])["deposit_paise" if c["kind"] == "DEPOSIT" else "withdrawal_paise"] += c["amount_paise"]
    for r in refunds:
        day(r["paid_date"])["cash_refund_paise"] += r["amount_paise"]
    bal = open_amt
    rows = []
    for d in sorted(days):
        e = days[d]
        e["opening_paise"] = bal
        bal = bal + e["cash_in_paise"] - e["deposit_paise"] + e["withdrawal_paise"] - e["cash_refund_paise"]
        e["closing_paise"] = bal
        if d >= f:
            rows.append(e)
    if group_by == "month":
        g = {}
        for e in rows:
            m = g.setdefault(e["date"][:7], {"date": e["date"][:7], "receipts": 0, "opening_paise": e["opening_paise"], "cash_in_paise": 0, "bank_in_paise": 0, "deposit_paise": 0, "withdrawal_paise": 0, "cash_refund_paise": 0, "closing_paise": 0})
            for k in ("receipts", "cash_in_paise", "bank_in_paise", "deposit_paise", "withdrawal_paise", "cash_refund_paise"):
                m[k] += e[k]
            m["closing_paise"] = e["closing_paise"]
        rows = list(g.values())
    for e in rows:
        e.pop("by_mode", None)
        e["_link"] = f"/roznamcha?date={e['date']}" if group_by == "day" else None
    totals = {k: sum(r[k] for r in rows) for k in ("receipts", "cash_in_paise", "bank_in_paise", "deposit_paise", "withdrawal_paise", "cash_refund_paise")}
    totals["opening_paise"] = rows[0]["opening_paise"] if rows else open_amt
    totals["closing_paise"] = rows[-1]["closing_paise"] if rows else open_amt
    cols = [("date", "Day" if group_by == "day" else "Month", "str" if group_by == "month" else "date", 0.9), ("opening_paise", "Opening cash", "money"), ("receipts", "Receipts", "num", 0.6), ("cash_in_paise", "Cash received", "money"), ("bank_in_paise", "Bank / digital", "money"),
            ("deposit_paise", "Deposited", "money"), ("withdrawal_paise", "Withdrawn", "money"), ("cash_refund_paise", "Cash refunds", "money"), ("closing_paise", "Closing cash", "money")]
    payload = {"purpose": "Daybook: opening cash, receipts by mode, bank deposits / withdrawals, cash refunds, closing — rolls up monthly.", "from_date": f, "to_date": t, "group_by": group_by, "group_options": ["day", "month"], "opening_from": open_date,
               "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)} · opening carried from {_pdf.fmt_date(open_date)}"}
    return etag_respond(request, respond(request, format, payload, "Roznamcha Summary", await _company(user), cols, rows, totals, "roznamcha-summary", landscape=True))


# ---------- 13. Site visit conversion ----------
@router.get("/site-visits")
async def site_visits(request: Request, from_date: str | None = None, to_date: str | None = None, project_id: str | None = None, group_by: str = "rm", format: str | None = None, user: dict = Depends(require("reports.site_visit_conversion.view"))):
    _strict_params(request, {"from_date", "to_date", "project_id", "group_by"})
    f, t = _dates(from_date, to_date)
    cid = user["company_id"]
    _, projects, users = await _names(cid)
    q = {"company_id": cid, **project_scope_filter(user), "date": {"$gte": f, "$lte": t}, "is_active": {"$ne": False}, **({"project_id": project_id} if project_id else {})}
    visits = await db.site_visits.find(q, {"_id": 0, "status": 1, "assigned_to": 1, "project_id": 1, "lead_id": 1, "customer_id": 1, "date": 1}).to_list(None)
    lead_ids = [v["lead_id"] for v in visits if v.get("lead_id")]
    converted = {l["id"] for l in await db.leads.find({"id": {"$in": lead_ids}, "$or": [{"status": "Converted"}, {"booking_id": {"$ne": None}}]}, {"_id": 0, "id": 1}).to_list(None)}
    g = {}
    for v in visits:
        k = users.get(v.get("assigned_to"), "Unassigned") if group_by == "rm" else (projects.get(v.get("project_id"), "?") if group_by == "project" else v["date"][:7])
        e = g.setdefault(k, {"group": k, "scheduled": 0, "completed": 0, "no_show": 0, "cancelled": 0, "converted": 0, "_link": f"/site-visits?from={f}&to={t}"})
        e["scheduled"] += 1
        e[{"Completed": "completed", "No-show": "no_show", "Cancelled": "cancelled"}.get(v.get("status"), "scheduled")] += 0 if v.get("status") not in ("Completed", "No-show", "Cancelled") else 1
        if v.get("status") == "Completed" and v.get("lead_id") in converted:
            e["converted"] += 1
    rows = sorted(g.values(), key=lambda r: -r["scheduled"])
    for r in rows:
        r["conversion_pct"] = round(100 * r["converted"] / r["completed"], 1) if r["completed"] else 0
        r["show_pct"] = round(100 * r["completed"] / r["scheduled"], 1) if r["scheduled"] else 0
    totals = {k: sum(r[k] for r in rows) for k in ("scheduled", "completed", "no_show", "cancelled", "converted")}
    totals["conversion_pct"] = round(100 * totals["converted"] / totals["completed"], 1) if totals["completed"] else 0
    totals["show_pct"] = round(100 * totals["completed"] / totals["scheduled"], 1) if totals["scheduled"] else 0
    cols = [("group", {"rm": "Relationship manager", "project": "Project", "month": "Month"}.get(group_by, "Group"), "str", 1.4), ("scheduled", "Visits", "num"), ("completed", "Completed", "num"), ("no_show", "No-show", "num"), ("cancelled", "Cancelled", "num"), ("show_pct", "Show-up %", "pct", 0.7), ("converted", "→ Booking", "num"), ("conversion_pct", "Visit → booking %", "pct", 0.8)]
    payload = {"purpose": "Site visits scheduled / completed / no-show / cancelled and how many completed visits became bookings.", "from_date": f, "to_date": t, "group_by": group_by, "group_options": ["rm", "project", "month"], "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)}"}
    return etag_respond(request, respond(request, format, payload, "Site Visit Conversion", await _company(user), cols, rows, totals, "site-visits"))


# ---------- 14. Sales team performance ----------
@router.get("/sales-team")
async def sales_team(request: Request, from_date: str | None = None, to_date: str | None = None, format: str | None = None, user: dict = Depends(require("reports.sales_team.view"))):
    _strict_params(request, {"from_date", "to_date"})
    f, t = _dates(from_date, to_date)
    cid = user["company_id"]
    _, _, users = await _names(cid)
    scope = {"company_id": cid, **project_scope_filter(user)}
    g = {}
    def row(uid):
        return g.setdefault(uid, {"group": users.get(uid, "Unassigned"), "user_id": uid, "leads": 0, "visits": 0, "bookings": 0, "sold_paise": 0, "collected_paise": 0, "overdue_paise": 0, "_link": None})
    for l in await db.leads.find({**scope, "created_at": {"$gte": f, "$lte": t + "T23:59:59"}}, {"_id": 0, "assigned_to": 1}).to_list(None):
        row(l.get("assigned_to"))["leads"] += 1
    for v in await db.site_visits.find({**scope, "date": {"$gte": f, "$lte": t}, "status": "Completed"}, {"_id": 0, "assigned_to": 1}).to_list(None):
        row(v.get("assigned_to"))["visits"] += 1
    bks = await db.bookings.find({**scope, "status": {"$in": LIVE}}, {"_id": 0, "id": 1, "sales_user_id": 1, "booking_date": 1, "agreement_value_paise": 1}).to_list(None)
    by_user_bk = {}
    for b in bks:
        by_user_bk.setdefault(b.get("sales_user_id"), []).append(b["id"])
        if f <= b["booking_date"] <= t:
            r = row(b.get("sales_user_id")); r["bookings"] += 1; r["sold_paise"] += b["agreement_value_paise"]
    ids = {b["id"]: b.get("sales_user_id") for b in bks}
    for p in await db.payments.find({**scope, "status": "Cleared", "payment_date": {"$gte": f, "$lte": t}, "booking_id": {"$in": list(ids)}}, {"_id": 0, "booking_id": 1, "amount_paise": 1}).to_list(None):
        row(ids[p["booking_id"]])["collected_paise"] += p["amount_paise"]
    _, per_bk = await definitions.ageing_for_bookings({**scope, "status": {"$in": LIVE}}, clock.today())
    for bid, bands in per_bk.items():
        if bid in ids:
            row(ids[bid])["overdue_paise"] += definitions.overdue_of(bands)
    rows = sorted(g.values(), key=lambda r: -r["sold_paise"])
    totals = {k: sum(r[k] for r in rows) for k in ("leads", "visits", "bookings", "sold_paise", "collected_paise", "overdue_paise")}
    cols = [("group", "Relationship manager", "str", 1.5), ("leads", "Leads", "num"), ("visits", "Visits done", "num"), ("bookings", "Bookings", "num"), ("sold_paise", "Sold value", "money"), ("collected_paise", "Collections (Jama)", "money"), ("overdue_paise", "Overdue of their customers", "money")]
    payload = {"purpose": "Per RM: leads taken, visits completed, bookings & sold value in the period, collections received, and overdue across all their live bookings.", "from_date": f, "to_date": t, "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)}"}
    return etag_respond(request, respond(request, format, payload, "Sales Team Performance", await _company(user), cols, rows, totals, "sales-team"))


# ---------- 15. Construction vs plan ----------
@router.get("/construction-vs-plan")
async def construction_vs_plan(request: Request, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.construction_vs_plan.view"))):
    _strict_params(request, {"project_id"})
    cid = user["company_id"]
    _, projects, _ = await _names(cid)
    q = {"company_id": cid, **project_scope_filter(user), "is_active": {"$ne": False}, **({"project_id": project_id} if project_id else {})}
    rows = []
    for b in await db.blocks.find(q, {"_id": 0, "id": 1, "name": 1, "project_id": 1, "project_code": 1, "construction_stages": 1}).to_list(None):
        st = sorted(b.get("construction_stages") or [], key=lambda s: s["seq"])
        done = [s for s in st if s.get("status") == "Completed"]
        nxt = next((s for s in st if s.get("status") != "Completed"), None)
        dem = await db.demands.aggregate([{"$match": {"block_id": b["id"], "voided": {"$ne": True}, "trigger_type": "ON_STAGE"}}, {"$group": {"_id": None, "d": {"$sum": "$total_demand_paise"}, "c": {"$sum": "$paid_paise"}}}]).to_list(1)
        exp = 0
        if nxt:
            async for bk in db.bookings.find({"block_id": b["id"], "status": {"$in": LIVE}}, {"_id": 0, "agreement_value_paise": 1, "payment_plan_snapshot": 1}):
                for i in (bk.get("payment_plan_snapshot") or {}).get("installments") or []:
                    if i.get("trigger_stage_id") == nxt["stage_id"]:
                        exp += int(round(bk["agreement_value_paise"] * i["percent"] / 100))
        plan = await db.construction_stage_plans.find_one({"block_id": b["id"], "is_active": True}, {"_id": 0, "name": 1})
        rows.append({"group": f"{b.get('project_code', '')} {b['name']}", "project": projects.get(b["project_id"], ""), "stage_plan": (plan or {}).get("name") or "—", "completed": len(done), "stages": len(st), "pct": round(100 * len(done) / len(st)) if st else 0,
                     "last_completed": max((s.get("completed_on") or "" for s in done), default=None) or None, "next_stage": nxt["name"] if nxt else "All stages complete", "stage_demanded_paise": dem[0]["d"] if dem else 0, "stage_collected_paise": dem[0]["c"] if dem else 0, "next_expected_paise": exp, "_link": f"/construction?block={b['id']}"})
    rows.sort(key=lambda r: r["group"])
    totals = {k: sum(r[k] for r in rows) for k in ("completed", "stages", "stage_demanded_paise", "stage_collected_paise", "next_expected_paise")}
    cols = [("group", "Tower", "str", 1.2), ("project", "Project", "str", 1.1), ("stage_plan", "Stage plan", "str", 1.1), ("completed", "Done", "num", 0.5), ("stages", "Stages", "num", 0.5), ("pct", "Progress", "pct", 0.6), ("last_completed", "Last completed", "date"), ("next_stage", "Next stage", "str", 1),
            ("stage_demanded_paise", "Stage demands (Udhar)", "money"), ("stage_collected_paise", "Collected (Jama)", "money"), ("next_expected_paise", "Next stage expected Udhar", "money")]
    payload = {"purpose": "Per tower: stage-plan progress, stage-linked demands raised vs collected, and the Udhar the next stage will raise.", "as_of": clock.today().isoformat()}
    return etag_respond(request, respond(request, format, payload, "Construction vs Plan", await _company(user), cols, rows, totals, "construction-vs-plan", landscape=True))


# ---------- 18. Data quality ----------
@router.get("/data-quality")
async def data_quality(request: Request, format: str | None = None, user: dict = Depends(require("reports.data_quality.view"))):
    _strict_params(request, set())
    cid = user["company_id"]
    scope = {"company_id": cid, **project_scope_filter(user)}
    checks = [
        ("Customers without phone", await db.customers.count_documents({"company_id": cid, "is_active": {"$ne": False}, "$or": [{"phone": None}, {"phone": ""}]}), "/customers?missing=phone"),
        ("Customers with KYC pending", await db.customers.count_documents({"company_id": cid, "is_active": {"$ne": False}, "kyc_status": {"$ne": "Verified"}}), "/customers?kyc=pending"),
        ("Live bookings without a payment plan", await db.bookings.count_documents({**scope, "status": {"$in": LIVE}, "$or": [{"payment_plan_snapshot": None}, {"payment_plan_snapshot.installments": {"$size": 0}}]}), "/bookings?missing=plan"),
        ("Flats without price", await db.flats.count_documents({**scope, "is_active": {"$ne": False}, "$or": [{"price_paise": None}, {"price_paise": 0}]}), "/masters/flats?missing=price"),
        ("Active towers without a stage plan", len([b for b in await db.blocks.find({**scope, "is_active": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(None) if not await db.construction_stage_plans.find_one({"block_id": b["id"], "is_active": True}, {"_id": 0, "id": 1})]), "/masters/towers"),
        ("Payment plans not summing to 100 %", sum(1 for p in await db.payment_plans.find({"company_id": cid, "is_active": True}, {"_id": 0, "installments.percent": 1}).to_list(None) if round(sum(i["percent"] for i in p.get("installments") or []), 2) != 100), "/masters/payment-plans"),
        ("Demands without an installment mapping", await db.demands.count_documents({**scope, "voided": {"$ne": True}, "$or": [{"installment_seq": None}, {"installment_seq": {"$exists": False}}]}), "/bookings"),
        ("Open demands on cancelled bookings", await db.demands.count_documents({"booking_id": {"$in": [b["id"] for b in await db.bookings.find({**scope, "status": "Cancelled"}, {"_id": 0, "id": 1}).to_list(None)]}, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid", "Overdue"]}}), "/bookings?status=Cancelled"),
    ]
    integ = await db.integrity_reports.find_one({}, {"_id": 0, "ok": 1, "ran_at": 1, "counts": 1}, sort=[("ran_at", -1)]) if "integrity_reports" in await db.list_collection_names() else None
    rows = [{"group": name, "count": n, "status": "OK" if n == 0 else "Review", "_link": link} for name, n, link in checks]
    totals = {"count": sum(r["count"] for r in rows), "status": f"{sum(1 for r in rows if r['count'])} checks need review"}
    cols = [("group", "Check", "str", 2), ("count", "Records", "num"), ("status", "Status", "str")]
    payload = {"purpose": "Hygiene counts that should trend to zero; each drills to the list. Consistency of the ledger itself is the integrity report.", "as_of": clock.today().isoformat(), "integrity": integ}
    return etag_respond(request, respond(request, format, payload, "Data Quality", await _company(user), cols, rows, totals, "data-quality"))
