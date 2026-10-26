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
    findings += await referential_findings()
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


def _rf(kind: str, detail: str, **ids) -> dict:
    return {"kind": kind, "detail": detail, "booking_id": ids.get("booking_id"), "booking_number": ids.get("booking_number"), "installment_seq": None, "installment_name": None, "demand_number": None, "paid_paise": 0, **{k: v for k, v in ids.items() if k not in ("booking_id", "booking_number")}}


async def referential_findings() -> list[dict]:
    """Orphans, flat↔booking status consistency, per-booking ledger invariants, bucket caps and counters vs max numbers."""
    out: list[dict] = []
    projects = {p["id"] for p in await db.projects.find({}, {"_id": 0, "id": 1}).to_list(None)}
    blocks = {b["id"]: b for b in await db.blocks.find({}, {"_id": 0, "id": 1, "project_id": 1}).to_list(None)}
    flats = {f["id"]: f for f in await db.flats.find({}, {"_id": 0, "id": 1, "block_id": 1, "project_id": 1, "status": 1, "flat_number": 1}).to_list(None)}
    customers = {c["id"] for c in await db.customers.find({}, {"_id": 0, "id": 1}).to_list(None)}
    for b in blocks.values():
        if b["project_id"] not in projects:
            out.append(_rf("orphan_block", f"block {b['id']} → missing project {b['project_id']}", block_id=b["id"]))
    for f in flats.values():
        if f["block_id"] not in blocks:
            out.append(_rf("orphan_flat", f"flat {f['flat_number']} → missing block {f['block_id']}", flat_id=f["id"]))
    bookings = await db.bookings.find({}, {"_id": 0}).to_list(None)
    active_by_flat: dict = {}
    for bk in bookings:
        if bk["flat_id"] not in flats:
            out.append(_rf("orphan_booking_flat", f"booking → missing flat {bk['flat_id']}", booking_id=bk["id"], booking_number=bk["booking_number"]))
        if bk["customer_id"] not in customers:
            out.append(_rf("orphan_booking_customer", f"booking → missing customer {bk['customer_id']}", booking_id=bk["id"], booking_number=bk["booking_number"]))
        if bk["status"] in ("Active", "Completed"):
            active_by_flat.setdefault(bk["flat_id"], []).append(bk)
    for fid, bks in active_by_flat.items():
        if len(bks) > 1:
            out.append(_rf("double_booked_flat", f"flat {flats.get(fid, {}).get('flat_number', fid)} has {len(bks)} live bookings", flat_id=fid))
        f = flats.get(fid)
        if f and f["status"] not in ("Booked", "Sold"):
            out.append(_rf("flat_status_mismatch", f"flat {f['flat_number']} is {f['status']} but has a live booking", flat_id=fid, booking_id=bks[0]["id"], booking_number=bks[0]["booking_number"]))
    for f in flats.values():
        if f["status"] in ("Booked", "Sold") and f["id"] not in active_by_flat:
            out.append(_rf("flat_status_mismatch", f"flat {f['flat_number']} is {f['status']} without a live booking", flat_id=f["id"]))
    booking_ids = {b["id"] for b in bookings}
    async for p in db.payments.find({"booking_id": {"$nin": list(booking_ids)}}, {"_id": 0, "id": 1, "receipt_number": 1}):
        out.append(_rf("orphan_payment", f"payment {p['receipt_number']} → missing booking", payment_id=p["id"]))
    async for d in db.demands.find({"booking_id": {"$nin": list(booking_ids)}}, {"_id": 0, "id": 1, "demand_number": 1}):
        out.append(_rf("orphan_demand", f"demand {d['demand_number']} → missing booking", demand_id=d["id"]))
    # ledger invariants per booking (cleared flat-value payments vs summary, caps, dues = raised − paid)
    for bk in bookings:
        if bk["status"] != "Active":
            continue
        sm = bk.get("summary") or {}
        pays = await db.payments.find({"booking_id": bk["id"], "status": "Cleared", "against": "FLAT_VALUE"}, {"_id": 0, "amount_paise": 1, "payment_category": 1}).to_list(None)
        cash_paid = sum(p["amount_paise"] for p in pays if p.get("payment_category") == "Cash")
        acc_paid = sum(p["amount_paise"] for p in pays if p.get("payment_category") == "Account")
        if cash_paid > bk["cash_agreed_paise"] or acc_paid > bk["account_agreed_paise"]:
            out.append(_rf("bucket_cap_exceeded", f"cash {cash_paid}/{bk['cash_agreed_paise']} account {acc_paid}/{bk['account_agreed_paise']}", booking_id=bk["id"], booking_number=bk["booking_number"]))
        if sm and (sm.get("cash_paid_paise", cash_paid) != cash_paid or sm.get("account_paid_paise", acc_paid) != acc_paid):
            out.append(_rf("summary_paid_mismatch", f"summary cash {sm.get('cash_paid_paise')}≠{cash_paid} / account {sm.get('account_paid_paise')}≠{acc_paid}", booking_id=bk["id"], booking_number=bk["booking_number"]))
        last = await db.ledger_entries.find_one({"booking_id": bk["id"]}, {"_id": 0}, sort=[("seq", -1)])
        if last and sm and last.get("total_due_paise") is not None and sm.get("due_paise") is not None and last["total_due_paise"] != sm["due_paise"]:
            out.append(_rf("ledger_due_mismatch", f"last ledger due {last['total_due_paise']} ≠ summary due {sm['due_paise']}", booking_id=bk["id"], booking_number=bk["booking_number"]))
    # counters vs max numbers (numbering scope "<kind>_number", key = FY)
    for coll, field, kind in (("bookings", "booking_number", "booking"), ("demands", "demand_number", "demand"), ("payments", "receipt_number", "receipt")):
        async for row in db[coll].aggregate([{"$match": {field: {"$type": "string"}}}, {"$group": {"_id": {"$arrayElemAt": [{"$split": [f"${field}", "-" if coll != "payments" else "/"]}, 1]}, "mx": {"$max": {"$toInt": {"$arrayElemAt": [{"$split": [f"${field}", "-" if coll != "payments" else "/"]}, -1]}}}}}]):
            ctr = await db.counters.find_one({"scope": f"{kind}_number", "key": row["_id"]}, {"_id": 0, "seq": 1})
            if ctr is not None and row["mx"] > int(ctr.get("seq") or 0):
                out.append(_rf("counter_behind", f"{field} max {row['mx']} in FY {row['_id']} > counter {ctr.get('seq')}", counter=f"{kind}_number/{row['_id']}"))
    return out
