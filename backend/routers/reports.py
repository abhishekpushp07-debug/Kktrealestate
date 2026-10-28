"""Phase 4 reports: server-side aggregations, CSV/PDF export, saved presets."""
import os
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from pymongo import ReturnDocument

from db import db
from deps import ensure_project_access, project_scope_filter, require
from services import clock, definitions
from services import pdf as _pdf
from services.budgets import REPORT_MS  # Phase K.8
from services.money import amount_in_words, present_money
from utils import (
    ApiError,
    StrictModel,
    base_doc,
    client_ip,
    get_or_404,
    now_iso,
    write_audit,
)

router = APIRouter(prefix="/reports", tags=["reports"])
REPORTS = [
    # Finance
    {"key": "collections-v2", "name": "Collections (Received)", "group": "Finance", "purpose": "What came in: by period, project, tower, ledger, mode, bank, RM or receipt — reversals negative."},
    {"key": "outstanding-v2", "name": "Outstanding & Ageing", "group": "Finance", "purpose": "Bill raised − Received per booking / customer / project / tower with ageing bands and advance held."},
    {"key": "demand-vs-collection", "name": "Demand vs Collection", "group": "Finance", "purpose": "Bill raised vs collected per stage / installment per tower."},
    {"key": "cash-vs-account", "name": "Cash vs Account Split", "group": "Finance", "purpose": "Agreed vs raised vs received vs balance per bucket, with variance flags."},
    {"key": "cheques", "name": "Cheque / Instrument Register", "group": "Finance", "purpose": "Every cheque / DD with status, bank, dates and bounce follow-up."},
    {"key": "receivables-forecast", "name": "Receivables Forecast", "group": "Finance", "purpose": "Bills still to be raised per booking, by month / project / tower."},
    {"key": "cancellations", "name": "Cancellations & Refunds", "group": "Finance", "purpose": "Cancelled bookings, deductions, refund payable / paid / pending."},
    {"key": "bank-receipts", "name": "Bank-wise Receipts & Deposits", "group": "Finance", "purpose": "Receipts per bank account, cleared vs pending clearance."},
    {"key": "other-charges", "name": "Other Charges", "group": "Finance", "purpose": "Maintenance / registration / parking / bounce: demanded vs collected per charge type."},
    {"key": "roznamcha-summary", "name": "Roznamcha (Daybook) Summary", "group": "Finance", "purpose": "Daily opening, receipts by mode, deposits, cash refunds, closing — with monthly roll-up."},
    {"key": "collections", "name": "Collections (legacy by period)", "group": "Finance", "purpose": "Receipts by day / week / month across ledgers.", "hidden": True},
    {"key": "outstanding", "name": "Outstanding (legacy)", "group": "Finance", "purpose": "Dues by customer / block / project.", "hidden": True},
    {"key": "advances", "name": "Advances", "group": "Finance", "purpose": "Customers who have paid ahead of their demands."},
    {"key": "roznamcha-range", "name": "Roznamcha Range (legacy)", "group": "Finance", "purpose": "Day-book totals across a date range.", "hidden": True},
    {"key": "upcoming-dues", "name": "Upcoming Dues (legacy)", "group": "Finance", "purpose": "Demands that will trigger soon.", "hidden": True},
    # Sales
    {"key": "inventory", "name": "Project Sales & Inventory", "group": "Sales", "purpose": "Available / hold / booked / sold units and value, average rate, velocity."},
    {"key": "sales-leads", "name": "Lead Funnel & Source Performance", "group": "Sales", "purpose": "Leads by stage and source, conversion %, response time, overdue follow-ups."},
    {"key": "site-visits", "name": "Site Visit Conversion", "group": "Sales", "purpose": "Visits scheduled / completed / no-show and visit → booking conversion per RM / project."},
    {"key": "sales-team", "name": "Sales Team Performance", "group": "Sales", "purpose": "Per RM: leads, visits, bookings, sold value, collections, overdue of their customers."},
    {"key": "inventory-control", "name": "Inventory by Category / Status / Display", "group": "Sales", "purpose": "Units per allocation category with real status and what customers see; masked count for privileged users. Ties out to the flats master."},
    {"key": "landowner-share", "name": "Landowner Share", "group": "Sales", "purpose": "Landowner-allocated units per tower: count, share %, area and notional value. Never bookable by the Builder."},
    {"key": "hold-register", "name": "Hold Register", "group": "Sales", "purpose": "Active / expiring (< 48 h) / expired holds with reason, customer, RM and countdown; hold → booking conversion rate."},
    {"key": "masked-inventory", "name": "Masked Inventory", "group": "Sales", "purpose": "Units whose displayed status differs from the real one (Show as Sold / Hidden overrides) with reason, who and since when. Requires real-status permission."},
    # Construction
    {"key": "construction-vs-plan", "name": "Construction vs Plan", "group": "Construction", "purpose": "Stage-plan progress per tower, stage demands vs collected, next stage expected bill raised."},
    {"key": "project-statement", "name": "Project Statement", "group": "Finance", "purpose": "Per tower: every customer with bill raised, received and balance (Due / Advance); then tower-wise sales & inventory summary with grand totals."},
    {"key": "construction-progress", "name": "Construction progress (towers)", "group": "Construction", "purpose": "Per-tower stage status, photos and demands per stage."},
    # Operations
    {"key": "service-sla", "name": "Service SLA", "group": "Operations", "purpose": "Tickets by category / status, SLA met vs breached, ageing, ratings."},
    # Admin
    {"key": "activity", "name": "Audit Trail", "group": "Admin", "purpose": "Who did what, when; logins and failed attempts."},
    {"key": "data-quality", "name": "Data Quality", "group": "Admin", "purpose": "Hygiene counts that should be zero; each drills to the list."},
]


def _strict_params(request: Request, allowed: set[str]):
    unknown = sorted(set(request.query_params) - allowed - {"format"})
    if unknown:
        raise ApiError(400, f"Unknown query parameter(s): {', '.join(unknown)}. Accepted: {', '.join(sorted(allowed))}", "UNKNOWN_PARAM")


def _dates(from_date, to_date):
    today = clock.today()
    f = from_date or (today.replace(day=1) - timedelta(days=365)).isoformat()
    t = to_date or today.isoformat()
    return f, t


async def _company(user):
    return await _pdf.company_for_pdf(user["company_id"])


def _scope(user, project_id=None, block_id=None):
    q = {"company_id": user["company_id"], **project_scope_filter(user)}
    if project_id:
        ensure_project_access(user, project_id)
        q["project_id"] = project_id
    if block_id:
        q["block_id"] = block_id
    return q


def _default_kpis(payload: dict, columns: list[tuple], totals: dict | None, rows: list[dict]) -> list[dict]:
    """Server-side KPI strip so API consumers, CSV/PDF and the UI agree. Reports may pass their own `kpis`; otherwise the money totals + row count."""
    if payload.get("kpis"):
        return payload["kpis"]
    k = [{"label": c[1], "value_paise": totals.get(c[0], 0), "kind": "money"} for c in columns if c[2] == "money" and totals and c[0] in totals][:4]
    return k or [{"label": "Rows", "value": len(rows), "kind": "num"}]


