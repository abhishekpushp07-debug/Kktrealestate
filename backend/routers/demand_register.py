"""Phase P3 — Demand register: DAY → PROJECT → TOWER grouping with two-sided totals, calendar strip, KPIs, manual demand, void.
Every figure is the demands collection (= ledger Udhar rows); paid comes from the ledger rebuild (demands.paid_paise)."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from db import db
from deps import ensure_project_access, project_scope_filter, require
from services import ttlcache
from services.ledger import rebuild
from services.numbering import generate_number
from utils import ApiError, StrictModel, base_doc, client_ip, now_iso, write_audit

router = APIRouter(prefix="/demands", tags=["demands"])
STATUSES = ("Open", "Partially Paid", "Paid", "Overdue", "Voided")
SOURCES = {"plan_stage": "Auto: plan × stage", "on_booking": "Auto: on booking", "manual": "Manual", "other_charge": "Other charge", "bounce": "Bounce charge"}


def _source(d: dict) -> str:
    if d.get("source"):
        return d["source"]
    if d.get("trigger_type") == "ON_BOOKING":
        return "on_booking"
    if d.get("trigger_type") in ("STAGE", "ON_STAGE", "POSSESSION", "ON_POSSESSION"):
        return "plan_stage"
    return "plan_stage" if d.get("installment_seq") else "manual"


def _status(d: dict, today: str) -> str:
    if d.get("voided") or d.get("status") == "Voided":
        return "Voided"
    if d.get("status") == "Paid":
        return "Paid"
    if d["due_date"] < today:
        return "Overdue"
    return "Partially Paid" if (d.get("paid_paise") or 0) > 0 else "Open"


def _age_band(d: dict, today: str) -> str | None:
    if d.get("status") == "Paid" or d.get("voided") or d["due_date"] >= today:
        return None
    days = (date.fromisoformat(today) - date.fromisoformat(d["due_date"])).days
    return "0-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"


def _why(d: dict) -> str:
    bits = [d.get("plan_name"), d.get("milestone_name") or d.get("installment_name"), f"{d['percent']}%" if d.get("percent") is not None else None, d.get("trigger")]
    return " · ".join(str(b) for b in bits if b)


def _row(d: dict, today: str) -> dict:
    other = d.get("other_demand_paise") or 0
    paid = d.get("paid_paise") or 0
    return {"id": d["id"], "demand_number": d["demand_number"], "demand_date": d["demand_date"], "due_date": d["due_date"], "customer_id": d.get("customer_id"), "customer_name": d.get("customer_name"), "booking_id": d["booking_id"], "booking_number": d.get("booking_number"), "flat_number": d.get("flat_number"),
            "project_id": d.get("project_id"), "project_name": d.get("project_name"), "block_id": d.get("block_id"), "block_name": d.get("block_name"), "why": _why(d), "installment_name": d.get("installment_name"), "percent": d.get("percent"), "stage": d.get("milestone_name"),
            "cash_paise": d.get("cash_demand_paise") or 0, "account_paise": d.get("account_demand_paise") or 0, "other_paise": other, "total_paise": d.get("total_demand_paise") or 0, "paid_paise": paid, "balance_paise": 0 if d.get("voided") else max((d.get("total_demand_paise") or 0) - paid, 0),
            "status": _status(d, today), "age_band": _age_band(d, today), "source": _source(d), "source_label": SOURCES.get(_source(d)), "voided": bool(d.get("voided")), "void_reason": d.get("void_reason"), "reminder_sent_at": d.get("reminder_sent_at")}


def _tot(rows: list[dict]) -> dict:
    live = [r for r in rows if not r["voided"]]
    return {"count": len(rows), "cash_paise": sum(r["cash_paise"] for r in live), "account_paise": sum(r["account_paise"] for r in live), "other_paise": sum(r["other_paise"] for r in live), "total_paise": sum(r["total_paise"] for r in live), "paid_paise": sum(r["paid_paise"] for r in live), "balance_paise": sum(r["balance_paise"] for r in live)}


def _filter(user, project_id, block_id, stage, plan, status, source, customer, basis, date_from, date_to, bucket, include_void):
    today = now_iso()[:10]
    q: dict = {"company_id": user["company_id"], **project_scope_filter(user)}
    if not include_void and status != "Voided":
        q["voided"] = {"$ne": True}
    for k, v in (("project_id", project_id), ("block_id", block_id), ("milestone_name", stage), ("plan_name", plan)):
        if v:
            q[k] = v
    field = "due_date" if basis == "due" else "demand_date"
    if date_from or date_to:
        q[field] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    if status == "Paid":
        q["status"] = "Paid"
    elif status == "Overdue":
        q.update({"status": {"$ne": "Paid"}, "due_date": {"$lt": today, **(q.get("due_date") or {})}})
    elif status == "Open":
        q.update({"status": {"$ne": "Paid"}, "paid_paise": {"$in": [0, None]}, "due_date": {"$gte": today, **(q.get("due_date") or {})}})
    elif status == "Partially Paid":
        q.update({"status": {"$ne": "Paid"}, "paid_paise": {"$gt": 0}, "due_date": {"$gte": today, **(q.get("due_date") or {})}})
    elif status == "Voided":
        q["voided"] = True
    if bucket in ("cash", "account"):
        q[f"{bucket}_demand_paise"] = {"$gt": 0}
    if customer:
        import re
        rx = re.compile(re.escape(customer), re.I)
        q["$or"] = [{"customer_name": rx}, {"booking_number": rx}, {"demand_number": rx}, {"flat_number": rx}]
    return q, field, today


async def _enrich(rows: list[dict]):
    """Demands store ids; attach the names the register shows (bookings carry customer/flat/project/tower names)."""
    bids = list({r["booking_id"] for r in rows})
    bs = {b["id"]: b for b in await db.bookings.find({"id": {"$in": bids}}, {"_id": 0, "id": 1, "customer_name": 1, "booking_number": 1, "flat_snapshot.flat_number": 1, "project_name": 1, "block_name": 1, "payment_plan_snapshot.name": 1}).to_list(None)}
    for r in rows:
        b = bs.get(r["booking_id"]) or {}
        r.setdefault("customer_name", b.get("customer_name"))
        r.setdefault("booking_number", b.get("booking_number"))
        r.setdefault("flat_number", (b.get("flat_snapshot") or {}).get("flat_number"))
        r.setdefault("project_name", b.get("project_name"))
        r.setdefault("block_name", b.get("block_name"))
        r.setdefault("plan_name", (b.get("payment_plan_snapshot") or {}).get("name"))
        for k in ("customer_name", "booking_number", "flat_number", "project_name", "block_name", "plan_name"):
            if r.get(k) is None:
                r[k] = {"customer_name": b.get("customer_name"), "booking_number": b.get("booking_number"), "flat_number": (b.get("flat_snapshot") or {}).get("flat_number"), "project_name": b.get("project_name"), "block_name": b.get("block_name"), "plan_name": (b.get("payment_plan_snapshot") or {}).get("name")}[k]
    return rows


@router.get("/register")
async def register(request: Request, basis: str = "raised", date_from: str | None = None, date_to: str | None = None, project_id: str | None = None, block_id: str | None = None, stage: str | None = None, plan: str | None = None, status: str | None = None, source: str | None = None, bucket: str | None = None, customer: str | None = None, include_void: bool = False, per_group: int = 50, format: str | None = None,
                   user: dict = Depends(require("demands.register.view"))):
    if basis not in ("raised", "due"):
        raise ApiError(400, "basis must be raised | due", "UNKNOWN_PARAM")
    q, field, today = _filter(user, project_id, block_id, stage, plan, status, source, customer, basis, date_from, date_to, bucket, include_void)
    key = f"dreg:{user['company_id']}:{hash(repr(sorted(q.items(), key=str)))}:{per_group}:{source}:{int(bool(user.get('project_scope')))}"

    async def compute():
        raw = await db.demands.find(q, {"_id": 0}).sort([(field, -1), ("demand_number", -1)]).limit(5000).to_list(None)
        await _enrich(raw)
        rows = [_row(d, today) for d in raw]
        if source:
            rows = [r for r in rows if r["source"] == source]
        days: dict = {}
        for r in rows:
            dkey = r["due_date"] if basis == "due" else r["demand_date"]
            dg = days.setdefault(dkey, {"date": dkey, "projects": {}, "rows": []})
            dg["rows"].append(r)
            pg = dg["projects"].setdefault(r["project_id"], {"project_id": r["project_id"], "project_name": r["project_name"], "towers": {}, "rows": []})
            pg["rows"].append(r)
            tg = pg["towers"].setdefault(r["block_id"], {"block_id": r["block_id"], "block_name": r["block_name"], "rows": []})
            tg["rows"].append(r)
        out = []
        for dg in sorted(days.values(), key=lambda x: x["date"], reverse=True):
            projects = []
            for pg in sorted(dg["projects"].values(), key=lambda x: x["project_name"] or ""):
                towers = [{"block_id": tg["block_id"], "block_name": tg["block_name"], "totals": _tot(tg["rows"]), "rows": tg["rows"][:per_group], "more": max(0, len(tg["rows"]) - per_group)} for tg in sorted(pg["towers"].values(), key=lambda x: x["block_name"] or "")]
                projects.append({"project_id": pg["project_id"], "project_name": pg["project_name"], "totals": _tot(pg["rows"]), "towers": towers})
            out.append({"date": dg["date"], "totals": _tot(dg["rows"]), "projects": projects})
        return {"basis": basis, "as_of": today, "groups": out, "totals": _tot(rows), "row_count": len(rows), "statuses": list(STATUSES), "sources": SOURCES, "tie_out": {"rows_total_paise": sum(r["total_paise"] for r in rows if not r["voided"]), "groups_total_paise": sum(g["totals"]["total_paise"] for g in out)}, "_rows": rows}

    data = await ttlcache.cached(key, 30, compute)
    rows = data["_rows"]
    if format == "csv":
        from utils import to_csv
        cols = ["demand_number", "demand_date", "due_date", "customer_name", "booking_number", "flat_number", "project_name", "block_name", "why", "cash_paise", "account_paise", "other_paise", "total_paise", "paid_paise", "balance_paise", "status", "age_band", "source_label"]
        return Response(content=to_csv([{k: r.get(k) for k in cols} for r in rows]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="demand-register-{basis}.csv"'})
    body = {k: v for k, v in data.items() if k != "_rows"}
    import hashlib
    import json
    etag = '"' + hashlib.md5(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(content=json.dumps(body, default=str), media_type="application/json", headers={"ETag": etag, "Cache-Control": "private, max-age=30"})


@router.get("/calendar")
async def calendar(month: str, basis: str = "raised", project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("demands.register.view"))):
    """Per-day totals for one month (YYYY-MM) — raised or due basis."""
    field = "due_date" if basis == "due" else "demand_date"
    y, m = int(month[:4]), int(month[5:7])
    start, end = date(y, m, 1).isoformat(), (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).isoformat()
    q = {"company_id": user["company_id"], **project_scope_filter(user), "voided": {"$ne": True}, field: {"$gte": start, "$lte": end}, **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    rows = await db.demands.aggregate([{"$match": q}, {"$group": {"_id": f"${field}", "n": {"$sum": 1}, "total_paise": {"$sum": "$total_demand_paise"}, "paid_paise": {"$sum": {"$ifNull": ["$paid_paise", 0]}}}}, {"$sort": {"_id": 1}}]).to_list(None)
    return {"month": month, "basis": basis, "days": [{"date": r["_id"], "count": r["n"], "total_paise": r["total_paise"], "paid_paise": r["paid_paise"]} for r in rows], "max_paise": max([r["total_paise"] for r in rows] or [0])}


@router.get("/kpis")
async def kpis(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("demands.register.view"))):
    today = now_iso()[:10]
    base = {"company_id": user["company_id"], **project_scope_filter(user), "voided": {"$ne": True}, **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    wk_end = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    agg = await db.demands.aggregate([{"$match": base}, {"$group": {"_id": None,
        "raised_today": {"$sum": {"$cond": [{"$eq": ["$demand_date", today]}, "$total_demand_paise", 0]}}, "raised_today_n": {"$sum": {"$cond": [{"$eq": ["$demand_date", today]}, 1, 0]}},
        "raised_month": {"$sum": {"$cond": [{"$eq": [{"$substr": ["$demand_date", 0, 7]}, today[:7]]}, "$total_demand_paise", 0]}}, "raised_month_n": {"$sum": {"$cond": [{"$eq": [{"$substr": ["$demand_date", 0, 7]}, today[:7]]}, 1, 0]}},
        "due_week": {"$sum": {"$cond": [{"$and": [{"$gte": ["$due_date", today]}, {"$lte": ["$due_date", wk_end]}, {"$ne": ["$status", "Paid"]}]}, {"$subtract": ["$total_demand_paise", {"$ifNull": ["$paid_paise", 0]}]}, 0]}},
        "due_week_n": {"$sum": {"$cond": [{"$and": [{"$gte": ["$due_date", today]}, {"$lte": ["$due_date", wk_end]}, {"$ne": ["$status", "Paid"]}]}, 1, 0]}},
        "overdue": {"$sum": {"$cond": [{"$and": [{"$lt": ["$due_date", today]}, {"$ne": ["$status", "Paid"]}]}, {"$subtract": ["$total_demand_paise", {"$ifNull": ["$paid_paise", 0]}]}, 0]}},
        "overdue_n": {"$sum": {"$cond": [{"$and": [{"$lt": ["$due_date", today]}, {"$ne": ["$status", "Paid"]}]}, 1, 0]}},
        "raised_all": {"$sum": "$total_demand_paise"}, "paid_all": {"$sum": {"$ifNull": ["$paid_paise", 0]}}}}]).to_list(1)
    a = agg[0] if agg else {}
    g = lambda k: a.get(k, 0)  # noqa: E731
    return {"raised_today_paise": g("raised_today"), "raised_today_count": g("raised_today_n"), "raised_month_paise": g("raised_month"), "raised_month_count": g("raised_month_n"), "due_week_paise": g("due_week"), "due_week_count": g("due_week_n"),
            "overdue_paise": g("overdue"), "overdue_count": g("overdue_n"), "collection_pct": round(100 * g("paid_all") / g("raised_all"), 1) if g("raised_all") else None, "as_of": today}


class ManualDemandIn(StrictModel):
    booking_id: str
    kind: str = "manual"  # manual | other_charge | bounce
    name: str = Field(min_length=2, max_length=120)
    cash_amount: float = Field(default=0, ge=0)
    account_amount: float = Field(default=0, ge=0)
    due_date: str
    demand_date: str | None = None
    note: str | None = Field(default=None, max_length=300)
    preview: bool = False


@router.post("/manual", status_code=201)
async def manual_demand(body: ManualDemandIn, request: Request, user: dict = Depends(require("demands.register.create"))):
    """Manual / other-charge / bounce-charge demand. Flows through the same demands → ledger Udhar path as plan demands."""
    b = await db.bookings.find_one({"id": body.booking_id, "company_id": user["company_id"]}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    ensure_project_access(user, b["project_id"])
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']} — demands can only be raised on Active bookings", "BOOKING_NOT_ACTIVE")
    cash, acct = round(body.cash_amount * 100), round(body.account_amount * 100)
    if cash + acct <= 0:
        raise ApiError(422, "Amount must be greater than zero", "VALIDATION_ERROR")
    today = now_iso()[:10]
    dd = body.demand_date or today
    if body.due_date < dd:
        raise ApiError(422, "Due date cannot be before the demand date", "VALIDATION_ERROR")
    if body.kind not in ("manual", "other_charge", "bounce"):
        raise ApiError(422, "kind must be manual | other_charge | bounce", "VALIDATION_ERROR")
    s = b.get("summary") or {}
    effect = {"udhar_delta_paise": cash + acct, "balance_before_paise": s.get("balance_paise"), "balance_after_paise": (s.get("balance_paise") or 0) + cash + acct, "booking_number": b["booking_number"], "customer_name": b.get("customer_name")}
    if body.preview:
        return {"preview": True, "effect": effect}
    co = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    seqs = [d.get("installment_seq") or 0 for d in await db.demands.find({"booking_id": b["id"]}, {"_id": 0, "installment_seq": 1}).to_list(None)]
    d = {**base_doc(user, user["company_id"]), "booking_id": b["id"], "customer_id": b["customer_id"], "customer_name": b.get("customer_name"), "booking_number": b["booking_number"], "project_id": b["project_id"], "block_id": b.get("block_id"), "flat_id": b.get("flat_id"), "flat_number": (b.get("flat_snapshot") or {}).get("flat_number"), "project_name": b.get("project_name"), "block_name": b.get("block_name"),
         "demand_number": await generate_number("demand", co, date.fromisoformat(dd)), "installment_seq": max(seqs or [0]) + 100, "installment_name": body.name, "milestone_name": body.name, "trigger": SOURCES[body.kind], "trigger_type": "MANUAL", "percent": None, "cumulative_percent": None, "source": body.kind, "note": body.note,
         "cash_demand_paise": cash, "account_demand_paise": acct, "total_demand_paise": cash + acct, "demand_date": dd, "due_date": body.due_date, "status": "Open", "paid_paise": 0, "voided": False, "posted_at": now_iso()}
    await db.demands.insert_one(d)
    d.pop("_id", None)
    await rebuild(b["id"])
    await write_audit(user, "demand.create", "booking", b["id"], after={"demand_number": d["demand_number"], "total_paise": d["total_demand_paise"], "amount_paise": d["total_demand_paise"], "source": body.kind, "name": body.name, "due_date": body.due_date, "manual": True}, ip=client_ip(request))
    ttlcache.invalidate(f"dreg:{user['company_id']}")
    return {**_row(d, today), "effect": effect}


class VoidIn(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/{demand_id}/void")
async def void_demand(demand_id: str, body: VoidIn, request: Request, user: dict = Depends(require("demands.register.void"))):
    d = await db.demands.find_one({"id": demand_id, "company_id": user["company_id"]}, {"_id": 0})
    if not d:
        raise ApiError(404, "Demand not found", "NOT_FOUND")
    ensure_project_access(user, d["project_id"])
    if d.get("voided"):
        raise ApiError(409, "Demand is already voided — voiding is final", "ALREADY_VOIDED")
    if (d.get("paid_paise") or 0) > 0:
        raise ApiError(409, "Demand has receipts against it — reverse the receipts first", "HAS_PAYMENTS")
    ts = now_iso()
    await db.demands.update_one({"id": demand_id}, {"$set": {"voided": True, "status": "Voided", "voided_at": ts, "voided_by": user["id"], "voided_by_name": user["name"], "void_reason": body.reason, "updated_at": ts}})
    await rebuild(d["booking_id"])
    b = await db.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "summary": 1, "booking_number": 1})
    await write_audit(user, "demand.void", "booking", d["booking_id"], before={"demand_number": d["demand_number"], "status": d["status"], "total_paise": d["total_demand_paise"]}, after={"demand_number": d["demand_number"], "status": "Voided", "reason": body.reason, "udhar_delta_paise": -d["total_demand_paise"]}, ip=client_ip(request))
    return {"ok": True, "demand_number": d["demand_number"], "udhar_delta_paise": -d["total_demand_paise"], "balance_after_paise": (b.get("summary") or {}).get("balance_paise"), "booking_number": b.get("booking_number")}


@router.post("/{demand_id}/unvoid")
async def unvoid(demand_id: str, user: dict = Depends(require("demands.register.void"))):
    raise ApiError(409, "Voiding is final — raise a new demand instead", "STATE_FINAL")


@router.post("/{demand_id}/reminder-sent")
async def reminder_sent(demand_id: str, request: Request, user: dict = Depends(require("demands.register.print"))):
    d = await db.demands.find_one({"id": demand_id, "company_id": user["company_id"]}, {"_id": 0})
    if not d:
        raise ApiError(404, "Demand not found", "NOT_FOUND")
    ensure_project_access(user, d["project_id"])
    ts = now_iso()
    await db.demands.update_one({"id": demand_id}, {"$set": {"reminder_sent_at": ts, "reminder_sent_by": user["id"]}, "$push": {"reminders": {"at": ts, "by": user["id"], "by_name": user["name"]}}})
    await write_audit(user, "demand.reminder_sent", "booking", d["booking_id"], after={"demand_number": d["demand_number"]}, ip=client_ip(request))
    return {"ok": True, "reminder_sent_at": ts}
