import importlib
import logging

"""Auto-dues engine (Phase 7): raise installment demands from the booking's payment-plan snapshot. Idempotent."""
from datetime import date, timedelta

from db import db
from services import clock
from services.definitions import days_to_pay
from services.ledger import raise_other_charges, rebuild
from services.money import pct_of
from services.numbering import generate_number, generate_numbers
from utils import new_id, now_iso, write_audit

TRIGGER_LABEL = {
    "ON_BOOKING": "On booking",
    "DAYS_AFTER_BOOKING": "{d} days after booking",
    "ON_STAGE": "On stage: {s}",
    "ON_POSSESSION": "On possession",
    "ON_DATE": "On {dt}",
}


def trigger_label(ins: dict) -> str:
    t = ins["trigger_type"]
    return TRIGGER_LABEL[t].format(
        d=ins.get("trigger_days"), s=ins.get("trigger_stage_name") or "stage", dt=ins.get("trigger_date")
    )


def _stage_map(block: dict) -> dict:
    return {s["stage_id"]: s for s in block.get("construction_stages") or []}


def _possession_stage(block: dict) -> dict | None:
    return next((s for s in block.get("construction_stages") or [] if s.get("is_possession")), None)


def trigger_date(ins: dict, booking: dict, block: dict) -> date | None:
    """Date on which the installment becomes due to be raised; None = not yet triggered."""
    bd = date.fromisoformat(booking["booking_date"])
    t = ins["trigger_type"]
    if t == "ON_BOOKING":
        return bd
    if t == "DAYS_AFTER_BOOKING":
        return bd + timedelta(days=int(ins.get("trigger_days") or 0))
    if t == "ON_DATE":
        return date.fromisoformat(ins["trigger_date"]) if ins.get("trigger_date") else None
    st = _possession_stage(block) if t == "ON_POSSESSION" else _stage_map(block).get(ins.get("trigger_stage_id"))
    if st and st.get("status") == "Completed" and st.get("completed_on"):
        return max(date.fromisoformat(st["completed_on"]), bd)
    return None


def expected_date(ins: dict, booking: dict, block: dict) -> str | None:
    d = trigger_date(ins, booking, block)
    return d.isoformat() if d else None


async def schedules_for(booking_q: dict, chunk_size: int = 500):
    """Yields (booking, schedule rows) for bookings matching booking_q: blocks fetched once each, demands batched per chunk."""
    blocks, chunk = {}, []

    async def flush():
        need = list({b["block_id"] for b in chunk} - blocks.keys())
        if need:
            async for blk in db.blocks.find({"id": {"$in": need}}, {"_id": 0, "id": 1, "construction_stages": 1}):
                blocks[blk["id"]] = blk
        dem = {}
        async for d in db.demands.find({"booking_id": {"$in": [b["id"] for b in chunk]}}, {"_id": 0}).batch_size(500):
            dem.setdefault(d["booking_id"], []).append(d)
        out = [(b, schedule(b, blocks.get(b["block_id"]) or {}, dem.get(b["id"], []))) for b in chunk]
        chunk.clear()
        return out

    async for bk in db.bookings.find(booking_q, {"_id": 0}).batch_size(500):
        chunk.append(bk)
        if len(chunk) >= chunk_size:
            for pair in await flush():
                yield pair
    if chunk:
        for pair in await flush():
            yield pair


def schedule(booking: dict, block: dict, demands: list[dict]) -> list[dict]:
    """Installment schedule with status for UI/portal. Amounts are the planned amounts; raised ones use the demand."""
    snap = booking.get("payment_plan_snapshot") or {}
    ins_list = sorted(snap.get("installments") or [], key=lambda x: x["seq"])
    by_seq = {d.get("installment_seq"): d for d in demands if not d.get("voided")}
    rows, cum = [], 0.0
    today = clock.today().isoformat()
    for ins in ins_list:
        cum = round(cum + ins["percent"], 2)
        c_exp, a_exp = (
            pct_of(booking["cash_agreed_paise"], ins["percent"]),
            pct_of(booking["account_agreed_paise"], ins["percent"]),
        )
        d = by_seq.get(ins["seq"])
        exp = expected_date(ins, booking, block)
        if d:
            c_exp, a_exp = d["cash_demand_paise"], d["account_demand_paise"]
            paid = d.get("paid_paise", 0)
            status = (
                "Paid"
                if paid >= d["total_demand_paise"] and d["total_demand_paise"]
                else "Partially paid"
                if paid
                else ("Overdue" if d["due_date"] < today else "Raised")
            )
        else:
            paid, status = 0, "Not yet due"
        rows.append(
            {
                "seq": ins["seq"],
                "name": ins["name"],
                "percent": ins["percent"],
                "cumulative_percent": cum,
                "trigger_type": ins["trigger_type"],
                "trigger_label": trigger_label(ins),
                "cash_expected_paise": c_exp,
                "account_expected_paise": a_exp,
                "total_expected_paise": c_exp + a_exp,
                "cash_paid_paise": min(paid, c_exp) if d else 0,
                "account_paid_paise": max(paid - c_exp, 0) if d else 0,
                "paid_paise": paid,
                "status": status,
                "expected_date": exp,
                "raised_on": d["demand_date"] if d else None,
                "due_date": d["due_date"]
                if d
                else (
                    (date.fromisoformat(exp) + timedelta(days=int(ins.get("due_days") or 15))).isoformat()
                    if exp
                    else None
                ),
                "demand_id": d["id"] if d else None,
                "demand_number": d["demand_number"] if d else None,
            }
        )
    return rows