async def respond(request: Request, fmt: str | None, payload: dict, title: str, company: dict, columns: list[tuple], rows: list[dict], totals: dict | None = None, filename="report", landscape=False):
    REPORT_VIEW_MAX = int(os.environ.get("REPORT_VIEW_MAX", "2000"))
    if fmt in ("csv", "pdf") and getattr(request.state, "perm_code", "").startswith("reports."):
        exp = request.state.perm_code.rsplit(".", 1)[0] + ".export"
        if exp not in request.state.perms:
            raise ApiError(403, f"Missing permission: {exp}", "PERMISSION_DENIED", {"missing": exp, "any_of": [exp]})
    meta = next((r for r in REPORTS if r["key"] == filename), {})
    payload = {**payload, "purpose": payload.get("purpose") or meta.get("purpose", ""), "title": title}
    payload["kpis"] = _default_kpis(payload, columns, totals, rows)
    header_line = " · ".join(x for x in [title, f"as of {_pdf.fmt_date(payload['as_of'])}" if payload.get("as_of") else None, payload.get("filters_text"), payload.get("basis_text")] if x)
    if fmt == "csv":
        import csv as _csv
        import io
        def head(c):  # humanised headers; money columns carry ₹ (whole rupees, Indian grouping is a display concern — CSV keeps plain rupees)
            return f"{c[1]} ₹" if c[2] == "money" else c[1]
        def val(c, v):
            if c[2] == "money":
                return "" if v is None else round(v / 100, 2)
            from utils import csv_safe
            return "" if v is None else csv_safe(v)
        from routers import exports as _ex
        total_rows = len(rows)
        if total_rows > _ex.EXPORT_SYNC_MAX and request.query_params.get("async", "1") != "0":  # Phase J3: large → export job + Exports page
            user = {"id": getattr(request.state, "user_id", None) or request.headers.get("x-user-id"), "company_id": company.get("id")}
            _rows = [[val(c, r.get(c[0])) for c in columns] for r in rows]
            _totals = [("TOTAL" if i == 0 else val(c, totals.get(c[0])) if c[0] in totals else "") for i, c in enumerate(columns)] if totals else None
            async def produce():
                return _rows
            job = await _ex.start_export(user, filename, title, header_line, [head(c) for c in columns], produce, _totals)
            return JSONResponse(status_code=202, content={"export": job, "message": f"{total_rows:,} rows exceed the {_ex.EXPORT_SYNC_MAX:,}-row sync limit; your export is being prepared — see Reports → Exports"},
                                headers={"X-Export-Total": str(total_rows), "X-Export-Rows": "0", "X-Export-Truncated": "false", "X-Export-Async": job["id"]})
        buf = io.StringIO()
        buf.write(f"# {header_line}\n")
        w = _csv.writer(buf)
        w.writerow([head(c) for c in columns])
        for r in rows:
            w.writerow([val(c, r.get(c[0])) for c in columns])
        if totals:
            w.writerow([("TOTAL" if i == 0 else val(c, totals.get(c[0])) if c[0] in totals else "") for i, c in enumerate(columns)])
        return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}.csv"', "X-Export-Total": str(total_rows), "X-Export-Rows": str(total_rows), "X-Export-Truncated": "false"})
    if fmt == "pdf":
        d = _pdf.BrandedDoc(title, company, landscape_mode=landscape, subtitle=payload.get("subtitle"))
        d.h1(title)
        if payload.get("purpose"):
            d.small(payload["purpose"])
        if header_line != title:
            d.small(header_line[len(title) + 3:] if header_line.startswith(title + " · ") else header_line)
        kp = payload["kpis"]
        if kp:
            d.totals([(k["label"], _pdf.inr(k["value_paise"]) if k.get("kind") == "money" else str(k.get("value", ""))) for k in kp[:4]], emphasis_last=False)
        d.spacer(2)
        money_cols = [i for i, c in enumerate(columns) if c[2] == "money"]
        num_cols = [i for i, c in enumerate(columns) if c[2] in ("money", "num", "pct")]
        def cell(c, r):
            v = r.get(c[0])
            return _pdf.inr(v) if c[2] == "money" else (f"{v}%" if c[2] == "pct" and v is not None else (_pdf.fmt_date(v) if c[2] == "date" else v))
        d.table([c[1] for c in columns], [[cell(c, r) for c in columns] for r in rows[:2000]], widths=[c[3] if len(c) > 3 else 1 for c in columns], align_right=num_cols,
                totals=[("TOTAL" if i == 0 else (_pdf.inr(totals.get(c[0])) if i in money_cols and totals.get(c[0]) is not None else totals.get(c[0], ""))) for i, c in enumerate(columns)] if totals else None)
        return Response(content=d.build(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{filename}.pdf"'})
    view_rows = rows[:REPORT_VIEW_MAX]  # Phase J.2: on-screen view is bounded; full data via CSV (sync ≤10k, else async export)
    return present_money({**payload, "columns": [{"key": c[0], "label": c[1], "type": c[2]} for c in columns], "rows": view_rows, "totals": totals, "total_rows": len(rows), "truncated": len(rows) > len(view_rows)})


@router.get("")
async def list_reports(user: dict = Depends(require("reports.collections.view"))):
    return {"items": REPORTS}


# ---------- 1. Collections ----------
@router.get("/collections")
async def collections(request: Request, from_date: str | None = None, to_date: str | None = None, date_from: str | None = Query(None, description="Receipt date ≥ (YYYY-MM-DD); same name as the Demand Register"), date_to: str | None = Query(None, description="Receipt date ≤ (YYYY-MM-DD)"), project_id: str | None = None, block_id: str | None = None, mode: str | None = None,
                      category: str | None = None, status: str | None = None, group_by: str = "day", format: str | None = None, user: dict = Depends(require("reports.collections.view"))):
    _strict_params(request, {'from_date', 'category', 'status', 'to_date', 'date_from', 'date_to', 'group_by', 'mode', 'block_id', 'project_id'})
    f, t = _dates(date_from or from_date, date_to or to_date)
    q = {**_scope(user, project_id, block_id), "payment_date": {"$gte": f, "$lte": t}, "status": status or "Cleared"}
    if mode:
        q["payment_mode_code"] = mode
    if category:
        q["against"] = {"$ne": "FLAT_VALUE"} if category == "Other charges" else "FLAT_VALUE"
        if category != "Other charges":
            q["payment_category"] = category
    key = {"day": "$payment_date", "week": {"$dateToString": {"format": "%G-W%V", "date": {"$dateFromString": {"dateString": "$payment_date"}}}}, "month": {"$substr": ["$payment_date", 0, 7]}}[group_by if group_by in ("day", "week", "month") else "day"]
    rows = await db.payments.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": q}, {"$group": {"_id": key, "count": {"$sum": 1}, "total_paise": {"$sum": "$amount_paise"},
        "cash_paise": {"$sum": {"$cond": [{"$eq": ["$payment_category", "Cash"]}, "$amount_paise", 0]}}, "account_paise": {"$sum": {"$cond": [{"$eq": ["$payment_category", "Account"]}, "$amount_paise", 0]}},
        "other_paise": {"$sum": {"$cond": [{"$ne": ["$against", "FLAT_VALUE"]}, "$amount_paise", 0]}}}}, {"$sort": {"_id": 1}}]).to_list(None)
    for r in rows:
        r["period"] = r.pop("_id")
    by_mode = await db.payments.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": q}, {"$group": {"_id": "$payment_mode_name", "total_paise": {"$sum": "$amount_paise"}, "count": {"$sum": 1}}}, {"$sort": {"total_paise": -1}}]).to_list(None)
    gst = await db.payments.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {**q, "against": {"$ne": "FLAT_VALUE"}}}, {"$lookup": {"from": "bookings", "localField": "booking_id", "foreignField": "id", "as": "b"}}, {"$unwind": "$b"}, {"$unwind": "$b.other_charges"},
        {"$match": {"$expr": {"$eq": ["$b.other_charges.line_id", "$other_charge_line_id"]}}}, {"$group": {"_id": None, "gst_paise": {"$sum": {"$cond": [{"$gt": ["$b.other_charges.total_paise", 0]}, {"$toLong": {"$multiply": ["$amount_paise", {"$divide": ["$b.other_charges.gst_paise", "$b.other_charges.total_paise"]}]}}, 0]}}}}]).to_list(1)
    totals = {k: sum(r[k] for r in rows) for k in ("count", "total_paise", "cash_paise", "account_paise", "other_paise")}
    totals["gst_collected_paise"] = gst[0]["gst_paise"] if gst else 0
    cols = [("period", "Period", "str", 1.2), ("count", "Receipts", "num", 0.7), ("cash_paise", "Cash", "money"), ("account_paise", "Account", "money"), ("other_paise", "Other charges", "money"), ("total_paise", "Total", "money")]
    return await respond(request, format, {"from_date": f, "to_date": t, "group_by": group_by, "by_mode": [{"mode": m["_id"], **m} for m in by_mode], "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)} · status {q['status']} · grouped by {group_by}"},
                   "Collections Report", await _company(user), cols, rows, totals, "collections")


# ---------- 2. Outstanding & ageing ----------


