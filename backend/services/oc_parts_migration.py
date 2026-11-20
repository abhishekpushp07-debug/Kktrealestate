"""REQ-210/213: back-fill every other-charge part with its own bill date + due date. Audited, idempotent, re-runnable.
Writes only `other_charges[].demand_history[].due_on` (and a part for a line that had none); amounts and balances untouched."""

import json
import os

from db import db
from services import clock
from services.definitions import days_to_pay, due_on, outstanding
from utils import now_iso, write_audit

REPORT = "/app/memory/qa/migration_oc_parts.md"


async def _ledger_totals(ids: list[str]) -> dict:
    return {
        r["_id"]: (r["d"], r["c"], r["n"])
        for r in await db.ledger_entries.aggregate(
            [
                {"$match": {"booking_id": {"$in": ids}}},
                {
                    "$group": {
                        "_id": "$booking_id",
                        "d": {"$sum": "$udhar_paise"},
                        "c": {"$sum": "$jama_paise"},
                        "n": {"$sum": 1},
                    }
                },
            ]
        ).to_list(None)
    }


def _bill_of(h: dict, bills: list[dict]) -> dict | None:
    """The instalment bill a GST-with-stage part was billed with: same cumulative % (and stage, when it has one)."""
    if h.get("cum_percent") is None:
        return None
    same = [d for d in bills if d.get("cumulative_percent") == h["cum_percent"]]
    return next((d for d in same if d.get("trigger_stage_id") == h.get("stage_id")), None) or (
        same[0] if same else None
    )


def _snap(b: dict) -> str:
    return json.dumps([b.get("summary") or {}, outstanding(b.get("summary") or {})], sort_keys=True, default=str)


async def migrate(dry_run: bool = False) -> dict:
    companies = {
        c["id"]: c for c in await db.companies.find({}, {"_id": 0, "id": 1, "demand_due_days": 1}).to_list(None)
    }
    bills = {}  # booking_id -> its instalment bills, one batched read
    async for d in db.demands.find(
        {"voided": {"$ne": True}},
        {"_id": 0, "booking_id": 1, "trigger_stage_id": 1, "demand_date": 1, "due_date": 1, "cumulative_percent": 1},
    ):
        bills.setdefault(d["booking_id"], []).append(d)
    q = {"other_charges": {"$elemMatch": {"demanded_at": {"$nin": [None, ""]}}}}
    books = await db.bookings.find(
        q, {"_id": 0, "id": 1, "booking_number": 1, "company_id": 1, "summary": 1, "other_charges": 1}
    ).to_list(None)
    before = {b["id"]: _snap(b) for b in books}
    led0 = await _ledger_totals([b["id"] for b in books])
    stats = {"bookings": 0, "parts_dated": 0, "parts_redated": 0, "parts_created": 0, "already": 0, "flagged": []}
    for b in books:
        days, changed = days_to_pay(companies.get(b["company_id"])), False
        for l in b.get("other_charges") or []:
            if not l.get("demanded_at"):
                continue
            hist = l.setdefault("demand_history", [])
            if not hist:
                hist.append({"at": l["demanded_at"], "paise": l.get("demanded_paise") or 0})
                stats["parts_created"] += 1
            for h in hist:
                bill = _bill_of(h, bills.get(b["id"]) or [])
                day = bill["demand_date"] if bill else (clock.day_of(h.get("at")) or clock.day_of(l["demanded_at"]))
                due = h.get("due_on") or (bill["due_date"] if bill else due_on(day, days))  # a stored due never moves
                if (h.get("bill_day"), h.get("due_on")) == (day, due):
                    stats["already"] += 1
                    continue
                stats["parts_redated" if h.get("bill_day") else "parts_dated"] += 1
                h["bill_day"], h["due_on"] = day, due
                changed = True
            rest = (l.get("demanded_paise") or 0) - sum(h.get("paise") or 0 for h in hist)
            if rest > 0 and not l.get("part_flag"):  # REQ-213: no recoverable bill date → first billed date, flagged
                l["part_flag"] = "from_first_billed"
                l["due_on"] = due_on(clock.day_of(l["demanded_at"]), days)
                stats["flagged"].append(f"{b['booking_number']} · {l.get('name')} · ₹{rest / 100:,.0f}")
                changed = True
        if changed:
            stats["bookings"] += 1
            if not dry_run:
                await db.bookings.update_one({"id": b["id"]}, {"$set": {"other_charges": b["other_charges"]}})
    after = {
        b["id"]: _snap(b)
        for b in await db.bookings.find({"id": {"$in": list(before)}}, {"_id": 0, "id": 1, "summary": 1}).to_list(None)
    }
    led1 = await _ledger_totals(list(before))
    stats["balance_changes"] = sum(1 for i in before if before[i] != after.get(i)) + sum(
        1 for i in before if led0.get(i) != led1.get(i)
    )
    if not dry_run:
        from services import read_models

        await read_models.recompute_all()  # Home / cards snapshots pick up the dated parts
        await write_audit(
            None,
            "migration.oc_parts",
            "booking",
            "all",
            after={k: v for k, v in stats.items() if k != "flagged"} | {"flagged": len(stats["flagged"])},
        )
        _report(stats, len(books))
    return stats


def _report(s: dict, n: int) -> None:
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    flagged = "\n".join(f"- {x}" for x in s["flagged"]) or "- none"
    with open(REPORT, "a") as f:
        f.write(
            f"\n## Run {now_iso()} · DB {os.environ['DB_NAME']}\nBookings with billed other charges: {n} · bookings updated: {s['bookings']} · "
            f"parts dated: {s['parts_dated']} · parts re-dated to their bill's day: {s['parts_redated']} · "
            f"parts created (single-bill lines): {s['parts_created']} · "
            f"already dated (skipped): {s['already']} · balance/ledger changes: **{s['balance_changes']}**\n"
            f"Flagged (no recoverable bill date, aged from first billed date):\n{flagged}\n"
        )
