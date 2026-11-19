"""Phase Q trends read model: monthly buckets per scope (company | project | customer) — collections (received
cleared), demands raised (Udhar), outstanding at month end, bookings.
Buckets are recomputed from source on read-model flush (dirty events) and backfilled once by a watermarked migration; the API serves buckets only."""

from datetime import date

from db import db
from services import clock
from services.definitions import received_day_expr, received_match
from utils import now_iso

BASIS = "cleared"  # REQ-319: received = cleared (cheque / DD on its clearing day)
KINDS = (
    "collections",
    "collections_cash",
    "collections_account",
    "collections_other",
    "demands",
    "outstanding_eom",
    "bookings",
)


def _months(n: int, until: date | None = None) -> list[str]:
    d = (until or clock.today()).replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.isoformat()[:7])
        d = (d - date.resolution).replace(day=1)
    return list(reversed(out))


def _scope_match(scope: str, sid: str, company_id: str) -> dict:
    return {
        "company_id": company_id,
        **({"project_id": sid} if scope == "project" else {"customer_id": sid} if scope == "customer" else {}),
    }


async def compute(company_id: str, scope: str, sid: str | None, months: list[str]) -> dict:
    m = _scope_match(scope, sid or "", company_id)
    lo, hi = months[0] + "-01", months[-1] + "-31"
    from services.definitions import receipt_split

    split = {
        r["_id"]: r
        for r in await receipt_split({**m, **received_match(lo, hi)}, {"$substr": [received_day_expr(), 0, 7]})
    }
    col = {k: r["total_paise"] for k, r in split.items()}
    dem = {
        r["_id"]: r["v"]
        for r in await db.demands.aggregate(
            [
                {
                    "$match": {
                        **m,
                        "voided": {"$ne": True},
                        "status": {"$nin": ["Voided", "Cancelled"]},
                        "demand_date": {"$gte": lo, "$lte": hi},
                    }
                },
                {"$group": {"_id": {"$substr": ["$demand_date", 0, 7]}, "v": {"$sum": "$total_demand_paise"}}},
            ]
        ).to_list(None)
    }
    bk = {
        r["_id"]: r["v"]
        for r in await db.bookings.aggregate(
            [
                {"$match": {**m, "booking_date": {"$gte": lo, "$lte": hi}}},
                {"$group": {"_id": {"$substr": ["$booking_date", 0, 7]}, "v": {"$sum": 1}}},
            ]
        ).to_list(None)
    }
    # outstanding at month end = Σ demands raised to date − Σ cleared collections to date (ledger Udhar − Jama, live bookings)
    live = {"status": {"$in": ["Active", "Completed"]}}
    live_ids = (
        [b["id"] for b in await db.bookings.find({**m, **live}, {"_id": 0, "id": 1}).to_list(None)]
        if scope != "company"
        else None
    )
    bm = {"booking_id": {"$in": live_ids}} if live_ids is not None else {"company_id": company_id}
    cum_d = {
        r["_id"]: r["v"]
        for r in await db.demands.aggregate(
            [
                {
                    "$match": {
                        **bm,
                        "voided": {"$ne": True},
                        "status": {"$nin": ["Voided", "Cancelled"]},
                        "demand_date": {"$lte": hi},
                    }
                },
                {"$group": {"_id": {"$substr": ["$demand_date", 0, 7]}, "v": {"$sum": "$total_demand_paise"}}},
            ]
        ).to_list(None)
    }
    cum_c: dict = {}
    rm = received_match(None, hi)
    for br in rm["$or"]:  # 3I: the two received branches as two index-led pipelines (one $or was a full scan)
        for r in await db.payments.aggregate(
            [
                {"$match": {**bm, "status": rm["status"], **br}},
                {"$group": {"_id": {"$substr": [received_day_expr(), 0, 7]}, "v": {"$sum": "$amount_paise"}}},
            ]
        ).to_list(None):
            cum_c[r["_id"]] = cum_c.get(r["_id"], 0) + r["v"]
    keys = sorted(set(cum_d) | set(cum_c))
    run_d = run_c = 0
    eom = {}
    for k in keys:
        run_d += cum_d.get(k, 0)
        run_c += cum_c.get(k, 0)
        eom[k] = max(run_d - run_c, 0)
    series = {
        "collections": [],
        "collections_cash": [],
        "collections_account": [],
        "collections_other": [],
        "demands": [],
        "outstanding_eom": [],
        "bookings": [],
    }
    last = 0
    for mo in months:
        series["collections"].append(col.get(mo, 0))
        for c in ("Cash", "Account", "Other"):
            series[f"collections_{c.lower()}"].append(split.get(mo, {}).get(f"{c}_paise", 0))
        series["demands"].append(dem.get(mo, 0))
        series["bookings"].append(bk.get(mo, 0))
        last = eom.get(mo, last if any(k <= mo for k in keys) else 0)
        series["outstanding_eom"].append(last)
    return series