@router.get("/outstanding")
async def outstanding(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "customer", date_from: str | None = Query(None, description="Accepted for parity with the Demand Register; a point-in-time report ignores it"), date_to: str | None = Query(None, description="As-of date for ageing (YYYY-MM-DD); default today"), format: str | None = None, user: dict = Depends(require("reports.outstanding.view"))):
    _strict_params(request, {'block_id', 'group_by', 'project_id', 'date_from', 'date_to'})
    q = {**_scope(user, project_id, block_id), "status": {"$in": ["Active", "Completed"]}}
    today = date.fromisoformat(date_to) if date_to else clock.today()
    import hashlib
    import heapq
    import json

    from services import ttlcache
    REPORT_VIEW_MAX = int(os.environ.get("REPORT_VIEW_MAX", "2000"))
    KEYS = ("raised_paise", "paid_paise", "cash_due_paise", "account_due_paise", "other_due_paise", "due_paise", "overdue_paise")

    def _row(b, a):
        s = b.get("summary") or {}
        return {"booking_number": b["booking_number"], "customer_name": b["customer_name"], "unit": f"{b['project_code']} {b.get('block_code', '')}-{(b.get('flat_snapshot') or {}).get('flat_number', '')}", "project_id": b["project_id"], "block_id": b["block_id"],
                "raised_paise": s.get("total_order_raised_paise", 0), "paid_paise": s.get("paid_paise", 0), "cash_due_paise": s.get("cash_due_paise", 0), "account_due_paise": s.get("account_due_paise", 0),
                "other_due_paise": s.get("other_charges_due_paise", 0), "due_paise": definitions.outstanding(s)["total_paise"], "overdue_paise": sum(v for k, v in a.items() if k != "Not due"), **{f"age_{k}": v for k, v in a.items()}}

    async def _stream(keep_all: bool):
        """Phase J.2: O(batch) memory — bookings stream in 500s, ageing per batch; keeps totals, ageing bands, top-N view rows (heap), group rollups."""
        proj = {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "project_code": 1, "block_code": 1, "flat_snapshot.flat_number": 1, "summary": 1, "project_id": 1, "block_id": 1}
        ageing, totals, heap, groups, all_rows, n, batch = {}, dict.fromkeys(KEYS, 0), [], {}, [], 0, []

        async def flush():
            _, per_bk = await definitions.ageing_for_bookings({**q, "id": {"$in": [x["id"] for x in batch]}}, today)
            for x in batch:
                r = _row(x, per_bk.get(x["id"], {}))
                for k in KEYS:
                    totals[k] += r[k]
                for k, v in per_bk.get(x["id"], {}).items():
                    ageing[k] = ageing.get(k, 0) + v
                if group_by in ("project", "block"):
                    gk = r["unit"].split(" ")[0] if group_by == "project" else r["unit"].rsplit("-", 1)[0]
                    e = groups.setdefault(gk, {"booking_number": gk, "customer_name": "", "unit": "", **dict.fromkeys(KEYS, 0)})
                    for k in KEYS:
                        e[k] += r[k]
                elif keep_all:
                    all_rows.append(r)
                else:
                    item = (r["due_paise"], r["booking_number"], r)
                    heapq.heappush(heap, item) if len(heap) < REPORT_VIEW_MAX else (heapq.heappushpop(heap, item) if item[0] > heap[0][0] else None)
            batch.clear()
        async for b in db.bookings.find(q, proj).max_time_ms(REPORT_MS).batch_size(500):
            batch.append(b)
            n += 1
            if len(batch) >= 500:
                await flush()
        if batch:
            await flush()
        if group_by in ("project", "block"):
            rows = list(groups.values())
        else:
            rows = all_rows if keep_all else [h[2] for h in heap]
        rows.sort(key=lambda r: -r["due_paise"])
        return {"rows": rows, "totals": totals, "ageing": ageing, "n": n}
    if format == "csv":
        res = await _stream(True)  # full export: explicit, uncached; >10k rows → async export job
    else:
        res = await ttlcache.cached(f"rep:outstanding:{group_by}:{hashlib.sha1(json.dumps(q, sort_keys=True).encode()).hexdigest()}:{today}", 60, lambda: _stream(False))
    rows, totals, ageing = res["rows"], res["totals"], res["ageing"]
    cols = [("booking_number", "Booking" if group_by == "customer" else group_by.title(), "str", 1.1), ("customer_name", "Customer", "str", 1.4), ("unit", "Unit", "str", 1), ("raised_paise", "Raised", "money"), ("paid_paise", "Paid", "money"),
            ("cash_due_paise", "Cash due", "money"), ("account_due_paise", "Account due", "money"), ("other_due_paise", "Charges due", "money"), ("due_paise", "Total due", "money"), ("overdue_paise", "Overdue", "money")]
    top = sorted([r for r in rows if r["overdue_paise"] > 0], key=lambda r: -r["overdue_paise"])[:10] if group_by == "customer" else []
    out = await respond(request, format, {"ageing": [{"bucket": k, "amount_paise": v} for k, v in ageing.items()], "top_overdue": top, "filters_text": f"As of {_pdf.fmt_date(today.isoformat())}"}, "Outstanding & Ageing", await _company(user), cols, rows, totals, "outstanding", landscape=True)
    if isinstance(out, dict):
        out["total_rows"], out["truncated"] = res["n"], res["n"] > len(rows)
    return out


# ---------- 3. Advances ----------
@router.get("/advances")
async def advances(request: Request, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.outstanding.view"))):
    _strict_params(request, {'project_id'})
    q = {**_scope(user, project_id), "status": {"$in": ["Active", "Completed"]}, "$or": [{"summary.cash_due_paise": {"$lt": 0}}, {"summary.account_due_paise": {"$lt": 0}}]}
    rows = []
    for b in await db.bookings.find(q, {"_id": 0, "booking_number": 1, "customer_name": 1, "project_code": 1, "flat_snapshot.flat_number": 1, "summary": 1}).to_list(None):
        s = b["summary"]
        rows.append({"booking_number": b["booking_number"], "customer_name": b["customer_name"], "unit": f"{b['project_code']} {b['flat_snapshot']['flat_number']}", "cash_advance_paise": max(-s.get("cash_due_paise", 0), 0), "account_advance_paise": max(-s.get("account_due_paise", 0), 0), "since": s.get("last_payment_at")})
        rows[-1]["total_advance_paise"] = rows[-1]["cash_advance_paise"] + rows[-1]["account_advance_paise"]
    cols = [("booking_number", "Booking", "str"), ("customer_name", "Customer", "str", 1.5), ("unit", "Unit", "str"), ("cash_advance_paise", "Cash advance", "money"), ("account_advance_paise", "Account advance", "money"), ("total_advance_paise", "Total advance", "money"), ("since", "Since", "date")]
    totals = {k: sum(r[k] for r in rows) for k in ("cash_advance_paise", "account_advance_paise", "total_advance_paise")}
    return await respond(request, format, {}, "Advance Report", await _company(user), cols, rows, totals, "advances")


# ---------- 4. Demand vs collection ----------
@router.get("/demand-vs-collection")
@router.get("/demand-vs-collection-installment")
async def demand_vs_collection(request: Request, project_id: str | None = None, block_id: str | None = None, date_from: str | None = Query(None, description="Demand raised date ≥ (YYYY-MM-DD); same name as the Demand Register"), date_to: str | None = Query(None, description="Demand raised date ≤ (YYYY-MM-DD)"), format: str | None = None, user: dict = Depends(require("reports.demand_vs_collection.view"))):
    _strict_params(request, {'block_id', 'project_id', 'date_from', 'date_to'})
    q = {**_scope(user, project_id, block_id), "voided": {"$ne": True}, "status": {"$nin": ["Voided", "Cancelled"]}}
    if date_from or date_to:
        q["demand_date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    rows = await db.demands.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": q}, {"$group": {"_id": {"block_id": "$block_id", "seq": "$milestone_seq", "name": "$milestone_name", "pct": "$cumulative_percent"}, "cash_demand_paise": {"$sum": "$cash_demand_paise"}, "account_demand_paise": {"$sum": "$account_demand_paise"}, "demand_paise": {"$sum": "$total_demand_paise"}, "collected_paise": {"$sum": "$paid_paise"}, "count": {"$sum": 1}}}, {"$sort": {"_id.block_id": 1, "_id.seq": 1}}]).to_list(None)
    blocks = {b["id"]: f"{b.get('project_code', '')} {b['name']}" for b in await db.blocks.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1, "project_code": 1}).to_list(None)}
    out = [{"block": blocks.get(r["_id"]["block_id"], "?"), "milestone": f"{r['_id'].get('seq') or '·'}. {r['_id'].get('name') or 'Manual / other'}", "percent": r["_id"].get("pct"), "count": r["count"], "cash_demand_paise": r["cash_demand_paise"], "account_demand_paise": r["account_demand_paise"], "demand_paise": r["demand_paise"], "collected_paise": r["collected_paise"],
            "pct_collected": round(100 * r["collected_paise"] / r["demand_paise"], 1) if r["demand_paise"] else 0} for r in rows]
    totals = {k: sum(r[k] for r in out) for k in ("count", "cash_demand_paise", "account_demand_paise", "demand_paise", "collected_paise")}
    totals["pct_collected"] = round(100 * totals["collected_paise"] / totals["demand_paise"], 1) if totals["demand_paise"] else 0
    cols = [("block", "Block", "str", 1.3), ("milestone", "Milestone", "str", 1.3), ("percent", "Cum %", "pct", 0.6), ("count", "Demands", "num", 0.7), ("cash_demand_paise", "Cash demanded", "money"), ("account_demand_paise", "Account demanded", "money"), ("demand_paise", "Total demanded", "money"), ("collected_paise", "Collected", "money"), ("pct_collected", "% collected", "pct", 0.8)]
    return await respond(request, format, {}, "Demand vs Collection", await _company(user), cols, out, totals, "demand-vs-collection", landscape=True)


