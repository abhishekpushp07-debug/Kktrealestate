"""Phase G money services: cancellation policy, refunds, transfer re-binding, demand re-proportion, bounce charge, rename fan-out."""
from services import clock
from datetime import date, timedelta

from db import db
from services.definitions import OPEN_DEMAND_STATUSES, deductible_charges_due, deduction_for, refund_payable
from services.ledger import rebuild
from services.money import pct_of, rupees_whole
from services.numbering import generate_number
from utils import ApiError, new_id, now_iso, write_audit

DEFAULT_POLICY = {"deduction_type": "percent", "deduction_value": 10.0, "gst_on_deduction": False, "refund_sla_days": 45}
DEFAULT_BOUNCE = {"enabled": True, "charge_type_id": None, "amount": 500.0}


def compute_deduction(policy: dict, agreement_value_paise: int, received_paise: int = 0) -> int:
    return deduction_for({**DEFAULT_POLICY, **(policy or {})}, agreement_value_paise, received_paise)


def cancellation_preview(booking: dict, policy: dict, deduction_override_paise: int | None = None) -> dict:
    """Formula lines shown in the cancel dialog and stored on the cancellation."""
    s = booking.get("summary") or {}
    received = s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0)
    charges_due = deductible_charges_due(booking.get("other_charges"))  # DEMANDED-and-unpaid penalty lines only (service charges are voided with the booking)
    pol = {**DEFAULT_POLICY, **(policy or {})}
    ded = min(deduction_override_paise, received) if deduction_override_paise is not None else deduction_for(pol, booking["agreement_value_paise"], received)
    refund = refund_payable(s, ded, charges_due)
    base = pol.get("deduction_base") or ("fixed" if pol.get("deduction_type") == "fixed" else "agreement")
    dv = pol.get("deduction_value")
    how = "override" if deduction_override_paise is not None else {"agreement": f"{dv}% of agreement value", "received": f"{dv}% of amount received", "fixed": "fixed"}[base]
    gst = " + 18% GST" if pol.get("gst_on_deduction") and deduction_override_paise is None else ""
    lines = [{"label": "Amount received (cleared receipts incl. other charges)", "amount_paise": received},
             {"label": f"− Deduction ({how}{gst}, capped at received)", "amount_paise": -ded},
             {"label": "− Penalty charges demanded and unpaid (e.g. cheque bounce)", "amount_paise": -charges_due},
             {"label": "= Refund payable" if refund > 0 else "= Refund payable (nil → forfeiture)", "amount_paise": refund}]
    voided = max(s.get("other_charges_due_paise", 0), 0) - charges_due
    if voided > 0:
        lines.append({"label": "Service charges demanded but unpaid (voided with the booking, not deducted)", "amount_paise": voided, "info": True})
    if s.get("other_charges_undemanded_paise"):
        lines.append({"label": "Undemanded other charges (never deducted)", "amount_paise": s["other_charges_undemanded_paise"], "info": True})
    return {"received_paise": received, "deduction_paise": ded, "charges_due_paise": charges_due, "refund_paise": refund, "forfeiture_paise": received - refund, "lines": lines, "policy": {"deduction_base": base, "deduction_value": pol.get("deduction_value"), "gst_on_deduction": bool(pol.get("gst_on_deduction")), "refund_sla_days": pol.get("refund_sla_days")}}


