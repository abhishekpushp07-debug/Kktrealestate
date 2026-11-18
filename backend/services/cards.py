"""3L card figures (REQ-156…161): per-customer and per-booking card facts, built only from services/definitions."""

from datetime import date

from db import db
from services import clock
from services.definitions import (
    LIVE_BOOKING_STATUSES,
    advance,
    ageing_bands,
    demand_balance,
    is_overdue,
    open_demands_match,
    outstanding,
    overdue_days,
    overdue_of,
)

_BK = {
    "_id": 0,
    "id": 1,
    "customer_id": 1,
    "booking_number": 1,
    "status": 1,
    "project_code": 1,
    "project_id": 1,
    "member_no": 1,
    "booking_date": 1,
    "block_id": 1,
    "block_name": 1,
    "flat_snapshot.flat_number": 1,
    "flat_snapshot.flat_type_code": 1,
    "agreement_value_paise": 1,
    "summary": 1,
    "payment_plan_snapshot.installments": 1,
    "payment_plan_snapshot.name": 1,
    "plan_acceptance.accepted_on": 1,
    "other_charges": 1,
}


def _days(due: str, today: date) -> int:
    return (today - date.fromisoformat(due[:10])).days


async def _stages(block_ids: set) -> dict:
    out = {}
    async for b in db.blocks.find({"id": {"$in": list(block_ids)}}, {"_id": 0, "id": 1, "construction_stages": 1}):
        out[b["id"]] = b.get("construction_stages") or []
    return out


def plan_status(bk: dict, demands: list[dict], stages: list[dict], today: date) -> dict:
    """One status per instalment in plan order: paid / part / overdue / billed / awaiting (REQ-160)."""
    by_seq = {d["installment_seq"]: d for d in demands if d.get("installment_seq") is not None}
    done = {s["stage_id"]: s for s in stages if s.get("status") == "Completed"}
    current = next((s["name"] for s in reversed(stages) if s.get("status") == "Completed"), "not started")
    segs, nxt = [], None
    for i in sorted((bk.get("payment_plan_snapshot") or {}).get("installments") or [], key=lambda x: x["seq"]):
        d = by_seq.get(i["seq"])
        if d is None:
            st = "awaiting"
            if nxt is None and i.get("trigger_type") == "ON_STAGE" and i.get("trigger_stage_id") not in done:
                nxt = i.get("trigger_stage_name") or i["name"]
        elif demand_balance(d) == 0:
            st = "paid"
        elif is_overdue(d, today):
            st = "overdue"
        elif (d.get("paid_paise") or 0) > 0:
            st = "part"
        else:
            st = "billed"
        segs.append({"seq": i["seq"], "name": i["name"], "percent": i["percent"], "status": st})
    n_done = sum(1 for s in stages if s.get("status") == "Completed")
    return {
        "segments": segs,
        "stage_k": n_done,
        "stage_n": len(stages),
        "next_stage": nxt,
        "current_stage": current,
    }


def balance(summary: dict, demands: list[dict], today: date, other_charges: list | None = None) -> dict:
    """REQ-157: Due ₹X (+ overdue N days) / Advance ₹X / All clear. Overdue == definitions.ageing_bands (incl.
    demanded other charges), so the card, the ageing report and Home agree."""
    out = outstanding(summary)
    due, adv = out["total_paise"], advance(summary)
    days = overdue_days(summary, demands, other_charges or [], today)  # one definition (REQ-209)
    state = "due" if due > 0 else "advance" if adv > 0 else "clear"
    return {
        "state": state,
        "due_paise": due,
        "advance_paise": adv,
        "overdue_paise": overdue_of(ageing_bands(summary, demands, other_charges or [], today)),
        "overdue_days": days,
    }


async def booking_cards(bookings: list[dict], today: date | None = None) -> dict:
    today = today or clock.today()
    ids = [b["id"] for b in bookings]
    dem = {}
    async for d in db.demands.find(
        {"booking_id": {"$in": ids}, "voided": {"$ne": True}},
        {
            "_id": 0,
            "booking_id": 1,
            "installment_seq": 1,
            "installment_name": 1,
            "milestone_name": 1,
            "status": 1,
            "total_demand_paise": 1,
            "cash_demand_paise": 1,
            "account_demand_paise": 1,
            "paid_paise": 1,
            "due_date": 1,
            "voided": 1,
        },
    ):
        dem.setdefault(d["booking_id"], []).append(d)
    stages = await _stages({b["block_id"] for b in bookings})
    out = {}
    for b in bookings:
        ds = dem.get(b["id"], [])
        s = b.get("summary") or {}
        opn = sorted(
            (d for d in ds if d.get("status") in ("Open", "Partially Paid") and demand_balance(d)),
            key=lambda d: d.get("due_date") or "9999",
        )
        plan = plan_status(b, ds, stages.get(b["block_id"], []), today)
        nxt = (
            {
                "kind": "bill",
                "name": opn[0].get("milestone_name") or opn[0].get("installment_name"),
                "amount_paise": demand_balance(opn[0]),
                "due_date": opn[0].get("due_date"),
            }
            if opn
            else {
                "kind": "awaiting",
                "stage": plan["next_stage"],
                "tower": b.get("block_name"),
                "current_stage": plan["current_stage"],
            }
            if plan["next_stage"]
            else None
        )
        out[b["id"]] = {
            "billed_paise": s.get("total_udhar_paise", 0),  # two_sided: Bill raised = Udhar side
            "received_paise": s.get("total_jama_paise", 0) - s.get("waived_paise", 0),
            "waived_paise": s.get("waived_paise", 0),
            "balance": balance(s, ds, today, b.get("other_charges")),
            "plan": plan,
            "next": nxt,
        }
    return out