# ---------- 5. Inventory ----------
@router.get("/inventory")
async def inventory(request: Request, project_id: str | None = None, group_by: str = "block", format: str | None = None, user: dict = Depends(require("reports.inventory.view"))):
    _strict_params(request, {'group_by', 'project_id'})
    q = {**_scope(user, project_id), "is_active": True}
    key = {"project": "$project_id", "block": "$block_id", "flat_type": "$flat_type_code", "floor": {"$concat": ["$block_id", "|", {"$toString": "$floor"}]}}.get(group_by, "$block_id")
    rows = await db.flats.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": q}, {"$group": {"_id": key, "total": {"$sum": 1}, **{s.lower(): {"$sum": {"$cond": [{"$eq": ["$status", s]}, 1, 0]}} for s in ("Available", "Hold", "Booked", "Sold", "Blocked")},
        "available_value": {"$sum": {"$cond": [{"$eq": ["$status", "Available"]}, {"$divide": [{"$ifNull": ["$price_paise", 0]}, 100]}, 0]}}, "sold_value": {"$sum": {"$cond": [{"$in": ["$status", ["Booked", "Sold"]]}, {"$divide": [{"$ifNull": ["$price_paise", 0]}, 100]}, 0]}}, "sqft": {"$sum": {"$ifNull": ["$super_builtup_sqft", 0]}}}}, {"$sort": {"_id": 1}}]).to_list(None)
    names = {b["id"]: f"{b.get('project_code', '')} {b['name']}" for b in await db.blocks.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1, "project_code": 1}).to_list(None)}
    names.update({p["id"]: p["name"] for p in await db.projects.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)})
    def label(k):
        if group_by == "floor":
            b, f = k.split("|")
            return f"{names.get(b, b)} · Floor {f}"
        return names.get(k, k)
    out = [{"group": label(r["_id"]), "total": r["total"], "available": r["available"], "hold": r["hold"], "booked": r["booked"], "sold": r["sold"], "blocked": r["blocked"], "available_value_paise": int(r["available_value"] * 100), "sold_value_paise": int(r["sold_value"] * 100)} for r in rows]
    since = (clock.today().replace(day=1) - timedelta(days=365)).isoformat()
    vel = await db.bookings.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {**_scope(user, project_id), "booking_date": {"$gte": since}}}, {"$group": {"_id": {"$substr": ["$booking_date", 0, 7]}, "bookings": {"$sum": 1}, "value_paise": {"$sum": "$agreement_value_paise"}, "sqft": {"$sum": {"$ifNull": ["$flat_snapshot.super_builtup_sqft", 0]}}}}, {"$sort": {"_id": 1}}]).to_list(None)
    rate = await db.bookings.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {**_scope(user, project_id), "status": {"$in": ["Active", "Completed"]}}}, {"$group": {"_id": "$project_code", "value_paise": {"$sum": "$agreement_value_paise"}, "sqft": {"$sum": {"$ifNull": ["$flat_snapshot.super_builtup_sqft", 0]}}, "n": {"$sum": 1}}}]).to_list(None)
    rc = await db.rate_cards.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"company_id": user["company_id"], "is_active": True}}, {"$group": {"_id": "$project_id", "base": {"$avg": "$rate_per_sqft"}}}]).to_list(None)
    pcode = {p["id"]: p["code"] for p in await db.projects.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "code": 1}).to_list(None)}
    rcm = {pcode.get(r["_id"]): r["base"] for r in rc}
    realised = [{"project": r["_id"], "bookings": r["n"], "realised_rate": round(r["value_paise"] / 100 / r["sqft"], 0) if r["sqft"] else None, "rate_card": rcm.get(r["_id"])} for r in rate]
    totals = {k: sum(r[k] for r in out) for k in ("total", "available", "hold", "booked", "sold", "blocked", "available_value_paise", "sold_value_paise")}
    cols = [("group", group_by.replace("_", " ").title(), "str", 1.8), ("total", "Total", "num", 0.6), ("available", "Available", "num", 0.7), ("hold", "Hold", "num", 0.5), ("booked", "Booked", "num", 0.6), ("sold", "Sold", "num", 0.5), ("blocked", "Blocked", "num", 0.6), ("available_value_paise", "Available value", "money"), ("sold_value_paise", "Sold value", "money")]
    return await respond(request, format, {"velocity": [{"month": v["_id"], "bookings": v["bookings"], "value_paise": v["value_paise"]} for v in vel], "realised_rates": realised}, "Inventory Report", await _company(user), cols, out, totals, "inventory")


# ---------- 8. Cheques ----------
@router.get("/cheques")
async def cheques(request: Request, project_id: str | None = None, status: str | None = None, format: str | None = None, user: dict = Depends(require("reports.cheque_register.view"))):
    _strict_params(request, {'status', 'project_id'})
    q = {**_scope(user, project_id), "payment_mode_code": {"$in": ["CHEQUE", "DD"]}, **({"status": status} if status else {})}
    rows = [{"receipt_number": p["receipt_number"], "customer_name": p["customer_name"], "booking_number": p["booking_number"], "instrument_number": (p.get("instrument") or {}).get("number"), "instrument_date": (p.get("instrument") or {}).get("date"), "bank": (p.get("instrument") or {}).get("bank_name"), "amount_paise": p["amount_paise"], "status": p["status"], "bounced_at": p.get("bounced_at")}
            for p in await db.payments.find(q, {"_id": 0}).sort("instrument.date", 1).to_list(2000)]
    cols = [("receipt_number", "Receipt", "str", 1.1), ("customer_name", "Customer", "str", 1.4), ("booking_number", "Booking", "str"), ("instrument_number", "Cheque/DD no.", "str"), ("instrument_date", "Instrument date", "date"), ("bank", "Bank", "str"), ("amount_paise", "Amount", "money"), ("status", "Status", "str", 0.7)]
    by_status = {}
    for r in rows:
        e = by_status.setdefault(r["status"], {"count": 0, "amount_paise": 0})
        e["count"] += 1
        e["amount_paise"] += r["amount_paise"]
    out = await respond(request, format, {"status": status or "All"}, f"Cheques — {status or 'All'}", await _company(user), cols, rows, {"amount_paise": sum(r["amount_paise"] for r in rows)}, "cheques")
    if isinstance(out, dict):
        out["by_status"] = by_status
    return out