async def create_refund(booking: dict, deduction_paise: int, actor: dict, policy: dict, preview: dict | None = None, pre_summary: dict | None = None) -> dict | None:
    """`preview` = the cancellation maths computed BEFORE demands were closed (the cancellation record); the refund must equal it.
    `pre_summary` = the booking summary before cancellation (bucket receipts drive the refund split)."""
    s = pre_summary or booking.get("summary") or {}
    charges_due = preview["charges_due_paise"] if preview else deductible_charges_due(booking.get("other_charges"))
    amount = preview["refund_paise"] if preview else refund_payable(s, deduction_paise, charges_due)
    company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0})
    if amount <= 0:
        received = s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0)
        if received <= 0:
            return None
        ff = {"id": new_id(), "company_id": booking["company_id"], "refund_number": await generate_number("refund", company, clock.today()), "kind": "forfeiture", "booking_id": booking["id"], "booking_number": booking["booking_number"],
              "customer_id": booking["customer_id"], "customer_name": booking["customer_name"], "project_id": booking["project_id"], "project_code": booking.get("project_code"), "block_id": booking["block_id"], "flat_id": booking["flat_id"],
              "amount_paise": 0, "forfeiture_paise": received, "deduction_paise": deduction_paise, "charges_due_paise": charges_due, "received_paise": received, "status": "Forfeited", "created_at": now_iso(), "created_by": actor["id"], "version": 1}
        await db.refunds.insert_one(ff)
        ff.pop("_id", None)
        await write_audit(actor, "refund.create", "refund", ff["id"], after={k: ff[k] for k in ("refund_number", "booking_id", "booking_number", "forfeiture_paise", "deduction_paise", "status")})
        return ff
    # refund comes out of the buckets it went into: cash first? No — proportionally, but never more than each bucket received.
    cash_part = min(s.get("cash_paid_paise", 0), amount)
    acc_part = min(s.get("account_paid_paise", 0), amount - cash_part)
    oc_part = amount - cash_part - acc_part
    sla = int({**DEFAULT_POLICY, **(policy or {})}.get("refund_sla_days") or 45)
    rf = {"id": new_id(), "company_id": booking["company_id"], "refund_number": await generate_number("refund", company, clock.today()), "kind": "refund", "booking_id": booking["id"], "booking_number": booking["booking_number"],
          "customer_id": booking["customer_id"], "customer_name": booking["customer_name"], "project_id": booking["project_id"], "project_code": booking.get("project_code"), "block_id": booking["block_id"], "flat_id": booking["flat_id"],
          "amount_paise": amount, "split": {"Cash": cash_part, "Account": acc_part, "Other": oc_part}, "deduction_paise": deduction_paise, "charges_due_paise": charges_due, "received_paise": s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0),
          "status": "Pending", "due_by": (clock.today() + timedelta(days=sla)).isoformat(), "created_at": now_iso(), "created_by": actor["id"], "paid_at": None, "paid_date": None, "mode": None, "bank_account_id": None, "reference": None, "approved_by": None, "version": 1}
    await db.refunds.insert_one(rf)
    rf.pop("_id", None)
    await write_audit(actor, "refund.create", "refund", rf["id"], after={k: rf[k] for k in ("refund_number", "booking_id", "booking_number", "amount_paise", "deduction_paise", "status", "due_by")})
    return rf


async def pay_refund(rf: dict, body: dict, actor: dict) -> dict:
    if rf["status"] != "Pending":
        raise ApiError(409, f"Refund is {rf['status']}", "REFUND_NOT_PENDING")
    ts = now_iso()
    if body["mode"] == "CASH" and not rf.get("legacy"):
        from routers.roznamcha import cash_in_hand_on
        avail = await cash_in_hand_on(rf["company_id"], date.fromisoformat(body["paid_date"]), {})
        if rf["amount_paise"] > avail:
            raise ApiError(422, f"Cash in hand on {body['paid_date']} is ₹{avail / 100:,.0f}; refund ₹{rf['amount_paise'] / 100:,.0f} exceeds it — pay by bank (NEFT/RTGS/cheque) instead", "CASH_INSUFFICIENT")
    bank = None
    if body.get("bank_account_id"):
        bank = await db.bank_accounts.find_one({"id": body["bank_account_id"], "is_active": True}, {"_id": 0, "bank_name": 1})
        if not bank:
            raise ApiError(404, "Bank account not found", "NOT_FOUND")
    # one payout per refund; posted as a contra per bucket so each ledger shows where the money came back from
    bucket = "Cash" if rf["split"]["Cash"] >= rf["amount_paise"] else ("Account" if rf["split"]["Account"] >= rf["amount_paise"] else "Mixed")
    upd = {"status": "Paid", "paid_at": ts, "paid_date": body["paid_date"], "mode": body["mode"], "bank_account_id": body.get("bank_account_id"), "bank_name": (bank or {}).get("bank_name"), "reference": body.get("reference"),
           "approved_by": actor["id"], "approved_by_name": actor["name"], "bucket": bucket, "updated_at": ts}
    res = await db.refunds.update_one({"id": rf["id"], "status": "Pending", "version": rf["version"]}, {"$set": upd, "$inc": {"version": 1}})
    if not res.matched_count:
        raise ApiError(409, "Refund changed; reload and retry", "VERSION_CONFLICT")
    if bucket == "Mixed":  # split into per-bucket paid rows for the ledger engine
        await db.refunds.update_one({"id": rf["id"]}, {"$set": {"bucket": "Cash", "amount_paise": rf["split"]["Cash"], "amount_total_paise": rf["amount_paise"]}})
        for b_, amt in (("Account", rf["split"]["Account"]), ("Other", rf["split"]["Other"])):
            if amt > 0:
                child = {**{k: v for k, v in rf.items() if k != "_id"}, **upd, "id": new_id(), "parent_refund_id": rf["id"], "bucket": b_, "amount_paise": amt, "split": {b_: amt}}
                await db.refunds.insert_one(child)
        await db.refunds.delete_many({"_id": None})
    await rebuild(rf["booking_id"])
    out = await db.refunds.find_one({"id": rf["id"]}, {"_id": 0})
    await write_audit(actor, "refund.paid", "refund", rf["id"], before={"status": "Pending"}, after={"status": "Paid", "refund_number": rf["refund_number"], "booking_id": rf["booking_id"], "booking_number": rf["booking_number"], "amount_paise": rf["amount_paise"], "mode": body["mode"], "paid_date": body["paid_date"], "reference": body.get("reference")})
    return out