async def customer_cards(customer_ids: list[str], today: date | None = None) -> dict:
    from services.member_no import ensure_member_nos, project_units

    today = today or clock.today()
    q = {"customer_id": {"$in": customer_ids}, "status": {"$in": LIVE_BOOKING_STATUSES}}
    pids = set(await db.bookings.distinct("project_id", q))
    await ensure_member_nos(pids)
    units = await project_units(pids)
    bks = await db.bookings.find(q, _BK).sort("booking_date", 1).to_list(None)
    per = await booking_cards(bks, today)
    out = {}
    for b in bks:
        c = out.setdefault(
            b["customer_id"],
            {
                "bookings": [],
                "billed_paise": 0,
                "received_paise": 0,
                "due_paise": 0,
                "advance_paise": 0,
                "overdue_paise": 0,
                "overdue_days": 0,
                "next": None,
            },
        )
        p = per[b["id"]]
        c["bookings"].append(
            {
                "id": b["id"],
                "project_code": b.get("project_code"),
                "flat": (b.get("flat_snapshot") or {}).get("flat_number"),
                "type": (b.get("flat_snapshot") or {}).get("flat_type_code"),
                "tower": b.get("block_name"),
                "member_no": b.get("member_no"),
                "project_units": units.get(b.get("project_id")) or 0,
                "plan_name": (b.get("payment_plan_snapshot") or {}).get("name"),
                "stage_k": p["plan"]["stage_k"],
                "stage_n": p["plan"]["stage_n"],
                "current_stage": p["plan"]["current_stage"],
                "booking_date": b.get("booking_date"),
                "due_paise": p["balance"]["due_paise"],
                "agreement_signed": bool((b.get("plan_acceptance") or {}).get("accepted_on")),
            }
        )
        c["billed_paise"] += p["billed_paise"]
        c["received_paise"] += p["received_paise"]
        for k in ("due_paise", "advance_paise", "overdue_paise"):
            c[k] += p["balance"][k]
        c["overdue_days"] = max(c["overdue_days"], p["balance"]["overdue_days"])
        n = p["next"]
        if n and (
            c["next"] is None
            or (
                n["kind"] == "bill"
                and (c["next"]["kind"] != "bill" or (n["due_date"] or "9999") < (c["next"]["due_date"] or "9999"))
            )
        ):
            c["next"] = n
    for c in out.values():
        c["state"] = "due" if c["due_paise"] > 0 else "advance" if c["advance_paise"] > 0 else "clear"
        c["agreement_pending"] = any(not x["agreement_signed"] for x in c["bookings"])
    return out


CUSTOMER_SEGMENTS = ("attention", "overdue30", "on_track", "clear", "advance", "no_booking", "kyc_pending", "all")


async def customer_segments(company_id: str, today: date | None = None) -> dict[str, set]:
    """REQ-159 segment membership (server-side): Needs attention = overdue, follow-up due, or KYC pending on a booked customer."""
    today = today or clock.today()
    allc = {
        c["id"]: c
        for c in await db.customers.find(
            {"company_id": company_id, "is_active": True}, {"_id": 0, "id": 1, "kyc_status": 1}
        ).to_list(None)
    }
    cards = await customer_cards(list(allc), today)
    fu = set(
        await db.leads.distinct(
            "converted_customer_id",
            {"company_id": company_id, "next_follow_up_at": {"$lte": clock.day_end_utc()}},
        )
    )
    booked = set(cards)
    kyc = {i for i, c in allc.items() if c.get("kyc_status") not in ("Verified",)}
    od = {i for i, c in cards.items() if c["overdue_paise"] > 0}
    return {
        "attention": od | (fu & set(allc)) | (kyc & booked),
        "overdue30": {i for i, c in cards.items() if c["overdue_paise"] > 0 and c["overdue_days"] >= 30},
        # due but nothing overdue yet; with overdue / clear / advance-only / no booking it partitions "all"
        "on_track": {i for i, c in cards.items() if c["due_paise"] > 0 and c["overdue_paise"] == 0},
        "overdue": od,
        "clear": {i for i, c in cards.items() if c["state"] == "clear"},
        # any advance held (matches the Advance report), even when another part of the booking is still due
        "advance": {i for i, c in cards.items() if c["advance_paise"] > 0},
        "advance_only": {i for i, c in cards.items() if c["state"] == "advance"},
        "no_booking": set(allc) - booked,
        "kyc_pending": kyc,
        "all": set(allc),
    }