def next_raise(booking: dict, cum: float, percent: float) -> tuple[int, int, float]:
    """Cash / account the next installment raises from cumulative `cum` — the posting's own telescoping maths."""
    before_c, before_a = pct_of(booking["cash_agreed_paise"], cum), pct_of(booking["account_agreed_paise"], cum)
    cum = round(cum + percent, 2)
    if cum >= 99.995:
        cum = 100.0
    return (
        pct_of(booking["cash_agreed_paise"], cum) - before_c,
        pct_of(booking["account_agreed_paise"], cum) - before_a,
        cum,
    )


def charges_raised(booking: dict, cum: float, possession: bool) -> int:
    """Other charges (agreement-GST share, possession charges) that posting raises alongside, on a copy of the lines."""
    import copy

    from services.breakdown import raise_stage_charges

    b = {"other_charges": copy.deepcopy(booking.get("other_charges") or [])}
    before = sum(line.get("demanded_paise") or 0 for line in b["other_charges"])
    if possession:
        raise_other_charges(b, "on_possession", "preview", None)
    raise_stage_charges(b, cum, "preview")
    return sum(line.get("demanded_paise") or 0 for line in b["other_charges"]) - before


async def preview_raise(booking: dict, installments: list[dict], possession: bool) -> tuple[int, int, int]:
    """(cash, account, other charges) that raising `installments` now will post for this booking."""
    _, _, cum = await _raised_state(booking)
    cash = acct = 0
    for ins in sorted(installments, key=lambda x: x["seq"]):
        c, a, cum = next_raise(booking, cum, ins["percent"])
        cash, acct = cash + c, acct + a
    return cash, acct, charges_raised(booking, cum, possession)


_RAISED_FIELDS = {
    "_id": 0,
    "booking_id": 1,
    "installment_seq": 1,
    "installment_name": 1,
    "milestone_name": 1,
    "percent": 1,
    "cumulative_percent": 1,
    "absorbed_installment_seqs": 1,
}


async def _raised_state(booking: dict, existing: list[dict] | None = None) -> tuple[set, set, float]:
    """What is already raised on this booking: installment seqs (incl. absorbed), names, cumulative percent."""
    if existing is None:
        existing = await db.demands.find(
            {"booking_id": booking["id"], "voided": {"$ne": True}}, _RAISED_FIELDS
        ).to_list(None)
    raised = {d.get("installment_seq") for d in existing} | {
        s for d in existing for s in d.get("absorbed_installment_seqs") or []
    }
    raised_names = {(d.get("installment_name") or d.get("milestone_name") or "").strip().lower() for d in existing}
    cum = round(sum(d.get("percent") or 0 for d in existing), 2) if existing else 0.0
    if existing and any(d.get("percent") is None for d in existing):
        cum = max(d.get("cumulative_percent") or 0 for d in existing)
    return raised, raised_names, cum


