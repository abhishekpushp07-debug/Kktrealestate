"""Auto-dues engine (Phase 7): raise installment demands from the booking's payment-plan snapshot. Idempotent."""
from services import clock
from datetime import date, datetime, timedelta

from db import db
from services.ledger import raise_other_charges, rebuild
from services.money import pct_of
from services.numbering import generate_number
from utils import new_id, now_iso, write_audit

TRIGGER_LABEL = {"ON_BOOKING": "On booking", "DAYS_AFTER_BOOKING": "{d} days after booking", "ON_STAGE": "On stage: {s}", "ON_POSSESSION": "On possession", "ON_DATE": "On {dt}"}


def trigger_label(ins: dict) -> str:
    t = ins["trigger_type"]
    return TRIGGER_LABEL[t].format(d=ins.get("trigger_days"), s=ins.get("trigger_stage_name") or "stage", dt=ins.get("trigger_date"))


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


def schedule(booking: dict, block: dict, demands: list[dict]) -> list[dict]:
    """Installment schedule with status for UI/portal. Amounts are the planned amounts; raised ones use the demand."""
    snap = booking.get("payment_plan_snapshot") or {}
    ins_list = sorted(snap.get("installments") or [], key=lambda x: x["seq"])
    by_seq = {d.get("installment_seq"): d for d in demands if not d.get("voided")}
    rows, cum = [], 0.0
    today = clock.today().isoformat()
    for ins in ins_list:
        cum = round(cum + ins["percent"], 2)
        c_exp, a_exp = pct_of(booking["cash_agreed_paise"], ins["percent"]), pct_of(booking["account_agreed_paise"], ins["percent"])
        d = by_seq.get(ins["seq"])
        exp = expected_date(ins, booking, block)
        if d:
            c_exp, a_exp = d["cash_demand_paise"], d["account_demand_paise"]
            paid = d.get("paid_paise", 0)
            status = "Paid" if paid >= d["total_demand_paise"] and d["total_demand_paise"] else "Partially paid" if paid else ("Overdue" if d["due_date"] < today else "Raised")
        else:
            paid, status = 0, "Not yet due"
        rows.append({"seq": ins["seq"], "name": ins["name"], "percent": ins["percent"], "cumulative_percent": cum, "trigger_type": ins["trigger_type"], "trigger_label": trigger_label(ins),
                     "cash_expected_paise": c_exp, "account_expected_paise": a_exp, "total_expected_paise": c_exp + a_exp, "cash_paid_paise": min(paid, c_exp) if d else 0, "account_paid_paise": max(paid - c_exp, 0) if d else 0, "paid_paise": paid,
                     "status": status, "expected_date": exp, "raised_on": d["demand_date"] if d else None, "due_date": d["due_date"] if d else ((date.fromisoformat(exp) + timedelta(days=int(ins.get("due_days") or 15))).isoformat() if exp else None), "demand_id": d["id"] if d else None, "demand_number": d["demand_number"] if d else None})
    return rows