async def project_cards(project_ids: list[str]) -> dict:
    """REQ-155: Collected / Outstanding (definitions) + per-tower stage progress and the next stage."""
    out = {
        p: {"collected_paise": 0, "outstanding_paise": 0, "bookings": 0, "towers": [], "next": None}
        for p in project_ids
    }
    async for b in db.bookings.find(
        {"project_id": {"$in": project_ids}, "status": {"$in": LIVE_BOOKING_STATUSES}},
        {"_id": 0, "project_id": 1, "summary": 1},
    ):
        c = out[b["project_id"]]
        c["bookings"] += 1
        s = b.get("summary") or {}
        c["collected_paise"] += s.get("total_jama_paise", 0) - s.get("waived_paise", 0)
        c["outstanding_paise"] += outstanding(b.get("summary"))["total_paise"]
    async for blk in db.blocks.find(
        {"project_id": {"$in": project_ids}, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "project_id": 1, "name": 1, "code": 1, "construction_stages": 1},
    ).sort("code", 1):
        st = blk.get("construction_stages") or []
        k = sum(1 for s in st if s.get("status") == "Completed")
        nxt = next((s["name"] for s in sorted(st, key=lambda s: s["seq"]) if s.get("status") != "Completed"), None)
        t = {
            "id": blk["id"],
            "name": blk["name"],
            "code": blk.get("code"),
            "stage_k": k,
            "stage_n": len(st),
            "percent": round(100 * k / len(st)) if st else 0,
            "next_stage": nxt,
        }
        c = out[blk["project_id"]]
        c["towers"].append(t)
        if nxt and (c["next"] is None or t["percent"] > c["next"]["percent"]):
            c["next"] = {"stage": nxt, "tower": blk["name"], "percent": t["percent"]}
    return out


__all__ = ["booking_cards", "customer_cards", "customer_segments", "open_demands_match", "project_cards"]


async def plan_timeline(bk: dict, today: date | None = None) -> dict:
    """REQ-160/162: one row per instalment in plan order with trigger, %, amount, stage state and bill state."""
    today = today or clock.today()
    demands = await db.demands.find(
        {"booking_id": bk["id"], "voided": {"$ne": True}},
        {
            "_id": 0,
            "id": 1,
            "demand_number": 1,
            "installment_seq": 1,
            "status": 1,
            "total_demand_paise": 1,
            "paid_paise": 1,
            "due_date": 1,
            "demand_date": 1,
        },
    ).to_list(None)
    stages = (await _stages({bk["block_id"]})).get(bk["block_id"], [])
    by_seq = {d["installment_seq"]: d for d in demands if d.get("installment_seq") is not None}
    by_stage = {s["stage_id"]: s for s in stages}
    current = next((s["name"] for s in reversed(stages) if s.get("status") == "Completed"), None)
    agreed = bk.get("agreement_value_paise") or 0
    rows = []
    for i in sorted((bk.get("payment_plan_snapshot") or {}).get("installments") or [], key=lambda x: x["seq"]):
        d = by_seq.get(i["seq"])
        stage = None
        if i.get("trigger_type") == "ON_STAGE":
            s = by_stage.get(i.get("trigger_stage_id")) or {}
            done = s.get("status") == "Completed"
            stage = {
                "name": i.get("trigger_stage_name") or s.get("name"),
                "state": "completed" if done else "awaiting",
                "completed_on": s.get("completed_on") if done else None,
                "tower_current_stage": None if done else current,
            }
        if d is None:
            bill = {"state": "not_billed"}
        else:
            open_ = demand_balance(d)
            late = is_overdue(d, today)
            if open_ == 0:
                st = "paid"
            elif late:
                st = "overdue"
            elif (d.get("paid_paise") or 0) > 0:
                st = "part_paid"
            else:
                st = "billed"
            bill = {
                "state": st,
                "demand_id": d["id"],
                "demand_number": d.get("demand_number"),
                "billed_paise": d.get("total_demand_paise") or 0,
                "paid_paise": d.get("paid_paise") or 0,
                "open_paise": open_,
                "due_date": d.get("due_date"),
                "overdue_days": _days(d["due_date"], today) if late else 0,
            }
        rows.append(
            {
                "seq": i["seq"],
                "name": i["name"],
                "trigger_type": i.get("trigger_type"),
                "trigger_stage_id": i.get("trigger_stage_id"),
                "trigger_date": i.get("trigger_date"),
                "trigger_days": i.get("trigger_days"),
                "percent": i["percent"],
                "amount_paise": d.get("total_demand_paise") if d else round(agreed * (i["percent"] or 0) / 100),
                "amount_is_estimate": d is None,
                "stage": stage,
                "bill": bill,
            }
        )
    counts = {}
    for r in rows:
        counts[r["bill"]["state"]] = counts.get(r["bill"]["state"], 0) + 1
    return {
        "booking_id": bk["id"],
        "rows": rows,
        "counts": counts,
        "stage_k": sum(1 for s in stages if s.get("status") == "Completed"),
        "stage_n": len(stages),
    }