async def _after_raise(
    booking: dict, created: list[dict], cum: float, block: dict, possession_hit: bool, posted_at: str
) -> None:
    """Persist raised percent, possession/stage charges and rebuild the ledger once per evaluation."""
    if created or booking.get("raised_percent") != cum:
        from services.definitions import due_on

        company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0, "demand_due_days": 1})
        due = due_on(clock.day_of(posted_at), days_to_pay(company))
        upd = {"raised_percent": cum, "construction_percent": cum, "updated_at": now_iso()}
        if possession_hit or (_possession_stage(block) or {}).get("status") == "Completed":
            pos = next((d_ for d_ in created if d_.get("trigger_type") == "ON_POSSESSION"), None)
            if raise_other_charges(
                booking,
                "on_possession",
                posted_at,
                (pos or {}).get("due_date") or due,
                (pos or {}).get("demand_date"),
            ):
                upd["other_charges"] = booking["other_charges"]
        from services.breakdown import raise_stage_charges

        # CR-3: attribute the agreement-GST increment per stage (catch-up of several stages → one history entry each),
        # so undo of one stage unwinds only its share
        for d_ in created:
            if raise_stage_charges(  # the stage's GST part is due with the stage bill itself
                booking,
                d_["cumulative_percent"],
                posted_at,
                d_.get("trigger_stage_id"),
                d_.get("due_date") or due,
                d_.get("demand_date"),
            ):
                upd["other_charges"] = booking["other_charges"]
        if raise_stage_charges(
            booking, cum, posted_at, None, due
        ):  # any remainder (e.g. raised_percent drift) stays attributable to no stage
            upd["other_charges"] = booking["other_charges"]
        await db.bookings.update_one({"id": booking["id"]}, {"$set": upd})
        await rebuild(booking["id"])


async def raise_due_installments(
    booking: dict, today: date | None = None, posted_at: str | None = None, actor: dict | None = None
) -> list[dict]:
    """Evaluate every installment; raise exactly one demand per newly-triggered installment. Returns created demands."""
    posted_at = posted_at or now_iso()
    raised = await raise_demands(booking, today, posted_at)
    if raised is None:
        return []
    await finish_raise(booking, *raised, posted_at, actor)
    return raised[0]