async def reproportion_open_demands(booking: dict, actor: dict, reason: str, old_agreement_value_paise: int | None = None) -> int:
    """After an agreement re-split/transfer: paid demands are untouched; open demands are re-proportioned from the new agreement and
    telescope so that Σ all raised demands == cumulative raised % × new agreement, per bucket (last open demand absorbs rounding)."""
    demands = sorted(await db.demands.find({"booking_id": booking["id"], "voided": {"$ne": True}}, {"_id": 0}).to_list(None), key=lambda d: (d.get("installment_seq") or 0, d.get("posted_at") or ""))
    open_ = [d for d in demands if d["status"] in OPEN_DEMAND_STATUSES]
    if not open_:
        return 0
    by_seq = {i["seq"]: i["percent"] for i in (booking.get("payment_plan_snapshot") or {}).get("installments") or []}
    old_total = (old_agreement_value_paise or 0) or booking["agreement_value_paise"]

    def pct(d):
        p = by_seq.get(d.get("installment_seq"))
        return p if p is not None else round(d["total_demand_paise"] * 100 / (old_total or 1), 4)
    total_pct = sum(pct(d) for d in demands)
    target_c, target_a = pct_of(booking["cash_agreed_paise"], total_pct), pct_of(booking["account_agreed_paise"], total_pct)
    fixed = [d for d in demands if d["status"] not in OPEN_DEMAND_STATUSES]
    rem_c = target_c - sum(d["cash_demand_paise"] for d in fixed)
    rem_a = target_a - sum(d["account_demand_paise"] for d in fixed)
    open_pct = sum(pct(d) for d in open_) or 1
    changed, acc_c, acc_a = 0, 0, 0
    for i, d in enumerate(open_):
        last = i == len(open_) - 1
        c = rem_c - acc_c if last else rupees_whole(rem_c * pct(d) / open_pct)
        a = rem_a - acc_a if last else rupees_whole(rem_a * pct(d) / open_pct)
        c, a = max(c, d.get("cash_paid_paise", 0) or 0), max(a, d.get("account_paid_paise", 0) or 0)
        acc_c, acc_a = acc_c + c, acc_a + a
        if (c, a) != (d["cash_demand_paise"], d["account_demand_paise"]):
            await db.demands.update_one({"id": d["id"]}, {"$set": {"cash_demand_paise": c, "account_demand_paise": a, "total_demand_paise": c + a, "reproportioned_at": now_iso(), "reproportion_reason": reason}})
            changed += 1
    if changed:
        await write_audit(actor, "demand.reproportion", "booking", booking["id"], after={"booking_number": booking["booking_number"], "demands": changed, "cash_agreed_paise": booking["cash_agreed_paise"], "account_agreed_paise": booking["account_agreed_paise"], "target_raised_paise": target_c + target_a, "reason": reason})
    return changed


