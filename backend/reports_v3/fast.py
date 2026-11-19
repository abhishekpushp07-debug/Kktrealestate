"""3I: Collections' default view (no filter, group, sort or column choice) straight from Mongo: totals, lines and filter
options from server-side $group stages, and only the requested page of receipts decoded. Same figures, order and
counts as the row-by-row path (tools/equiv_3i.py + tests/test_phase3i_fast.py hold them equal); anything else
(filters, groups, exports, as-of) keeps the full path."""

import asyncio

from db import db
from reports_v3 import engine as E
from reports_v3 import legacy as LG
from routers.reports import _scope
from routers.reports_i import refunds_in
from services import clock
from services import definitions as D

_QUIET = {"as_of", "page", "page_size", "period_from", "period_to", "_default_period", "dir"}


def applies(spec: dict, user: dict, p: dict) -> bool:
    if spec["key"] != "collections" or E.MONEY_PERM not in user["permissions"]:
        return False
    if p["as_of"] != clock.today() or not p.get("period_from") or not p.get("period_to"):
        return False
    return not any(v for k, v in p.items() if k not in _QUIET)


def _day(expr) -> dict:
    return {
        "$dateToString": {
            "date": {
                "$dateFromString": {"dateString": {"$substrCP": [expr, 0, 19]}, "timezone": "UTC", "onError": None}
            },
            "timezone": str(clock.business_tz()),
            "format": "%Y-%m-%d",
        }
    }


def _or(a, b) -> dict:  # Python `a or b` for strings
    return {"$cond": [{"$gt": [{"$strLenCP": {"$ifNull": [a, ""]}}, 0]}, a, b]}


def _part_sum(cat: str) -> dict:
    return {
        "$reduce": {
            "input": "$_parts",
            "initialValue": 0,
            "in": {"$add": ["$$value", {"$cond": [{"$eq": ["$$this.cat", cat]}, "$$this.amt", 0]}]},
        }
    }


def _base(user: dict, f: str, t: str, parts_needed: bool, part: dict | None = None) -> list[dict]:
    """Receipt rows in the period: one per received receipt (on its received day) + one per reversal (its day).
    `part` (3I) narrows the scan to one slice of receipts (a project), on top of the user's own scope."""
    sc, st = _scope(user) | ({"$and": [part]} if part else {}), {"$in": ["Cleared", "Reversed"]}
    since = clock.day_start_utc(f)
    rev = {"$and": [{"$eq": ["$status", "Reversed"]}, {"$ne": [{"$ifNull": ["$reversal", None]}, None]}]}
    proj = {
        "_id": 0,
        "receipt_number": 1,
        "booking_id": 1,
        "amount_paise": 1,
        "payment_mode_code": 1,
        "payment_mode_name": 1,
        "bank_account_name": 1,
        "ibank": "$instrument.bank",
        "rreason": "$reversal.reason",
        "_rows": {
            "$concatArrays": [
                [{"rev": False, "d": D.received_day_expr()}],
                {"$cond": [rev, [{"rev": True, "d": _day({"$ifNull": ["$reversal.at", "$updated_at"]})}], []]},
            ]
        },
    }
    if parts_needed:
        proj |= {"allocations": 1, "against": 1, "payment_category": 1}
    return [
        {
            "$match": {
                "$or": [
                    {**sc, "status": st, "payment_date": {"$gte": f}},
                    {**sc, "status": st, "posted_at": {"$gte": since}},
                    {**sc, "status": "Reversed", "reversal.at": {"$gte": since}},
                ]
            }
        },
        {"$project": proj},
        {"$unwind": "$_rows"},
        {"$match": {"_rows.d": {"$gte": f, "$lte": t}}},
        {
            "$set": {
                "_r": "$_rows",
                "group": {"$concat": ["$receipt_number", {"$cond": ["$_rows.rev", " (reversal)", ""]}]},
            }
        },
    ]


def _amounts() -> list[dict]:
    sign = {"$cond": ["$_r.rev", -1, 1]}
    return [
        {"$set": {"_parts": D.receipt_parts_stages()[0]["$addFields"]["_part"]}},
        {
            "$set": {
                "amt": {"$multiply": ["$amount_paise", sign]},
                "c": {"$multiply": [_part_sum("Cash"), sign]},
                "a": {"$multiply": [_part_sum("Account"), sign]},
                "o": {"$multiply": [_part_sum("Other"), sign]},
                "tag": {
                    "$cond": [
                        "$_r.rev",
                        {"$concat": ["Reversal: ", {"$ifNull": ["$rreason", ""]}]},
                        {"$ifNull": ["$payment_mode_name", ""]},
                    ]
                },
            }
        },
    ]


def _pipelines(user: dict, f: str, t: str, skip: int, size: int, part: dict | None = None) -> list:
    tot = [
        {
            "$group": {
                "_id": None,
                "count": {"$sum": 1},
                "cash_paise": {"$sum": "$c"},
                "account_paise": {"$sum": "$a"},
                "other_paise": {"$sum": "$o"},
                "reversal_paise": {"$sum": {"$cond": ["$_r.rev", "$amt", 0]}},
                "total_paise": {"$sum": "$amt"},
                "cash_mode_paise": {"$sum": {"$cond": [{"$eq": ["$payment_mode_code", "CASH"]}, "$amt", 0]}},
            }
        },
    ]
    keep = ("receipt_number", "group", "_r", "booking_id", "c", "a", "o", "amt", "tag", "ibank")
    keep += ("bank_account_name", "payment_mode_name", "payment_mode_code")
    page = [  # 3I: the page is one more branch of the same single scan — only its rows leave the database
        {"$project": {k: 1 for k in keep}},
        {"$sort": {"_r.d": -1, "group": -1}},
        {"$skip": skip},
        {"$limit": size},
    ]
    opts = [
        {
            "$group": {
                "_id": {
                    "b": "$booking_id",
                    "m": _or("$payment_mode_name", _or("$tag", "—")),
                    "k": _or("$ibank", _or("$bank_account_name", {"$cond": ["$c", "Cash", "Not recorded"]})),
                },
                "hi": {"$max": {"$concat": ["$_r.d", "|", "$group"]}},  # 3I: where the group's rows sit in row order
            }
        },
    ]
    return [*_base(user, f, t, True, part), *_amounts(), {"$facet": {"tot": tot, "opts": opts, "page": page}}]