# ---------- 9. Cancellations ----------
@router.get("/cancellations")
async def cancellations(request: Request, from_date: str | None = None, to_date: str | None = None, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.cancellations_refunds.view"))):
    _strict_params(request, {'to_date', 'from_date', 'project_id'})
    f, t = _dates(from_date, to_date)
    q = {**_scope(user, project_id), "status": "Cancelled", "cancellation.at": {"$gte": f, "$lte": t + "T23:59:59"}}
    rows = []
    bks = await db.bookings.find(q, {"_id": 0}).to_list(500)
    refunds: dict[str, dict] = {}
    for r in await db.refunds.find({"booking_id": {"$in": [b["id"] for b in bks]}, "parent_refund_id": {"$exists": False}}, {"_id": 0}).to_list(None):
        e = refunds.setdefault(r["booking_id"], {"status": r["status"], "amount_paise": 0})
        e["amount_paise"] += (r.get("amount_total_paise") or r["amount_paise"]) if r["status"] == "Paid" else 0
        e["status"] = "Paid" if e["status"] == "Paid" or r["status"] == "Paid" else r["status"]
    for b in bks:
        c = b.get("cancellation") or {}
        rf = refunds.get(b["id"]) or {}
        received = c.get("received_paise", (b.get("summary") or {}).get("paid_paise", 0))
        rows.append({"booking_number": b["booking_number"], "customer_name": b["customer_name"], "unit": f"{b['project_code']} {b['flat_snapshot']['flat_number']}", "cancelled_at": c.get("at"), "reason": c.get("reason"), "paid_paise": received, "forfeiture_paise": c.get("deduction_paise", 0), "refund_paise": c.get("refund_paise", 0),
                     "refund_paid_paise": rf.get("amount_paise", 0) if rf.get("status") == "Paid" else 0, "refund_status": rf.get("status") or ("None" if not c.get("refund_paise") else "Pending")})
    cols = [("booking_number", "Booking", "str"), ("customer_name", "Customer", "str", 1.4), ("unit", "Unit", "str"), ("cancelled_at", "Cancelled", "date"), ("reason", "Reason", "str", 1.6), ("paid_paise", "Paid", "money"), ("forfeiture_paise", "Forfeited", "money"), ("refund_paise", "Refund", "money"), ("refund_paid_paise", "Refund paid", "money"), ("refund_status", "Refund status", "str")]
    totals = {k: sum(r[k] or 0 for r in rows) for k in ("paid_paise", "forfeiture_paise", "refund_paise", "refund_paid_paise")}
    return await respond(request, format, {"from_date": f, "to_date": t}, "Cancellations & Refunds", await _company(user), cols, rows, totals, "cancellations", landscape=True)


# ---------- 10. Sales & leads ----------
@router.get("/sales-leads")
async def sales_leads(request: Request, from_date: str | None = None, to_date: str | None = None, format: str | None = None, user: dict = Depends(require("reports.lead_funnel.view"))):
    _strict_params(request, {'to_date', 'from_date'})
    f, t = _dates(from_date, to_date)
    q = {"company_id": user["company_id"], **project_scope_filter(user), "created_at": {"$gte": f, "$lte": t + "T23:59:59"}}
    leads = await db.leads.find(q, {"_id": 0, "status": 1, "source": 1, "created_at": 1, "stage_history": 1, "assigned_to": 1, "next_follow_up_at": 1, "project_name": 1}).to_list(5000)
    stages = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Converted", "Lost"]
    funnel = [{"stage": s, "count": sum(1 for l in leads if l.get("status") == s)} for s in stages]
    src = {}
    resp = []
    now = now_iso()
    overdue = 0
    for l in leads:
        e = src.setdefault(l.get("source") or "Unknown", {"source": l.get("source") or "Unknown", "leads": 0, "converted": 0})
        e["leads"] += 1
        e["converted"] += l.get("status") == "Converted"
        hist = l.get("stage_history") or []
        first = next((h for h in hist if h.get("to") not in (None, "New")), None)
        if first and first.get("at"):
            resp.append((datetime.fromisoformat(first["at"]) - datetime.fromisoformat(l["created_at"])).total_seconds() / 3600)
        if l.get("next_follow_up_at") and l["next_follow_up_at"] < now and l.get("status") not in ("Converted", "Lost"):
            overdue += 1
    for e in src.values():
        e["conversion_pct"] = round(100 * e["converted"] / e["leads"], 1) if e["leads"] else 0
    per_user = await db.bookings.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"company_id": user["company_id"], **project_scope_filter(user), "booking_date": {"$gte": f, "$lte": t}}}, {"$group": {"_id": "$sales_user_id", "bookings": {"$sum": 1}, "value_paise": {"$sum": "$agreement_value_paise"}}}]).to_list(None)
    unames = {u["id"]: u["name"] for u in await db.users.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    enq = {}
    for l in leads:
        if l.get("source") == "Website":
            enq[l.get("project_name") or "General"] = enq.get(l.get("project_name") or "General", 0) + 1
    rows = list(src.values())
    cols = [("source", "Source", "str", 1.5), ("leads", "Leads", "num"), ("converted", "Converted", "num"), ("conversion_pct", "Conversion", "pct")]
    return await respond(request, format, {"from_date": f, "to_date": t, "funnel": funnel, "avg_response_hours": round(sum(resp) / len(resp), 1) if resp else None, "follow_ups_overdue": overdue,
                                     "bookings_per_user": [{"user": unames.get(r["_id"], "Unassigned"), "bookings": r["bookings"], "value_paise": r["value_paise"]} for r in per_user], "enquiries_per_project": [{"project": k, "count": v} for k, v in enq.items()]},
                   "Sales & Leads", await _company(user), cols, rows, {"leads": len(leads), "converted": sum(r["converted"] for r in rows)}, "sales-leads")


# ---------- 11. Roznamcha range & bank receipts ----------
@router.get("/roznamcha-range")
async def roznamcha_range(request: Request, from_date: str | None = None, to_date: str | None = None, format: str | None = None, user: dict = Depends(require("reports.roznamcha.view"))):
    _strict_params(request, {'to_date', 'from_date'})
    f, t = _dates(from_date, to_date)
    base = {"company_id": user["company_id"], **project_scope_filter(user)}
    pays = await db.payments.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {**base, "payment_date": {"$gte": f, "$lte": t}, "status": "Cleared"}}, {"$group": {"_id": "$payment_date", "cash_paise": {"$sum": {"$cond": [{"$eq": ["$payment_mode_code", "CASH"]}, "$amount_paise", 0]}}, "bank_paise": {"$sum": {"$cond": [{"$ne": ["$payment_mode_code", "CASH"]}, "$amount_paise", 0]}}, "count": {"$sum": 1}}}, {"$sort": {"_id": 1}}]).to_list(None)
    contra = await db.contra_entries.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"company_id": user["company_id"], "date": {"$gte": f, "$lte": t}}}, {"$group": {"_id": "$date", "deposit_paise": {"$sum": {"$cond": [{"$eq": ["$kind", "DEPOSIT"]}, "$amount_paise", 0]}}, "withdrawal_paise": {"$sum": {"$cond": [{"$eq": ["$kind", "WITHDRAWAL"]}, "$amount_paise", 0]}}}}]).to_list(None)
    cm = {c["_id"]: c for c in contra}
    rows = [{"date": p["_id"], "count": p["count"], "cash_paise": p["cash_paise"], "bank_paise": p["bank_paise"], "total_paise": p["cash_paise"] + p["bank_paise"], "deposit_paise": cm.get(p["_id"], {}).get("deposit_paise", 0), "withdrawal_paise": cm.get(p["_id"], {}).get("withdrawal_paise", 0)} for p in pays]
    for d, c in cm.items():
        if d not in {r["date"] for r in rows}:
            rows.append({"date": d, "count": 0, "cash_paise": 0, "bank_paise": 0, "total_paise": 0, "deposit_paise": c["deposit_paise"], "withdrawal_paise": c["withdrawal_paise"]})
    rows.sort(key=lambda r: r["date"])
    totals = {k: sum(r[k] for r in rows) for k in ("count", "cash_paise", "bank_paise", "total_paise", "deposit_paise", "withdrawal_paise")}
    cols = [("date", "Date", "date"), ("count", "Receipts", "num", 0.7), ("cash_paise", "Cash", "money"), ("bank_paise", "Bank/Digital", "money"), ("total_paise", "Total", "money"), ("deposit_paise", "Deposited", "money"), ("withdrawal_paise", "Withdrawn", "money")]
    return await respond(request, format, {"from_date": f, "to_date": t}, "Roznamcha — Period Summary", await _company(user), cols, rows, totals, "roznamcha-range")


@router.get("/bank-receipts")
async def bank_receipts(request: Request, from_date: str | None = None, to_date: str | None = None, format: str | None = None, user: dict = Depends(require("reports.bank_wise.view"))):
    _strict_params(request, {'to_date', 'from_date'})
    f, t = _dates(from_date, to_date)
    rows = await db.payments.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"company_id": user["company_id"], **project_scope_filter(user), "payment_date": {"$gte": f, "$lte": t}, "status": {"$in": ["Cleared", "Pending"]}, "payment_mode_code": {"$ne": "CASH"}}},
        {"$group": {"_id": {"bank": {"$ifNull": ["$bank_account_name", "Unassigned"]}, "mode": "$payment_mode_name"}, "count": {"$sum": 1}, "cleared_paise": {"$sum": {"$cond": [{"$eq": ["$status", "Cleared"]}, "$amount_paise", 0]}}, "pending_paise": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, "$amount_paise", 0]}}}}, {"$sort": {"_id.bank": 1}}]).to_list(None)
    out = [{"bank": r["_id"]["bank"], "mode": r["_id"]["mode"], "count": r["count"], "cleared_paise": r["cleared_paise"], "pending_paise": r["pending_paise"], "total_paise": r["cleared_paise"] + r["pending_paise"]} for r in rows]
    totals = {k: sum(r[k] for r in out) for k in ("count", "cleared_paise", "pending_paise", "total_paise")}
    cols = [("bank", "Bank account", "str", 1.6), ("mode", "Mode", "str"), ("count", "Receipts", "num", 0.7), ("cleared_paise", "Cleared", "money"), ("pending_paise", "Pending", "money"), ("total_paise", "Total", "money")]
    return await respond(request, format, {"from_date": f, "to_date": t}, "Bank-wise Receipts", await _company(user), cols, out, totals, "bank-receipts")


