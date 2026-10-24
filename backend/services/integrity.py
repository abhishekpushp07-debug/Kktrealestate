"""Phase 7 integrity check: installment demands vs. plan triggers (stage state / time) per booking, plus repair."""
import logging
from datetime import date

from db import db
from services.dues_engine import raise_due_installments, trigger_date
from services.ledger import rebuild
from utils import now_iso

logger = logging.getLogger("kkt.integrity")


async def backfill_demand_installments() -> int:
    """Map legacy / unmapped demands to their plan installment by name (fallback: milestone seq). Idempotent; safe every startup."""
    n = 0
    async for bk in db.bookings.find({"payment_plan_snapshot": {"$ne": None}}, {"_id": 0, "id": 1, "payment_plan_snapshot": 1}):
        ins_list = bk["payment_plan_snapshot"]["installments"]
        by_name = {i["name"].strip().lower(): i for i in ins_list}
        by_seq = {i["seq"]: i for i in ins_list}
        q = {"booking_id": bk["id"], "trigger_type": {"$ne": "CATCH_UP"}, "$or": [{"installment_seq": {"$exists": False}}, {"installment_seq": None}, {"trigger_stage_id": {"$exists": False}}, {"trigger_stage_id": None, "trigger_type": {"$in": ["ON_STAGE", "ON_POSSESSION"]}}]}
        async for d in db.demands.find(q, {"_id": 0, "id": 1, "installment_seq": 1, "installment_name": 1, "milestone_seq": 1, "milestone_name": 1}):
            name = (d.get("installment_name") or d.get("milestone_name") or "").strip().lower()
            ins = by_seq.get(d.get("installment_seq")) if d.get("installment_seq") is not None else (by_name.get(name) or by_seq.get(d.get("milestone_seq")))
            if not ins or (d.get("installment_seq") is None and ins["name"].strip().lower() != name and name):
                continue
            await db.demands.update_one({"id": d["id"]}, {"$set": {"installment_seq": ins["seq"], "installment_name": ins["name"], "trigger_type": ins["trigger_type"], "trigger_stage_id": ins.get("trigger_stage_id"), "percent": ins["percent"]}})
            n += 1
    if n:
        logger.info("[phase7] backfilled %s demand(s) with installment mapping", n)
    return n


async def integrity_report(today: date | None = None) -> dict:
    today = today or date.today()
    findings, bookings_checked = [], 0
    async for bk in db.bookings.find({"status": "Active", "payment_plan_snapshot": {"$ne": None}}, {"_id": 0}):
        bookings_checked += 1
        block = await db.blocks.find_one({"id": bk["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
        demands = await db.demands.find({"booking_id": bk["id"], "voided": {"$ne": True}}, {"_id": 0}).to_list(None)
        absorbed = {s for d in demands for s in d.get("absorbed_installment_seqs") or []}
        catch_up = [d for d in demands if d.get("trigger_type") == "CATCH_UP"]
        absorbed |= {d.get("installment_seq") for d in catch_up}
        by_seq: dict = {}
        for d in demands:
            if d.get("trigger_type") == "CATCH_UP":
                continue
            if d.get("installment_seq") is None:
                findings.append(_f(bk, "unmapped_demand", d, "Demand has no installment mapping"))
                continue
            by_seq.setdefault(d["installment_seq"], []).append(d)
        for ins in sorted(bk["payment_plan_snapshot"]["installments"], key=lambda x: x["seq"]):
            td = trigger_date(ins, bk, block)
            satisfied = bool(td and td <= today)
            ds = by_seq.get(ins["seq"], [])
            if len(ds) > 1:
                for d in sorted(ds, key=lambda x: x.get("created_at") or "")[1:]:
                    findings.append(_f(bk, "duplicate_demand", d, f"Installment {ins['seq']} '{ins['name']}' raised {len(ds)} times"))
            if ds and not satisfied and ins["seq"] not in absorbed:
                findings.append(_f(bk, "unsatisfied_trigger", ds[0], f"'{ins['name']}' raised but trigger not met ({ins['trigger_type']})"))
            if not ds and satisfied and ins["seq"] not in absorbed:
                findings.append({"booking_id": bk["id"], "booking_number": bk["booking_number"], "kind": "missing_demand", "installment_seq": ins["seq"], "installment_name": ins["name"], "detail": f"'{ins['name']}' triggered on {td.isoformat()} but not raised", "demand_number": None, "paid_paise": 0})
        raised_sum = sum(d["total_demand_paise"] for d in demands)
        sm = bk.get("summary") or {}
        if sm.get("total_order_raised_paise", 0) != raised_sum:
            findings.append({"booking_id": bk["id"], "booking_number": bk["booking_number"], "kind": "summary_mismatch", "installment_seq": None, "installment_name": None, "demand_number": None, "paid_paise": 0, "detail": f"summary raised {sm.get('total_order_raised_paise', 0)} ≠ demands {raised_sum}"})
    counts: dict = {}
    for f in findings:
        counts[f["kind"]] = counts.get(f["kind"], 0) + 1
    return {"ok": not findings, "as_of": today.isoformat(), "ran_at": now_iso(), "bookings_checked": bookings_checked, "counts": counts, "findings": findings}


def _f(bk: dict, kind: str, d: dict, detail: str) -> dict:
    return {"booking_id": bk["id"], "booking_number": bk["booking_number"], "kind": kind, "installment_seq": d.get("installment_seq"), "installment_name": d.get("installment_name") or d.get("milestone_name"), "demand_number": d.get("demand_number"), "demand_id": d["id"], "paid_paise": d.get("paid_paise", 0), "detail": detail}


async def repair(actor: dict | None = None) -> dict:
    """Void unsatisfied/duplicate demands that have no payment applied, raise missing ones, rebuild ledgers. Returns before/after reports."""
    before = await integrity_report()
    ts, voided, skipped, touched = now_iso(), [], [], set()
    for f in before["findings"]:
        if f["kind"] in ("unsatisfied_trigger", "duplicate_demand"):
            d = await db.demands.find_one({"id": f["demand_id"]}, {"_id": 0, "demand_date": 1, "booking_id": 1})
            # same rule as stage undo: a payment dated on/after the demand blocks; earlier advances auto-applied FIFO do not
            if f["paid_paise"] > 0 and d and await db.payments.count_documents({"booking_id": d["booking_id"], "status": {"$nin": ["Reversed", "Bounced", "Cancelled"]}, "payment_date": {"$gte": d["demand_date"]}}):
                skipped.append({**f, "reason": "payment received after demand"})
                continue
            await db.demands.update_one({"id": f["demand_id"], "voided": {"$ne": True}}, {"$set": {"voided": True, "voided_at": ts, "voided_by": (actor or {}).get("id", "system"), "status": "Voided", "void_reason": f"Integrity repair: {f['detail']}"}})
            voided.append(f["demand_number"])
            from services.portal_notify import retract_for_demands
            await retract_for_demands([{"id": f["demand_id"], "demand_number": f["demand_number"]}])
        touched.add(f["booking_id"])
    raised = 0
    for bid in touched:
        bk = await db.bookings.find_one({"id": bid}, {"_id": 0})
        if bk:
            raised += len(await raise_due_installments(bk, posted_at=ts, actor=actor))
            await rebuild(bid)
    after = await integrity_report()
    return {"voided": voided, "raised": raised, "skipped": skipped, "before": before["counts"], "after": after["counts"], "ok": after["ok"]}
