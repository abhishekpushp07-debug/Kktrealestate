"""Phase 7 migration + seed: milestone templates → construction stages + payment plans; bookings → plan snapshots. Idempotent, logged."""
import logging

from db import db
from services.ledger import rebuild
from utils import new_id, now_iso

logger = logging.getLogger("kkt.migrate7")
STAGES = ["Excavation", "Foundation", "Plinth", "1st Slab", "2nd Slab", "3rd Slab", "4th Slab", "Top Slab", "Brickwork", "Plastering", "Flooring", "Finishing", "External Works", "Possession/Handover"]
ALIASES = {"booking": None, "plinth": "Plinth", "foundation": "Foundation", "excavation": "Excavation", "1st slab": "1st Slab", "first slab": "1st Slab", "2nd slab": "2nd Slab", "second slab": "2nd Slab", "3rd slab": "3rd Slab", "third slab": "3rd Slab", "4th slab": "4th Slab", "top slab": "Top Slab", "roof slab": "Top Slab",
           "brickwork": "Brickwork", "brick work": "Brickwork", "plaster": "Plastering", "plastering": "Plastering", "flooring": "Flooring", "finishing": "Finishing", "possession": "Possession/Handover", "handover": "Possession/Handover", "external": "External Works"}


def _code(name: str) -> str:
    return "".join(ch for ch in name.upper().replace(" ", "_").replace("/", "_") if ch.isalnum() or ch == "_")[:30]


def _match_stage(ms_name: str) -> str | None:
    n = ms_name.lower()
    for k, v in ALIASES.items():
        if k in n:
            return v
    return ms_name.strip()


async def _snapshot_totals(booking_id: str) -> dict:
    rows = await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0, "amount_paise": 1, "total_due_paise": 1, "other_charges_due_paise": 1}).sort("seq", 1).to_list(None)
    return {"rows": len(rows), "final_due": rows[-1]["total_due_paise"] if rows else 0, "final_oc_due": rows[-1]["other_charges_due_paise"] if rows else 0, "sum_amount": sum(r["amount_paise"] for r in rows)}