async def raise_due_installments(booking: dict, today: date | None = None, posted_at: str | None = None, actor: dict | None = None) -> list[dict]:
    """Evaluate every installment; raise exactly one demand per newly-triggered installment. Returns created demands."""
    if booking.get("status") != "Active" or not booking.get("payment_plan_snapshot"):
        return []
    today = today or clock.today()
    posted_at = posted_at or now_iso()
    block = await db.blocks.find_one({"id": booking["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
    company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0})
    existing = await db.demands.find({"booking_id": booking["id"], "voided": {"$ne": True}}, {"_id": 0, "installment_seq": 1, "installment_name": 1, "milestone_name": 1, "percent": 1, "cumulative_percent": 1, "absorbed_installment_seqs": 1}).to_list(None)
    raised = {d.get("installment_seq") for d in existing} | {s for d in existing for s in d.get("absorbed_installment_seqs") or []}
    raised_names = {(d.get("installment_name") or d.get("milestone_name") or "").strip().lower() for d in existing}
    cum = round(sum(d.get("percent") or 0 for d in existing), 2) if existing else 0.0
    if existing and any(d.get("percent") is None for d in existing):
        cum = max(d.get("cumulative_percent") or 0 for d in existing)
    created = []
    possession_hit = False
    for ins in sorted(booking["payment_plan_snapshot"]["installments"], key=lambda x: x["seq"]):
        if ins["seq"] in raised or ins["name"].strip().lower() in raised_names:  # belt and braces beyond the unique index
            continue
        td = trigger_date(ins, booking, block)
        if not td or td > today:
            continue
        before_c, before_a = pct_of(booking["cash_agreed_paise"], cum), pct_of(booking["account_agreed_paise"], cum)
        cum = round(cum + ins["percent"], 2)
        if cum >= 99.995:
            cum = 100.0
        c_new, a_new = pct_of(booking["cash_agreed_paise"], cum), pct_of(booking["account_agreed_paise"], cum)
        cash_d, acc_d = c_new - before_c, a_new - before_a
        due_days = int(ins.get("due_days") or company.get("demand_due_days") or 15)
        d = {"id": new_id(), "company_id": booking["company_id"], "booking_id": booking["id"], "customer_id": booking["customer_id"], "project_id": booking["project_id"], "block_id": booking["block_id"], "flat_id": booking["flat_id"],
             "demand_number": await generate_number("demand", company, td), "installment_seq": ins["seq"], "installment_name": ins["name"], "trigger": trigger_label(ins), "trigger_type": ins["trigger_type"], "percent": ins["percent"],
             "trigger_stage_id": ins.get("trigger_stage_id") or ((_possession_stage(block) or {}).get("stage_id") if ins["trigger_type"] == "ON_POSSESSION" else None), "milestone_seq": ins["seq"], "milestone_name": ins["name"], "cumulative_percent": cum, "cash_demand_paise": cash_d, "account_demand_paise": acc_d, "total_demand_paise": cash_d + acc_d,
             "demand_date": td.isoformat(), "due_date": (td + timedelta(days=due_days)).isoformat(), "status": "Open", "paid_paise": 0, "voided": False, "posted_at": posted_at, "created_at": now_iso()}
        try:
            await db.demands.insert_one(d)
        except Exception:  # duplicate (booking_id, installment_seq) → someone raised it concurrently
            continue
        d.pop("_id", None)
        created.append(d)
        raised.add(ins["seq"])
        if ins["trigger_type"] == "ON_POSSESSION":
            possession_hit = True
    if created or booking.get("raised_percent") != cum:
        upd = {"raised_percent": cum, "construction_percent": cum, "updated_at": now_iso()}
        if possession_hit or (_possession_stage(block) or {}).get("status") == "Completed":
            lines = raise_other_charges(booking, "on_possession", posted_at)
            if lines:
                upd["other_charges"] = lines
        await db.bookings.update_one({"id": booking["id"]}, {"$set": upd})
        await rebuild(booking["id"])
    for d in created:
        who = actor or {"id": "system", "name": "Dues engine", "company_id": booking["company_id"]}
        await write_audit(who, "demand.create", "booking", booking["id"], after={"demand_number": d["demand_number"], "milestone": d["installment_name"], "trigger": d["trigger"], "total_paise": d["total_demand_paise"], "due_date": d["due_date"], "customer_id": booking["customer_id"], "customer_name": booking.get("customer_name")}, ip=None)
        from services.portal_notify import notify_booking_parties
        await notify_booking_parties(booking, "demand.raised", f"Payment due: {d['installment_name']}", f"{d['demand_number']} · ₹{d['total_demand_paise'] / 100:,.0f} · due {d['due_date']}", "demand", d["id"])
    return created


async def run_dues_for_all(today: date | None = None, actor: dict | None = None) -> dict:
    """DAILY_DUES: per-booking isolation — a poisoned booking is recorded as an item error and the run continues (job_runs)."""
    from services import job_runs
    counts = {"bookings_checked": 0, "demands_raised": 0}

    async def one(b):
        counts["bookings_checked"] += 1
        n = len(await raise_due_installments(b, today, actor=actor))
        counts["demands_raised"] += n
        return n
    run = await job_runs.run_isolated("DAILY_DUES", db.bookings.find({"status": "Active", "payment_plan_snapshot": {"$ne": None}}, {"_id": 0}).batch_size(200), one, item_id=lambda b: b.get("booking_number") or b.get("id"),
                                      result_fn=lambda acc: {**counts, "as_of": (today or clock.today()).isoformat()})
    return {**counts, "as_of": (today or clock.today()).isoformat(), "ran_at": clock.now(None).isoformat(), "job_run": {"id": run["id"], "status": run["status"], "failed_items": run["failed_items"], "errors": run["errors"]}}