async def raise_demands(
    booking: dict,
    today: date | None,
    posted_at: str,
    block: dict | None = None,
    company: dict | None = None,
    existing: list[dict] | None = None,
    collect: list | None = None,
):
    """Step 1 (numbers + demand rows, in call order): returns (created, cum, block, possession_hit) or None.
    `block` / `company` / `existing` may be passed pre-read by a caller that raises for many bookings of one tower, and
    with `collect` the rows are handed back unnumbered and uninserted for raise_demands_batch (REQ-211)."""
    if booking.get("status") != "Active" or not booking.get("payment_plan_snapshot"):
        return None
    today = today or clock.today()
    if block is None:
        block = await db.blocks.find_one({"id": booking["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
    if company is None:
        company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0})
    raised, raised_names, cum = await _raised_state(booking, existing)
    created = []
    possession_hit = False
    for ins in sorted(booking["payment_plan_snapshot"]["installments"], key=lambda x: x["seq"]):
        if (
            ins["seq"] in raised or ins["name"].strip().lower() in raised_names
        ):  # belt and braces beyond the unique index
            continue
        td = trigger_date(ins, booking, block)
        if not td or td > today:
            continue
        cash_d, acc_d, cum = next_raise(booking, cum, ins["percent"])
        due_days = days_to_pay(company, ins)
        d = {
            "id": new_id(),
            "company_id": booking["company_id"],
            "booking_id": booking["id"],
            "customer_id": booking["customer_id"],
            "project_id": booking["project_id"],
            "block_id": booking["block_id"],
            "flat_id": booking["flat_id"],
            "demand_number": None if collect is not None else await generate_number("demand", company, td),
            "installment_seq": ins["seq"],
            "installment_name": ins["name"],
            "trigger": trigger_label(ins),
            "trigger_type": ins["trigger_type"],
            "percent": ins["percent"],
            "trigger_stage_id": ins.get("trigger_stage_id")
            or ((_possession_stage(block) or {}).get("stage_id") if ins["trigger_type"] == "ON_POSSESSION" else None),
            "milestone_seq": ins["seq"],
            "milestone_name": ins["name"],
            "cumulative_percent": cum,
            "cash_demand_paise": cash_d,
            "account_demand_paise": acc_d,
            "total_demand_paise": cash_d + acc_d,
            "demand_date": td.isoformat(),
            "due_date": (td + timedelta(days=due_days)).isoformat(),
            "status": "Open",
            "paid_paise": 0,
            "voided": False,
            "posted_at": posted_at,
            "created_at": now_iso(),
        }
        if collect is not None:
            collect.append((d, td, created))
        else:
            try:
                await db.demands.insert_one(d)
            except Exception:  # duplicate (booking_id, installment_seq) → someone raised it concurrently
                logging.getLogger(__name__).debug("handled error", exc_info=True)
                continue
        d.pop("_id", None)
        created.append(d)
        raised.add(ins["seq"])
        if ins["trigger_type"] == "ON_POSSESSION":
            possession_hit = True
    return created, cum, block, possession_hit


async def raise_demands_batch(bookings: list[dict], posted_at: str, block: dict, company: dict) -> list:
    """raise_demands for many bookings of one tower with the same rows and numbers as calling it booking by booking:
    one read of what is raised, one counter write per FY (numbers handed out in the same order), one insert."""
    existing = {}
    async for d in db.demands.find(
        {"booking_id": {"$in": [b["id"] for b in bookings]}, "voided": {"$ne": True}}, _RAISED_FIELDS
    ):
        existing.setdefault(d["booking_id"], []).append(d)
    rows, out = [], []
    for b in bookings:
        out.append((b, await raise_demands(b, None, posted_at, block, company, existing.get(b["id"], []), rows)))
    if not rows:
        return out
    for (d, _, _), num in zip(rows, await generate_numbers("demand", company, [td for _, td, _ in rows])):
        d["demand_number"] = num
    from pymongo.errors import BulkWriteError

    try:
        await db.demands.insert_many([d for d, _, _ in rows], ordered=False)
        failed = set()
    except BulkWriteError as e:  # duplicate (booking_id, installment_seq) → someone raised it concurrently
        failed = {w["index"] for w in e.details.get("writeErrors", [])}
    for i, (d, _, created) in enumerate(rows):
        d.pop("_id", None)
        if i in failed:
            created.remove(d)
    return out


async def finish_raise(
    booking: dict, created: list[dict], cum: float, block: dict, possession_hit: bool, posted_at: str, actor
) -> None:
    """Step 2 (per booking, independent of other bookings): charges, ledger rebuild, demand letters, audit, notices."""
    await _after_raise(booking, created, cum, block, possession_hit, posted_at)
    if created:
        auto_register = importlib.import_module(
            "services.documents"
        ).auto_register  # lazy: documents imports dues_engine.schedule (would be a cycle)
        who_docs = actor or {
            "id": "system",
            "name": "Dues engine",
            "company_id": booking["company_id"],
            "role": "system",
            "project_scope": ["*"],
        }
        from services import after_commit

        for d in created:  # REQ-111: demand letters are best-effort PDFs → after the response, one call per booking
            await after_commit.defer(
                ("demand_docs", booking["id"]),
                lambda ids, bid=booking["id"]: auto_register(bid, ["demand"], who_docs, demand_ids=ids),
                d["id"],
            )
    for d in created:
        who = actor or {"id": "system", "name": "Dues engine", "company_id": booking["company_id"]}
        await write_audit(
            who,
            "demand.create",
            "booking",
            booking["id"],
            after={
                "demand_number": d["demand_number"],
                "milestone": d["installment_name"],
                "trigger": d["trigger"],
                "total_paise": d["total_demand_paise"],
                "due_date": d["due_date"],
                "customer_id": booking["customer_id"],
                "customer_name": booking.get("customer_name"),
            },
            ip=None,
        )
        from services.portal_notify import notify_booking_parties

        await notify_booking_parties(
            booking,
            "demand.raised",
            f"Payment due: {d['installment_name']}",
            f"{d['demand_number']} · ₹{d['total_demand_paise'] / 100:,.0f} · due {d['due_date']}",
            "demand",
            d["id"],
        )


async def run_dues_for_all(today: date | None = None, actor: dict | None = None) -> dict:
    """DAILY_DUES: per-booking isolation — a poisoned booking is recorded as an item error and the run continues (job_runs)."""
    from services import job_runs

    counts = {"bookings_checked": 0, "demands_raised": 0}

    async def one(b):
        counts["bookings_checked"] += 1
        n = len(await raise_due_installments(b, today, actor=actor))
        counts["demands_raised"] += n
        return n

    run = await job_runs.run_isolated(
        "DAILY_DUES",
        db.bookings.find({"status": "Active", "payment_plan_snapshot": {"$ne": None}}, {"_id": 0}).batch_size(200),
        one,
        item_id=lambda b: b.get("booking_number") or b.get("id"),
        result_fn=lambda acc: {**counts, "as_of": (today or clock.today()).isoformat()},
    )
    return {
        **counts,
        "as_of": (today or clock.today()).isoformat(),
        "ran_at": clock.now(None).isoformat(),
        "job_run": {
            "id": run["id"],
            "status": run["status"],
            "failed_items": run["failed_items"],
            "errors": run["errors"],
        },
    }