# ---------- 12. Activity ----------
@router.get("/activity")
async def activity(request: Request, from_date: str | None = None, to_date: str | None = None, format: str | None = None, user: dict = Depends(require("reports.audit.view"))):
    _strict_params(request, {'to_date', 'from_date'})
    f, t = _dates(from_date, to_date)
    rng = {"$gte": f, "$lte": t + "T23:59:59"}
    acts = await db.audit_logs.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"company_id": user["company_id"], "created_at": rng}}, {"$group": {"_id": "$action", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]).to_list(None)
    logins = await db.login_events.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"created_at": rng}}, {"$group": {"_id": {"email": "$email", "ok": "$success"}, "count": {"$sum": 1}, "last": {"$max": "$created_at"}}}]).to_list(None)
    per = {}
    for l in logins:
        e = per.setdefault(l["_id"]["email"], {"email": l["_id"]["email"], "success": 0, "failed": 0, "last_login": None})
        if l["_id"]["ok"]:
            e["success"] += l["count"]
            e["last_login"] = l["last"]
        else:
            e["failed"] += l["count"]
    rows = sorted(per.values(), key=lambda r: -r["failed"])
    failed_recent = await db.login_events.find({"success": False, "created_at": rng}, {"_id": 0, "email": 1, "ip": 1, "reason": 1, "created_at": 1}).sort("created_at", -1).limit(50).to_list(50)
    cols = [("email", "User", "str", 1.6), ("success", "Logins", "num"), ("failed", "Failed", "num"), ("last_login", "Last login", "date")]
    return await respond(request, format, {"from_date": f, "to_date": t, "actions": [{"action": a["_id"], "count": a["count"]} for a in acts], "failed_recent": failed_recent}, "Activity Report", await _company(user), cols, rows, {"success": sum(r["success"] for r in rows), "failed": sum(r["failed"] for r in rows)}, "activity")


# ---------- 6/7. Statement & allotment letter (per booking) ----------
async def _booking_bundle(booking_id: str, user: dict):
    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    customer = await db.customers.find_one({"id": b["customer_id"]}, {"_id": 0, "full_name": 1, "salutation": 1, "address_current": 1, "phone": 1, "email": 1, "customer_code": 1, "co_applicants": 1})
    if customer:
        customer["co_applicants"] = [{"name": c.get("name"), "relation": c.get("relation")} for c in customer.pop("co_applicants", None) or []]
    demands = await db.demands.find({"booking_id": booking_id, "voided": False}, {"_id": 0}).sort("milestone_seq", 1).to_list(None)
    payments = await db.payments.find({"booking_id": booking_id}, {"_id": 0}).sort("payment_date", 1).to_list(None)
    ledger = await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0}).sort("seq", 1).to_list(None)
    company = await _company(user)
    return b, customer, demands, payments, ledger, company


def _addr(a: dict | None) -> str:
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


@router.get("/statement/{booking_id}")
async def statement(booking_id: str, format: str | None = None, download: int = 0, user: dict = Depends(require("finance.ledger.export"))):
    if format == "pdf":
        content, name = await build_statement_pdf(booking_id, user)
        return _pdf.pdf_response(content, name, bool(download))
    b, customer, demands, payments, ledger, company = await _booking_bundle(booking_id, user)
    return present_money({"booking": b, "customer": customer, "demands": demands, "payments": payments, "ledger": ledger, "company": company})


async def build_statement_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, customer, demands, payments, ledger, company = await _booking_bundle(booking_id, user)
    s = b.get("summary") or {}
    as_of = _pdf.today_ist()
    code = _pdf.verify_code("statement", f"{b['id']}:{as_of}")
    await db.doc_verifications.update_one({"code": code}, {"$set": {"code": code, "doc_type": "statement", "entity_id": b["id"], "number": b["booking_number"], "date": as_of}}, upsert=True)
    d = _pdf.BrandedDoc("Customer Statement of Account", company, landscape_mode=True, number=b["booking_number"], date=as_of, verify=code, subtitle="Statement as of date shown")
    fs = b.get("flat_snapshot") or {}
    d.kv([("Customer", f"{customer.get('salutation') or ''} {customer['full_name']}".strip()), ("Customer code", customer.get("customer_code")), ("Phone", customer.get("phone")), ("Address", _addr(customer.get("address_current"))),
          ("Booking no.", b["booking_number"]), ("Booking date", _pdf.fmt_date(b["booking_date"])), ("Unit", f"{b['project_name']} · {b['block_name']} · {fs.get('flat_number')} ({fs.get('flat_type_code')}, {fs.get('super_builtup_sqft')} sq ft)"), ("Status", b["status"])], cols=2)
    d.h2("Agreement")
    d.table(["Agreement value", "Cash component", "Account component", "Revisions"], [[_pdf.inr(b["agreement_value_paise"]), _pdf.inr(b["cash_agreed_paise"]), _pdf.inr(b["account_agreed_paise"]), str(len(b.get("agreement_revisions") or []))]], align_right=[0, 1, 2])
    for r in b.get("agreement_revisions") or []:
        d.small(f"Revision {_pdf.fmt_date(r.get('at') or r.get('revised_at'))}: {_pdf.inr(r.get('old_agreement_value_paise') or r.get('before', {}).get('agreement_value_paise'))} → {_pdf.inr(r.get('new_agreement_value_paise') or r.get('after', {}).get('agreement_value_paise'))} — {r.get('reason', '')}")
    d.h2("Milestone schedule")
    d.table(["#", "Milestone", "Cum %", "Cash demand", "Account demand", "Total", "Due date", "Paid", "Balance", "Status"],
            [[x.get("milestone_seq") or x.get("installment_seq") or "", x.get("milestone_name") or x.get("installment_name") or "", f"{x['cumulative_percent']}%" if x.get("percent") is not None or x.get("cumulative_percent") is not None else "—", _pdf.inr(x["cash_demand_paise"]), _pdf.inr(x["account_demand_paise"]), _pdf.inr(x["total_demand_paise"]), _pdf.fmt_date(x["due_date"]), _pdf.inr(x.get("paid_paise", 0)), _pdf.inr(x["total_demand_paise"] - x.get("paid_paise", 0)), x["status"]] for x in demands],
            widths=[0.4, 1.6, 0.6, 1, 1, 1, 0.9, 1, 1, 0.8], align_right=[3, 4, 5, 7, 8])
    d.h2("Ledger (Bill raised / Received)")
    rows = [[_pdf.fmt_date(e["date"]), f"{e['type'].replace('_', ' ').title()} — {e.get('note') or ''}" + (f" [{e['tag']}]" if e.get("tag") else "") + (f" · {e['ref']}" if e.get("ref") else ""),
             _pdf.inr(e.get("udhar_paise", 0)) if e.get("udhar_paise") else "", _pdf.inr(e.get("jama_paise", 0)) if e.get("jama_paise") else "",
             " ".join(x for x in [(e.get("mode") if e.get("mode") != "Due" else None), e.get("instrument")] if x), _pdf.inr(e.get("balance_paise", 0))] for e in ledger]
    tu, tj = sum(e.get("udhar_paise", 0) for e in ledger), sum(e.get("jama_paise", 0) for e in ledger)
    rows.append(["", "Totals", _pdf.inr(tu), _pdf.inr(tj), "", _pdf.inr(tu - tj)])
    d.table(["Date", "Particulars", "Bill raised", "Received", "Mode / Instrument", "Balance"], rows, widths=[0.9, 3.2, 1.1, 1.1, 1.4, 1.1], align_right=[2, 3, 5])
    d.totals([("Total bill raised", _pdf.inr(tu)), ("Total received", _pdf.inr(tj)), ("Balance (Received − Bill raised)", _pdf.inr(tj - tu) + (" Due" if tj < tu else " Advance" if tj > tu else " Settled")), ("Advance held", _pdf.inr(s.get("advance_paise", 0)))])
    if b.get("other_charges"):
        d.h2("Other charges")
        d.table(["Charge", "Amount", "GST", "Total", "Demanded", "Paid", "Due"], [[c["name"], _pdf.inr(c["amount_paise"]), _pdf.inr(c.get("gst_paise", 0)), _pdf.inr(c["total_paise"]), _pdf.inr(c.get("demanded_paise", 0)), _pdf.inr(c.get("paid_paise", 0)), _pdf.inr(c.get("demanded_paise", 0) - c.get("paid_paise", 0))] for c in b["other_charges"]], align_right=[1, 2, 3, 4, 5, 6])
    pend = [p for p in payments if p["status"] == "Pending"]
    if pend:
        d.h2("Pending cheques / DDs")
        d.table(["Receipt", "Instrument", "Date", "Bank", "Amount"], [[p["receipt_number"], (p.get("instrument") or {}).get("number"), _pdf.fmt_date((p.get("instrument") or {}).get("date")), (p.get("instrument") or {}).get("bank_name"), _pdf.inr(p["amount_paise"])] for p in pend], align_right=[4])
    d.h2("Summary")
    d.table(["Order raised", "Paid", "Cash due", "Account due", "Charges due", "Total due", "Pending cheques"], [[_pdf.inr(s.get("total_order_raised_paise")), _pdf.inr(s.get("paid_paise")), _pdf.inr(s.get("cash_due_paise")), _pdf.inr(s.get("account_due_paise")), _pdf.inr(s.get("other_charges_due_paise")), _pdf.inr(s.get("due_paise", 0) + s.get("other_charges_due_paise", 0)), _pdf.inr(s.get("pending_cheques_paise"))]], align_right=list(range(7)))
    d.totals([("Total paid", _pdf.inr(s.get("paid_paise"))), ("Pending cheques", _pdf.inr(s.get("pending_cheques_paise"))), ("Total due", _pdf.inr(s.get("due_paise", 0) + s.get("other_charges_due_paise", 0)))])
    d.small(f"Total due in words: {amount_in_words(s.get('due_paise', 0) + s.get('other_charges_due_paise', 0))}. This is a system generated statement; errors and omissions excepted.")
    d.signature(company.get("authorised_signatory_name") or "")
    return d.build(), f"statement-{b['booking_number'].replace('/', '-')}.pdf"