async def refresh(company_id: str, scope: str, sid: str | None, months: int = 24) -> dict:
    ms = _months(months)
    series = await compute(company_id, scope, sid, ms)
    docs = [
        {
            "company_id": company_id,
            "scope": scope,
            "scope_id": sid or company_id,
            "month": mo,
            **{k: series[k][i] for k in KINDS},
            "basis": BASIS,
            "updated_at": now_iso(),
        }
        for i, mo in enumerate(ms)
    ]
    from pymongo import UpdateOne

    await db.monthly_buckets.bulk_write(  # 3I: one round trip for the 24 months (was 24)
        [
            UpdateOne(
                {"company_id": company_id, "scope": scope, "scope_id": d["scope_id"], "month": d["month"]},
                {"$set": d},
                upsert=True,
            )
            for d in docs
        ],
        ordered=False,
    )
    return {"months": ms, **series}


async def get(company_id: str, scope: str, sid: str | None, months: int = 12) -> dict:
    ms = _months(months)
    rows = await db.monthly_buckets.find(
        {"company_id": company_id, "scope": scope, "scope_id": sid or company_id, "month": {"$in": ms}}, {"_id": 0}
    ).to_list(None)
    from services import read_model_state

    stale = await read_model_state.shared_pending()  # a bucket refresh is debounced/in flight on any replica → source
    old = any(r.get("basis") != BASIS for r in rows)  # 3H: buckets written on the receipt-date basis are rebuilt once
    if stale or old or len(rows) < len(ms) or any(k not in r for r in rows for k in KINDS):  # or missing month / shape
        full = await refresh(company_id, scope, sid, max(months, 24))
        return {"months": ms, **{k: full[k][-len(ms) :] for k in KINDS}, "source": "monthly_buckets (refreshed)"}
    by = {r["month"]: r for r in rows}
    return {"months": ms, **{k: [by[mo][k] for mo in ms] for k in KINDS}, "source": "monthly_buckets"}


async def backfill_once() -> dict:
    """Watermarked: runs once per company (trends_watermarks), then buckets are maintained by read-model flushes."""
    out = {"companies": 0}
    for co in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None):
        if await db.trends_watermarks.find_one({"company_id": co["id"], "kind": "monthly_buckets_v2"}):
            continue
        await refresh(co["id"], "company", None)
        for p in await db.projects.find({"company_id": co["id"]}, {"_id": 0, "id": 1}).to_list(None):
            await refresh(co["id"], "project", p["id"])
        await db.trends_watermarks.insert_one({"company_id": co["id"], "kind": "monthly_buckets_v2", "at": now_iso()})
        out["companies"] += 1
    await db.monthly_buckets.create_index([("company_id", 1), ("scope", 1), ("scope_id", 1), ("month", 1)], unique=True)
    return out


async def on_dirty(project_ids: set, customer_ids: set, company_ids: set):
    """Called from read_models.flush: recompute the touched scopes only."""
    for cid in company_ids:
        await refresh(cid, "company", None)
    for pid in project_ids:
        p = await db.projects.find_one({"id": pid}, {"_id": 0, "company_id": 1})
        if p:
            await refresh(p["company_id"], "project", pid)
    for cu in customer_ids:
        c = await db.customers.find_one({"id": cu}, {"_id": 0, "company_id": 1})
        if c:
            await refresh(c["company_id"], "customer", cu)