async def migrate_phase7() -> dict:
    if await db.settings.find_one({"key": "migration_phase7_done"}):
        return {}
    company = await db.companies.find_one({}, {"_id": 0})
    if not company:
        return {}
    cid = company["id"]
    logger.info("Phase 7 migration starting")
    report = {"started_at": now_iso(), "bookings_checked": 0, "bookings_changed": [], "plans_created": [], "stages_created": 0}
    # 1. stage master
    stage_by_name = {s["name"]: s for s in await db.construction_stages.find({}, {"_id": 0}).to_list(None)}
    for i, name in enumerate(STAGES):
        if name not in stage_by_name:
            doc = {"id": new_id(), "company_id": cid, "name": name, "code": _code(name), "description": None, "seq_hint": (i + 1) * 10, "is_possession": name == "Possession/Handover", "applies_to_block_types": [], "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "created_by": "system"}
            await db.construction_stages.insert_one(doc)
            stage_by_name[name] = doc
            report["stages_created"] += 1
    # 2. templates → stage sequences + CLP plans
    templates = await db.milestone_templates.find({}, {"_id": 0}).to_list(None)
    plan_by_template = {}
    for t in templates:
        seq_entries, installments, prev = [], [], 0.0
        for m in sorted(t["milestones"], key=lambda x: x["seq"]):
            pct = round(m["cumulative_percent"] - prev, 2)
            prev = m["cumulative_percent"]
            sname = _match_stage(m["name"])
            if sname is None:  # Booking
                installments.append({"seq": m["seq"], "name": m["name"], "percent": pct, "trigger_type": "ON_BOOKING", "trigger_days": None, "trigger_stage_id": None, "trigger_date": None, "due_days": None, "notes": None})
                continue
            if sname not in stage_by_name:
                doc = {"id": new_id(), "company_id": cid, "name": sname, "code": _code(sname), "description": "Created from milestone template", "seq_hint": 500 + m["seq"], "is_possession": False, "applies_to_block_types": [], "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "created_by": "system"}
                await db.construction_stages.insert_one(doc)
                stage_by_name[sname] = doc
                report["stages_created"] += 1
            st = stage_by_name[sname]
            seq_entries.append({"stage_id": st["id"], "seq": len(seq_entries) + 1})
            installments.append({"seq": m["seq"], "name": m["name"], "percent": pct, "trigger_type": "ON_POSSESSION" if st.get("is_possession") else "ON_STAGE", "trigger_days": None, "trigger_stage_id": st["id"], "trigger_date": None, "due_days": None, "notes": None})
        diff = round(100 - sum(i["percent"] for i in installments), 2)
        if diff:
            installments[-1]["percent"] = round(installments[-1]["percent"] + diff, 2)
        pname = t["name"] if t["name"].upper().endswith("CLP") else f"{t['name']} (CLP)"
        plan = await db.payment_plans.find_one({"name": {"$in": [pname, f"{t['name']} (CLP)"]}}, {"_id": 0})
        if not plan:
            plan = {"id": new_id(), "company_id": cid, "name": pname, "code": _code(t["name"])[:20] + ("" if t["name"].upper().endswith("CLP") else "_CLP"), "description": f"Converted from milestone template '{t['name']}'", "plan_type": "CLP", "installments": installments, "applies_percent_to": "BOTH_BUCKETS", "grace_days": 0, "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "created_by": "system", "legacy_template_id": t["id"]}
            await db.payment_plans.insert_one(plan)
            report["plans_created"].append(pname)
        plan_by_template[t["id"]] = (plan, seq_entries)
    # 3. projects/blocks: sequences, stage records, assignments
    async for p in db.projects.find({"company_id": cid}, {"_id": 0}):
        tp = plan_by_template.get(p.get("milestone_template_id"))
        if tp and not p.get("construction_stage_sequence"):
            await db.projects.update_one({"id": p["id"]}, {"$set": {"construction_stage_sequence": tp[1]}})
        if tp:
            await db.payment_plan_assignments.update_one({"payment_plan_id": tp[0]["id"], "project_id": p["id"], "block_id": None}, {"$setOnInsert": {"id": new_id(), "company_id": cid, "payment_plan_id": tp[0]["id"], "project_id": p["id"], "block_id": None, "is_default": True, "effective_from": None, "effective_to": None, "is_active": True, "plan_name": tp[0]["name"], "plan_code": tp[0]["code"], "project_name": p["name"], "block_name": None, "created_at": now_iso(), "created_by": "system"}}, upsert=True)
    async for b in db.blocks.find({"company_id": cid}, {"_id": 0}):
        p = await db.projects.find_one({"id": b["project_id"]}, {"_id": 0, "milestone_template_id": 1})
        tid = b.get("milestone_template_id") or (p or {}).get("milestone_template_id")
        tp = plan_by_template.get(tid)
        if tp and b.get("milestone_template_id") and tid != (p or {}).get("milestone_template_id"):
            await db.blocks.update_one({"id": b["id"]}, {"$set": {"construction_stage_sequence": tp[1]}})
            await db.payment_plan_assignments.update_one({"payment_plan_id": tp[0]["id"], "project_id": b["project_id"], "block_id": b["id"]}, {"$setOnInsert": {"id": new_id(), "company_id": cid, "payment_plan_id": tp[0]["id"], "project_id": b["project_id"], "block_id": b["id"], "is_default": True, "effective_from": None, "effective_to": None, "is_active": True, "plan_name": tp[0]["name"], "plan_code": tp[0]["code"], "project_name": b.get("project_name"), "block_name": b["name"], "created_at": now_iso(), "created_by": "system"}}, upsert=True)
        if not b.get("construction_stages"):
            from routers.construction import legacy_milestones, stage_sequence_for_block
            seq = await stage_sequence_for_block({**b, "construction_stage_sequence": b.get("construction_stage_sequence") or (tp[1] if tp else None)})
            old = {_match_stage(m["name"]): m for m in b.get("milestones") or [] if m.get("status") == "Completed"}
            stages = []
            for s in seq:
                m = old.get(s["name"])
                stages.append({**s, "status": "Completed" if m else "Pending", "started_on": None, "completed_on": (m or {}).get("completed_on"), "completed_at": (m or {}).get("completed_at"), "completed_by": (m or {}).get("completed_by"), "notes": (m or {}).get("notes"), "progress_note": (m or {}).get("progress_note"), "visible_to_customers": True})
            # photos were keyed by old milestone seq → re-key to the stage seq
            for m in b.get("milestones") or []:
                s = next((x for x in stages if x["name"] == _match_stage(m["name"])), None)
                if s and s["seq"] != m["seq"]:
                    await db.construction_photos.update_many({"block_id": b["id"], "milestone_seq": m["seq"], "rekeyed": {"$ne": True}}, {"$set": {"milestone_seq": s["seq"], "stage_id": s["stage_id"], "rekeyed": True}})
            await db.blocks.update_one({"id": b["id"]}, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages), "construction_percent": round(sum(1 for s in stages if s["status"] == "Completed") * 100 / len(stages)) if stages else 0}})
    # 4. bookings: snapshot + map demands; verify ledger unchanged
    from routers.construction import build_snapshot
    async for bk in db.bookings.find({"company_id": cid}, {"_id": 0}):
        report["bookings_checked"] += 1
        before = await _snapshot_totals(bk["id"])
        tid = None
        blk = await db.blocks.find_one({"id": bk["block_id"]}, {"_id": 0, "milestone_template_id": 1, "project_id": 1})
        if blk:
            tid = blk.get("milestone_template_id") or ((await db.projects.find_one({"id": blk["project_id"]}, {"_id": 0, "milestone_template_id": 1})) or {}).get("milestone_template_id")
        tp = plan_by_template.get(tid)
        if tp and not bk.get("payment_plan_snapshot"):
            snap = await build_snapshot(tp[0])
            ins_by_seq = {i["seq"]: i for i in snap["installments"]}
            ins_by_name = {i["name"].strip().lower(): i for i in snap["installments"]}
            async for d in db.demands.find({"booking_id": bk["id"]}, {"_id": 0, "id": 1, "milestone_seq": 1, "milestone_name": 1, "cumulative_percent": 1}):
                ins = ins_by_name.get((d.get("milestone_name") or "").strip().lower()) or ins_by_seq.get(d.get("milestone_seq"))
                if ins:
                    await db.demands.update_one({"id": d["id"]}, {"$set": {"installment_seq": ins["seq"], "installment_name": ins["name"], "trigger_type": ins["trigger_type"], "trigger_stage_id": ins.get("trigger_stage_id"), "trigger": "On booking" if ins["trigger_type"] == "ON_BOOKING" else f"On stage: {ins.get('trigger_stage_name') or ins['name']}", "percent": ins["percent"]}})
                else:  # catch-up demand at booking (cumulative) → treat as covering installments up to that %
                    covered = [i for i in snap["installments"] if sum(x["percent"] for x in snap["installments"] if x["seq"] <= i["seq"]) <= (d.get("cumulative_percent") or 0) + 0.001]
                    await db.demands.update_one({"id": d["id"]}, {"$set": {"installment_seq": covered[-1]["seq"] if covered else 0, "installment_name": d.get("milestone_name"), "trigger_type": "CATCH_UP", "trigger": "Catch-up on booking", "percent": None}})
                    for i in covered[:-1]:  # mark the earlier installments as absorbed so the engine never raises them again
                        await db.demands.update_one({"id": d["id"]}, {"$addToSet": {"absorbed_installment_seqs": i["seq"]}})
            await db.bookings.update_one({"id": bk["id"]}, {"$set": {"payment_plan_id": tp[0]["id"], "payment_plan_snapshot": snap, "plan_acceptance": {"accepted_on": bk["booking_date"], "accepted_by_user_id": bk.get("created_by"), "mode": "Migrated"}, "raised_percent": bk.get("construction_percent", 0)}})
        # no plan for this block's template: keep legacy demand rows addressable by seq so the engine/reports never see unmapped demands
        await db.demands.update_many({"booking_id": bk["id"], "installment_seq": {"$exists": False}},
                                     [{"$set": {"installment_seq": {"$ifNull": ["$milestone_seq", 0]}, "installment_name": {"$ifNull": ["$milestone_name", "Legacy"]}, "trigger_type": "LEGACY"}}])
        await rebuild(bk["id"])
        after = await _snapshot_totals(bk["id"])
        if before != after:
            report["bookings_changed"].append({"booking": bk["booking_number"], "before": before, "after": after})
    async for blk in db.blocks.find({"construction_stages": {"$exists": True}}, {"_id": 0, "id": 1, "construction_stages": 1}):
        st = blk.get("construction_stages") or []
        await db.blocks.update_one({"id": blk["id"]}, {"$set": {"construction_percent": round(sum(1 for s in st if s["status"] == "Completed") * 100 / len(st)) if st else 0}})
    report["finished_at"] = now_iso()
    report["ok"] = not report["bookings_changed"]
    await db.settings.update_one({"key": "migration_phase7_report"}, {"$set": {"value": report}}, upsert=True)
    await db.settings.update_one({"key": "migration_phase7_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 7 migration done: %s", {k: v for k, v in report.items() if k != "bookings_changed"} | {"changed": len(report["bookings_changed"])})
    return report


async def seed_phase7():
    """Additional plans + one booking on Flexi. Idempotent."""
    if await db.settings.find_one({"key": "seed_phase7_done"}):
        return
    company = await db.companies.find_one({}, {"_id": 0})
    if not company or not await db.payment_plans.find_one({}):
        return
    cid = company["id"]
    st = {s["name"]: s["id"] for s in await db.construction_stages.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    poss = st.get("Possession/Handover")
    last5 = [st[n] for n in ("Brickwork", "Plastering", "Flooring", "Finishing", "External Works") if n in st]

    def mk(name, code, ptype, ins, desc):
        return {"id": new_id(), "company_id": cid, "name": name, "code": code, "description": desc, "plan_type": ptype, "installments": [{"seq": i + 1, "trigger_days": None, "trigger_stage_id": None, "trigger_date": None, "due_days": None, "notes": None, **x} for i, x in enumerate(ins)], "applies_percent_to": "BOTH_BUCKETS", "grace_days": 0, "is_active": True, "version": 1, "created_at": now_iso(), "updated_at": now_iso(), "created_by": "system"}
    plans = [
        mk("Down Payment 10:85:5", "DP_10_85_5", "Down Payment", [{"name": "Booking amount", "percent": 10, "trigger_type": "ON_BOOKING"}, {"name": "Down payment", "percent": 85, "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 30}, {"name": "On possession", "percent": 5, "trigger_type": "ON_POSSESSION", "trigger_stage_id": poss}], "10% on booking, 85% within 30 days, 5% on possession"),
        mk("Flexi 10:40:50", "FLEXI_10_40_50", "Flexi", [{"name": "Booking amount", "percent": 10, "trigger_type": "ON_BOOKING"}, {"name": "Flexi tranche", "percent": 40, "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 60}] + [{"name": f"On {n}", "percent": 10, "trigger_type": "ON_STAGE", "trigger_stage_id": sid} for n, sid in zip(("Brickwork", "Plastering", "Flooring", "Finishing", "External Works"), last5)], "10% booking, 40% after 60 days, 50% over the last 5 stages"),
    ]
    for p in plans:
        if not await db.payment_plans.find_one({"name": p["name"]}):
            await db.payment_plans.insert_one(p)
    if not await db.payment_plans.find_one({"name": {"$regex": "^Villa CLP"}}):
        clp = await db.payment_plans.find_one({"plan_type": "CLP"}, {"_id": 0})
        if clp:
            await db.payment_plans.insert_one({**clp, "id": new_id(), "name": "Villa CLP", "code": "VILLA_CLP", "description": "Construction-linked plan for villa blocks", "legacy_template_id": None})
    sgh = await db.projects.find_one({"code": "SGH"}, {"_id": 0, "id": 1, "name": 1})
    if sgh:
        from routers.construction import stage_sequence_for_block
        for blk in await db.blocks.find({"project_id": sgh["id"], "name": {"$regex": "Tower (A|B)"}}, {"_id": 0}).to_list(None):
            have = {s["stage_id"] for s in await stage_sequence_for_block(blk)}
            for pname in ("Down Payment 10:85:5", "Flexi 10:40:50"):
                p = await db.payment_plans.find_one({"name": pname}, {"_id": 0})
                need = {i["trigger_stage_id"] for i in p["installments"] if i["trigger_type"] == "ON_STAGE"}
                if need - have:  # extend the tower's sequence with the missing stages so Flexi fits (seeded towers used a short template)
                    seq = await stage_sequence_for_block(blk)
                    ids = [s["stage_id"] for s in seq]
                    for sid in [x for x in last5 if x not in ids]:
                        ids.insert(len(ids) - 1 if poss in ids else len(ids), sid)
                    new_seq = [{"stage_id": x, "seq": i + 1} for i, x in enumerate(ids)]
                    await db.blocks.update_one({"id": blk["id"]}, {"$set": {"construction_stage_sequence": new_seq}})
                    stages = blk.get("construction_stages") or []
                    done = {s["stage_id"]: s for s in stages}
                    names = {s["id"]: s for s in await db.construction_stages.find({}, {"_id": 0}).to_list(None)}
                    stages = [{"stage_id": x, "seq": i + 1, "name": names[x]["name"], "code": names[x].get("code"), "is_possession": bool(names[x].get("is_possession")), "status": "Pending", "started_on": None, "completed_on": None, "completed_at": None, "completed_by": None, "notes": None, "visible_to_customers": True} | {k: v for k, v in done.get(x, {}).items() if k in ("status", "completed_on", "completed_at", "completed_by", "notes", "progress_note")} for i, x in enumerate(ids)]
                    from routers.construction import legacy_milestones
                    await db.blocks.update_one({"id": blk["id"]}, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages), "construction_percent": round(sum(1 for s in stages if s["status"] == "Completed") * 100 / len(stages))}})
                    blk = await db.blocks.find_one({"id": blk["id"]}, {"_id": 0})
                await db.payment_plan_assignments.update_one({"payment_plan_id": p["id"], "project_id": sgh["id"], "block_id": blk["id"]}, {"$setOnInsert": {"id": new_id(), "company_id": cid, "payment_plan_id": p["id"], "project_id": sgh["id"], "block_id": blk["id"], "is_default": False, "effective_from": None, "effective_to": None, "is_active": True, "plan_name": p["name"], "plan_code": p["code"], "project_name": sgh["name"], "block_name": blk["name"], "created_at": now_iso(), "created_by": "system"}}, upsert=True)
    # convert one booking without payments to Flexi (coherent: void CLP demands, raise ON_BOOKING + 60-day tranche if due)
    flexi = await db.payment_plans.find_one({"name": "Flexi 10:40:50"}, {"_id": 0})
    cands = await db.bookings.find({"company_id": cid, "status": "Active", "block_name": {"$regex": "Tower (A|B)"}}, {"_id": 0}).to_list(None)
    cand = None
    if cands:  # the Tower A/B booking with the fewest payments (seed data has a payment on every booking)
        counts = {b["id"]: await db.payments.count_documents({"booking_id": b["id"], "status": {"$in": ["Cleared", "Pending"]}}) for b in cands}
        cand = sorted(cands, key=lambda b: (counts[b["id"]], b["booking_number"]))[0]
    if flexi and cand:
        from routers.construction import build_snapshot
        from services.dues_engine import raise_due_installments
        ts = now_iso()
        await db.demands.update_many({"booking_id": cand["id"], "voided": {"$ne": True}}, {"$set": {"voided": True, "voided_at": ts, "status": "Voided", "void_reason": "Seed: converted to Flexi plan"}})
        await db.bookings.update_one({"id": cand["id"]}, {"$set": {"payment_plan_id": flexi["id"], "payment_plan_snapshot": await build_snapshot(flexi), "plan_acceptance": {"accepted_on": cand["booking_date"], "accepted_by_user_id": None, "mode": "Signed copy"}, "raised_percent": 0, "construction_percent": 0}})
        fresh = await db.bookings.find_one({"id": cand["id"]}, {"_id": 0})
        await raise_due_installments(fresh, posted_at=ts)
        await db.settings.update_one({"key": "seed_phase7_flexi_booking"}, {"$set": {"value": cand["booking_number"]}}, upsert=True)
    await db.settings.update_one({"key": "seed_phase7_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 7 seed complete")