@router.get("/allotment/{booking_id}")
async def allotment(booking_id: str, format: str | None = None, download: int = 0, user: dict = Depends(require("sales.booking.export"))):
    if format == "pdf":
        content, name = await build_allotment_pdf(booking_id, user)
        return _pdf.pdf_response(content, name, bool(download))
    return await _allotment_data(booking_id, user)


async def _allotment_data(booking_id: str, user: dict, pdf: bool = False):
    b, customer, demands, payments, ledger, company = await _booking_bundle(booking_id, user)
    from services.money import pct_of
    sched = []
    prev = 0
    for m in b.get("milestone_template_snapshot") or []:
        inc = m["cumulative_percent"] - prev
        prev = m["cumulative_percent"]
        sched.append({"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"], "incremental_percent": inc, "cash_paise": pct_of(b["cash_agreed_paise"], inc), "account_paise": pct_of(b["account_agreed_paise"], inc), "total_paise": pct_of(b["agreement_value_paise"], inc)})
    terms = company.get("allotment_terms") or "1. The allotment is provisional and subject to execution of the Agreement for Sale under RERA.\n2. Payments are construction-linked and due within the demand due period from the date of each demand letter.\n3. Delayed payments attract interest as per the Agreement for Sale.\n4. Other charges (maintenance deposit, registration, taxes) are payable at possession as applicable.\n5. All disputes are subject to Patna jurisdiction."
    if not pdf:
        return present_money({"booking": b, "customer": customer, "schedule": sched, "terms": terms, "company": company})
    return b, customer, sched, terms, company


async def build_allotment_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, customer, sched, terms, company = await _allotment_data(booking_id, user, pdf=True)
    code = _pdf.verify_code("allotment", b["id"])
    await db.doc_verifications.update_one({"code": code}, {"$set": {"code": code, "doc_type": "allotment", "entity_id": b["id"], "number": b["booking_number"], "date": b["booking_date"]}}, upsert=True)
    d = _pdf.BrandedDoc("Allotment Letter & Payment Schedule", company, number=b["booking_number"], date=b["booking_date"], verify=code, subtitle="Provisional allotment")
    fs = b.get("flat_snapshot") or {}
    d.p(f"To,<br/><b>{customer.get('salutation') or ''} {customer['full_name']}</b><br/>{_addr(customer.get('address_current'))}<br/>Phone: {customer.get('phone') or '-'}")
    if customer.get("co_applicants"):
        d.p("Co-applicant(s): " + ", ".join("<b>%s</b>%s" % (c["name"], " (%s)" % c["relation"] if c.get("relation") else "") for c in customer["co_applicants"]))
    d.spacer(3)
    d.p(f"<b>Subject: Provisional allotment of Unit {fs.get('flat_number')} in {b['block_name']}, {b['project_name']}</b>")
    d.spacer(2)
    d.p(f"Dear {customer.get('salutation') or ''} {customer['full_name'].split()[0]},<br/><br/>We are pleased to confirm the provisional allotment of the above unit ({fs.get('flat_type_code')}, super built-up area {fs.get('super_builtup_sqft')} sq ft) in your favour against Booking No. <b>{b['booking_number']}</b> dated {_pdf.fmt_date(b['booking_date'])}, for a total agreement value of <b>{_pdf.inr(b['agreement_value_paise'])}</b> ({amount_in_words(b['agreement_value_paise'])}).")
    d.h2("Payment schedule (construction-linked)")
    d.table(["#", "Milestone", "Cum %", "Stage %", "Cash", "Account", "Total"], [[x["seq"], x["name"], f"{x['cumulative_percent']}%", f"{x['incremental_percent']}%", _pdf.inr(x["cash_paise"]), _pdf.inr(x["account_paise"]), _pdf.inr(x["total_paise"])] for x in sched],
            widths=[0.4, 2, 0.7, 0.7, 1.2, 1.2, 1.2], align_right=[4, 5, 6], totals=["", "Total", "", "", _pdf.inr(b["cash_agreed_paise"]), _pdf.inr(b["account_agreed_paise"]), _pdf.inr(b["agreement_value_paise"])])
    if b.get("other_charges"):
        d.h2("Other charges (payable as applicable)")
        d.table(["Charge", "Amount", "GST", "Total", "Payable"], [[c["name"], _pdf.inr(c["amount_paise"]), _pdf.inr(c.get("gst_paise", 0)), _pdf.inr(c["total_paise"]), (c.get("demand_at") or "").replace("_", " ")] for c in b["other_charges"]], align_right=[1, 2, 3])
    d.totals([("Cash component", _pdf.inr(b["cash_agreed_paise"])), ("Account component", _pdf.inr(b["account_agreed_paise"])), ("Agreement value", _pdf.inr(b["agreement_value_paise"]))])
    led = await db.ledger_entries.find({"booking_id": b["id"]}, {"_id": 0}).sort("seq", 1).to_list(None)
    if led:
        tu, tj = sum(e.get("udhar_paise", 0) for e in led), sum(e.get("jama_paise", 0) for e in led)
        d.h2("Account position as on date (Bill raised / Received)")
        d.table(["Date", "Particulars", "Bill raised", "Received", "Mode / Instrument", "Balance"],
                [[_pdf.fmt_date(e["date"]), f"{e['type'].replace('_', ' ').title()} — {e.get('note') or ''}", _pdf.inr(e["udhar_paise"]) if e.get("udhar_paise") else "", _pdf.inr(e["jama_paise"]) if e.get("jama_paise") else "",
                  " ".join(x for x in [(e.get("mode") if e.get("mode") != "Due" else None), e.get("instrument")] if x), _pdf.inr(e.get("balance_paise", 0))] for e in led] + [["", "Totals", _pdf.inr(tu), _pdf.inr(tj), "", _pdf.inr(tu - tj)]],
                widths=[0.9, 3.2, 1.1, 1.1, 1.4, 1.1], align_right=[2, 3, 5])
        d.totals([("Total bill raised", _pdf.inr(tu)), ("Total received", _pdf.inr(tj)), ("Balance (Received − Bill raised)", _pdf.inr(tj - tu) + (" Due" if tj < tu else " Advance" if tj > tu else " Settled")), ("Advance held", _pdf.inr((b.get("summary") or {}).get("advance_paise", 0)))])
    d.h2("Terms & conditions")
    for line in terms.split("\n"):
        d.p(line, _pdf.SMALL)
    d.signature(company.get("authorised_signatory_name") or "")
    return d.build(), f"allotment-{b['booking_number'].replace('/', '-')}.pdf"