async def rebind_demands_to_block(booking: dict, new_block: dict, actor: dict) -> dict:
    """Open demands follow the new tower's stage sequence by stage *code*; stages already completed in the new tower make the demand due now."""
    by_code = {s.get("code"): s for s in new_block.get("construction_stages") or [] if s.get("code")}
    by_name = {s.get("name"): s for s in new_block.get("construction_stages") or []}
    old_block = await db.blocks.find_one({"id": booking["block_id"]}, {"_id": 0, "construction_stages": 1})
    old_stages = {s["stage_id"]: s for s in (old_block or {}).get("construction_stages") or []}
    company = await db.companies.find_one({"id": booking["company_id"]}, {"_id": 0, "demand_due_days": 1})
    rebound, due_now = 0, 0
    today = clock.today()
    for d in await db.demands.find({"booking_id": booking["id"], "voided": {"$ne": True}, "trigger_stage_id": {"$ne": None}}, {"_id": 0}).to_list(None):
        old = old_stages.get(d.get("trigger_stage_id")) or {}
        tgt = by_code.get(old.get("code")) or by_name.get(old.get("name"))
        if not tgt:
            continue
        upd = {"trigger_stage_id": tgt["stage_id"], "block_id": new_block["id"], "rebound_at": now_iso()}
        if d.get("status") in OPEN_DEMAND_STATUSES and tgt.get("status") == "Completed" and d.get("due_date", "9999") > today.isoformat():
            upd.update({"demand_date": today.isoformat(), "due_date": (today + timedelta(days=int((company or {}).get("demand_due_days") or 15))).isoformat(), "due_now_reason": "Stage already completed in new tower"})
            due_now += 1
        await db.demands.update_one({"id": d["id"]}, {"$set": upd})
        rebound += 1
    await db.demands.update_many({"booking_id": booking["id"]}, {"$set": {"block_id": new_block["id"]}})
    await db.payments.update_many({"booking_id": booking["id"]}, {"$set": {"block_id": new_block["id"], "block_code": new_block["code"]}})
    if rebound:
        await write_audit(actor, "demand.rebind", "booking", booking["id"], after={"booking_number": booking["booking_number"], "rebound": rebound, "due_now": due_now, "to_block": new_block["code"]})
    return {"rebound": rebound, "due_now": due_now}


async def raise_bounce_charge(payment: dict, actor: dict) -> dict | None:
    booking = await db.bookings.find_one({"id": payment["booking_id"]}, {"_id": 0})
    project = await db.projects.find_one({"id": booking["project_id"]}, {"_id": 0, "bounce_policy": 1})
    pol = {**DEFAULT_BOUNCE, **((project or {}).get("bounce_policy") or {})}
    if not pol.get("enabled") or booking["status"] != "Active":
        return None
    ct = await db.charge_types.find_one({"id": pol.get("charge_type_id")}, {"_id": 0}) if pol.get("charge_type_id") else await db.charge_types.find_one({"code": {"$in": ["BOUNCE", "CHQ_BOUNCE"]}}, {"_id": 0})
    if not ct:
        ct = {"id": "bounce-charge", "name": "Cheque bounce charge", "code": "BOUNCE", "is_taxable": False}
        await db.charge_types.update_one({"id": ct["id"]}, {"$setOnInsert": {**ct, "default_amount": pol["amount"], "is_active": True, "sort_order": 99}}, upsert=True)
    amt = rupees_whole(float(pol["amount"]) * 100)
    ts = now_iso()
    line = {"line_id": new_id(), "charge_type_id": ct["id"], "name": f"{ct['name']} ({payment.get('receipt_number')})", "code": ct.get("code"), "amount_paise": amt, "gst_percent": 0, "gst_paise": 0, "total_paise": amt,
            "demand_at": "on_bounce", "demanded_paise": amt, "paid_paise": 0, "demanded_at": ts, "source_payment_id": payment["id"]}
    await db.bookings.update_one({"id": booking["id"]}, {"$push": {"other_charges": line}, "$set": {"updated_at": ts}, "$inc": {"version": 1}})
    await rebuild(booking["id"])
    await write_audit(actor, "booking.other_charge_demand", "booking", booking["id"], after={"line": line["name"], "amount_paise": amt, "booking_number": booking["booking_number"], "source": "bounce"})
    return line


async def fan_out_customer(customer: dict, actor: dict) -> dict:
    """Rename / phone change propagates to denormalised copies. Receipts keep `customer_name` as printed; `customer_name_current` is added."""
    cid = customer["id"]
    name, phone = customer["full_name"], customer.get("phone")
    ts = now_iso()
    b = await db.bookings.update_many({"customer_id": cid}, {"$set": {"customer_name": name, "customer_phone": phone, "updated_at": ts}})
    p = await db.payments.update_many({"customer_id": cid}, {"$set": {"customer_name_current": name}})
    d = await db.demands.update_many({"customer_id": cid}, {"$set": {"customer_name": name}})
    s = await db.service_requests.update_many({"customer_id": cid}, {"$set": {"customer_name": name}})
    r = await db.refunds.update_many({"customer_id": cid}, {"$set": {"customer_name": name}})
    return {"bookings": b.modified_count, "payments": p.modified_count, "demands": d.modified_count, "service_requests": s.modified_count, "refunds": r.modified_count}