async def _scan(user: dict, f: str, t: str, skip: int, size: int) -> tuple[dict, list, list]:
    """3I: the one scan, split by project into parallel aggregates (the database works them side by side).
    Totals add up; option groups are per booking (a booking sits in one project); the page is merged on the same
    unique (day, receipt) order and cut once — so the result is the single scan's, exactly."""
    pids = await db.payments.distinct("project_id", _scope(user))
    parts = [{"project_id": p} for p in pids] + [{"project_id": {"$nin": pids}}]
    got = await asyncio.gather(
        *(db.payments.aggregate(_pipelines(user, f, t, 0, skip + size, x), allowDiskUse=True).to_list(1) for x in parts)
    )
    tot: dict = {}
    opts, rows = [], []
    for g in got:
        if not g:
            continue
        for k, v in ((g[0]["tot"] or [{}])[0]).items():
            if k != "_id":
                tot[k] = tot.get(k, 0) + v
        opts += g[0]["opts"]
        rows += g[0]["page"]
    rows.sort(key=lambda x: (x["_r"]["d"], x["group"]), reverse=True)
    return tot, opts, rows[skip : skip + size]


def _row(x: dict, dims: dict) -> dict:
    """The row the full path builds (legacy group row → booking dims → finance.collections), for one receipt."""
    r = {
        "group": x["group"],
        "count": 1,
        "cash_paise": x["c"],
        "account_paise": x["a"],
        "other_paise": x["o"],
        "reversal_paise": x["amt"] if x["_r"]["rev"] else 0,
        "total_paise": x["amt"],
        "customer_name": None,
        "booking_number": None,
        "tag": x["tag"],
        "date": x["_r"]["d"],
    }
    d = dims.get(x.get("booking_id")) or {}
    r["customer_name"], r["booking_number"] = d.get("_customer_name"), d.get("_booking_number")
    out = {k: v for k, v in r.items()} | {k: v for k, v in d.items() if not k.startswith("_")}
    out["_legacy_link"] = f"/payments?q={x['receipt_number']}"
    out["bank"] = x.get("ibank") or x.get("bank_account_name") or ("Cash" if out["cash_paise"] else "Not recorded")
    out["mode"] = x.get("payment_mode_name") or out["tag"] or "—"
    cash = x.get("payment_mode_code") == "CASH"
    out["cash_mode_paise"], out["bank_mode_paise"] = (out["total_paise"], 0) if cash else (0, out["total_paise"])
    out["shares"] = [k for k in ("cash", "account", "other") if out.get(f"{k}_paise")]
    out["is_regular"] = not out["reversal_paise"]
    return out


async def collections(spec: dict, user: dict, p: dict, page: int, size: int) -> dict:
    f, t = p["period_from"], p["period_to"]
    sc = _scope(user)

    async def names_and_refunds():
        bks = await db.bookings.find(sc, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1}).to_list(None)
        names = {b["id"]: b for b in bks}
        return names, await refunds_in(set(names), f, t)

    both, (by_no, by_id), (names, ref), hand = await asyncio.gather(  # 3I: every read beside the one scan
        _scan(user, f, t, (page - 1) * size, size),
        LG._booking_dims(user),
        names_and_refunds(),
        D.cheques_in_hand(sc, t),
    )
    dims = {}
    for bid, d in by_id.items():
        b = names.get(bid) or {}
        dims[bid] = d | {"_customer_name": b.get("customer_name"), "_booking_number": b.get("booking_number")}
    tot0, opt_l, picked = both
    tot = {k: tot0.get(k, 0) for k in spec["totals"]}
    tot["bank_mode_paise"] = tot.get("total_paise", 0) - tot.get("cash_mode_paise", 0)
    hand = [x for x in hand if x["booking_id"] in names]
    tot |= {
        "in_hand_paise": sum(x["amount_paise"] for x in hand),
        "in_hand_n": len(hand),
        "refunds_paid_paise": abs(ref["j"]),
        "refunds_paid_n": ref["n"],
    }
    pseudo = []  # one stand-in row per (booking, mode, bank): every filter option the full row set would offer
    # in the full row set's order, so an option whose label differs between bookings takes the same (first) label
    for o in sorted(opt_l, key=lambda o: o["hi"], reverse=True):  # rows run newest (day, receipt) first
        d = {k: v for k, v in (dims.get(o["_id"].get("b")) or {}).items() if not k.startswith("_")}
        pseudo.append(d | {"mode": o["_id"]["m"], "bank": o["_id"]["k"]})
    opts = E.options(spec, pseudo)
    rows = [_row(x, dims) for x in picked]
    n = tot.get("count", 0)
    return {
        "count": n,
        "rows": rows,
        "cols": E.visible_columns(spec, user, []),
        "totals": tot,
        "options": opts,
        "sentence": E.sentence(spec, p, opts, n, None),
        "formula": spec["formula"](tot),
        "lines": spec["lines"](tot, rows, p) if spec.get("lines") else [],
        "illustration": spec["illustration"](rows, tot) if spec.get("illustration") else None,
    }