# ---------- Presets ----------
class PresetIn(StrictModel):
    report_key: str
    name: str
    filters: dict


@router.get("/presets")
async def list_presets(report_key: str | None = None, user: dict = Depends(require("reports.collections.view"))):
    q = {"user_id": user["id"]}
    if report_key:
        q["report_key"] = report_key
    return {"items": await db.report_presets.find(q, {"_id": 0}).sort("name", 1).to_list(100)}


@router.post("/presets", status_code=201)
async def create_preset(body: PresetIn, request: Request, user: dict = Depends(require("reports.collections.view"))):
    if body.report_key not in {r["key"] for r in REPORTS}:
        raise ApiError(422, "Unknown report", "VALIDATION_ERROR")
    doc = {**base_doc(user, user["company_id"]), "user_id": user["id"], **body.model_dump()}
    await db.report_presets.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "report.preset.create", "report_preset", doc["id"], after=body.model_dump(), ip=client_ip(request))
    return doc


@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str, user: dict = Depends(require("reports.collections.view"))):
    r = await db.report_presets.delete_one({"id": preset_id, "user_id": user["id"]})
    if not r.deleted_count:
        raise ApiError(404, "Preset not found", "NOT_FOUND")
    return {"ok": True}


class PresetPatchIn(StrictModel):
    name: str


@router.patch("/presets/{preset_id}")
async def rename_preset(preset_id: str, body: PresetPatchIn, user: dict = Depends(require("reports.collections.view"))):
    r = await db.report_presets.find_one_and_update({"id": preset_id, "user_id": user["id"]}, {"$set": {"name": body.name.strip()}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not r:
        raise ApiError(404, "Preset not found", "NOT_FOUND")
    return r


@router.get("/service-sla")
async def service_sla(request: Request, from_date: str | None = None, to_date: str | None = None, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.service_sla.view"))):
    _strict_params(request, {"to_date", "from_date", "project_id"})
    f, t = _dates(from_date, to_date)
    q = {"company_id": user["company_id"], "created_at": {"$gte": f, "$lte": t + "T23:59:59"}}
    if project_id:
        q["project_id"] = project_id
    srs = await db.service_requests.find(q, {"_id": 0, "category": 1, "status": 1, "priority": 1, "sla_due_at": 1, "created_at": 1, "resolved_at": 1, "rating": 1}).to_list(None)
    now = now_iso()
    by: dict[str, dict] = {}
    for s in srs:
        r = by.setdefault(s.get("category") or "Other", {"category": s.get("category") or "Other", "total": 0, "open": 0, "resolved": 0, "sla_met": 0, "sla_breached": 0, "_res_h": [], "_ratings": []})
        r["total"] += 1
        closed = s["status"] in ("Resolved", "Closed")
        done_at = s.get("resolved_at")
        if closed:
            r["resolved"] += 1
            if done_at:
                r["_res_h"].append((datetime.fromisoformat(done_at) - datetime.fromisoformat(s["created_at"])).total_seconds() / 3600)
                if done_at <= (s.get("sla_due_at") or done_at):
                    r["sla_met"] += 1
                else:
                    r["sla_breached"] += 1
        else:
            r["open"] += 1
            if (s.get("sla_due_at") or now) < now:
                r["sla_breached"] += 1
        if s.get("rating"):
            r["_ratings"].append(s["rating"])
    rows = []
    for r in sorted(by.values(), key=lambda x: -x["total"]):
        judged = r["sla_met"] + r["sla_breached"]
        rows.append({"category": r["category"], "total": r["total"], "open": r["open"], "resolved": r["resolved"], "sla_met_pct": round(100 * r["sla_met"] / judged) if judged else None,
                     "avg_resolution_h": round(sum(r["_res_h"]) / len(r["_res_h"]), 1) if r["_res_h"] else None, "avg_rating": round(sum(r["_ratings"]) / len(r["_ratings"]), 1) if r["_ratings"] else None})
    status_counts = {}
    for s in srs:
        status_counts[s["status"]] = status_counts.get(s["status"], 0) + 1
    judged = sum(r["sla_met"] + r["sla_breached"] for r in by.values())
    all_res = [h for r in by.values() for h in r["_res_h"]]
    all_rt = [x for r in by.values() for x in r["_ratings"]]
    totals = {"total": len(srs), "open": sum(r["open"] for r in by.values()), "resolved": sum(r["resolved"] for r in by.values()),
              "sla_met_pct": round(100 * sum(r["sla_met"] for r in by.values()) / judged) if judged else None,
              "avg_resolution_h": round(sum(all_res) / len(all_res), 1) if all_res else None, "avg_rating": round(sum(all_rt) / len(all_rt), 1) if all_rt else None}
    cols = [("category", "Category", "str", 1.6), ("total", "Tickets", "num"), ("open", "Open", "num"), ("resolved", "Resolved", "num"), ("sla_met_pct", "SLA met %", "pct"), ("avg_resolution_h", "Avg resolution (h)", "num"), ("avg_rating", "Avg rating", "num")]
    return await respond(request, format, {"from_date": f, "to_date": t, "status_counts": [{"status": k, "count": v} for k, v in status_counts.items()]}, "Service SLA Report", await _company(user), cols, rows, totals, "service-sla")


@router.get("/construction-progress")
async def construction_progress(request: Request, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.construction_vs_plan.view"))):
    _strict_params(request, {"project_id"})
    q = {"company_id": user["company_id"]}
    if project_id:
        q["project_id"] = project_id
    blocks = await db.blocks.find(q, {"_id": 0, "id": 1, "name": 1, "project_id": 1, "construction_stages": 1}).to_list(None)
    projects = {p["id"]: p["name"] for p in await db.projects.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    photos = {(p["_id"]["b"], p["_id"]["s"]): p["n"] for p in await db.construction_photos.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$group": {"_id": {"b": "$block_id", "s": "$milestone_seq"}, "n": {"$sum": 1}}}]).to_list(None)}
    demands = {(d["_id"]["b"], d["_id"]["s"]): (d["n"], d["amt"]) for d in await db.demands.aggregate(maxTimeMS=REPORT_MS, pipeline=[{"$match": {"voided": {"$ne": True}, "trigger_stage_id": {"$ne": None}}}, {"$group": {"_id": {"b": "$block_id", "s": "$trigger_stage_id"}, "n": {"$sum": 1}, "amt": {"$sum": "$total_demand_paise"}}}]).to_list(None)}
    rows, towers = [], []
    for b in blocks:
        stages = b.get("construction_stages") or []
        done = sum(1 for s in stages if s.get("status") == "Completed")
        cur = next((s for s in stages if s.get("status") == "In Progress"), None) or next((s for s in stages if s.get("status") != "Completed"), None)
        towers.append({"block_id": b["id"], "tower": b["name"], "project": projects.get(b["project_id"], ""), "stages": len(stages), "completed": done, "pct": round(100 * done / len(stages)) if stages else 0, "current_stage": cur["name"] if cur else "Possession ready"})
        for s in stages:
            dn, damt = demands.get((b["id"], s["stage_id"]), (0, 0))
            rows.append({"project": projects.get(b["project_id"], ""), "tower": b["name"], "seq": s["seq"], "stage": s["name"], "status": s.get("status") or "Pending", "planned_on": s.get("planned_on"), "completed_on": s.get("completed_on"),
                         "variance_days": (datetime.fromisoformat(s["completed_on"]) - datetime.fromisoformat(s["planned_on"])).days if s.get("completed_on") and s.get("planned_on") else None,
                         "photos": photos.get((b["id"], s["seq"]), 0), "demands": dn, "demand_paise": damt})
    totals = {"photos": sum(r["photos"] for r in rows), "demands": sum(r["demands"] for r in rows), "demand_paise": sum(r["demand_paise"] for r in rows)}
    cols = [("project", "Project", "str", 1.4), ("tower", "Tower", "str"), ("seq", "#", "num", 0.4), ("stage", "Stage", "str", 1.4), ("status", "Status", "str"), ("planned_on", "Planned", "date"), ("completed_on", "Completed", "date"), ("variance_days", "Var. days", "num"), ("photos", "Photos", "num"), ("demands", "Demands", "num"), ("demand_paise", "Demanded", "money")]
    return await respond(request, format, {"towers": towers}, "Construction Progress Report", await _company(user), cols, rows, totals, "construction-progress", landscape=True)
