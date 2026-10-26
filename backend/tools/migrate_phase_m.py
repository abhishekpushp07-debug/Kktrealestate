"""Phase M migration (idempotent): tower stage sequences → named Construction Stage Plans; block-scoped plan assignments → project+tower payment plans.
Booking snapshots, demands and ledgers are untouched. Run: python tools/migrate_phase_m.py"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from db import db  # noqa: E402
from utils import now_iso  # noqa: E402

BOOKING_STAGE = {"name": "Booking", "code": "BOOKING", "description": "Pseudo-stage: dues flagged here fall due at booking", "seq_hint": 0, "is_possession": False, "applies_to_block_types": [], "auto_complete_on_booking": True, "is_active": True, "version": 1}


async def ensure_booking_stage(company_id: str) -> dict:
    s = await db.construction_stages.find_one({"company_id": company_id, "code": "BOOKING"}, {"_id": 0})
    if not s:
        s = {"id": str(uuid.uuid4()), "company_id": company_id, **BOOKING_STAGE, "created_at": now_iso(), "updated_at": now_iso()}
        await db.construction_stages.insert_one(dict(s))
    return s


async def main():
    ts = now_iso()
    created_sp = created_pp = 0
    async for blk in db.blocks.find({"construction_stages.0": {"$exists": True}}, {"_id": 0, "id": 1, "company_id": 1, "project_id": 1, "name": 1, "construction_stages": 1}):
        await ensure_booking_stage(blk["company_id"])
        if await db.construction_stage_plans.find_one({"block_id": blk["id"], "is_active": True}):
            continue
        proj = await db.projects.find_one({"id": blk["project_id"]}, {"_id": 0, "name": 1, "code": 1})
        stage_ids = [s["stage_id"] for s in sorted(blk["construction_stages"], key=lambda s: s["seq"])]
        await db.construction_stage_plans.insert_one({"id": str(uuid.uuid4()), "company_id": blk["company_id"], "name": f"{(proj or {}).get('code') or (proj or {}).get('name')} {blk['name']} plan", "project_id": blk["project_id"], "project_name": (proj or {}).get("name"),
                                                      "block_id": blk["id"], "block_name": blk["name"], "stage_ids": stage_ids, "is_active": True, "version": 1, "created_at": ts, "updated_at": ts, "migrated_from": "block.construction_stages"})
        await db.blocks.update_one({"id": blk["id"]}, {"$set": {"construction_stage_sequence": [{"stage_id": s, "seq": i + 1} for i, s in enumerate(stage_ids)]}})
        created_sp += 1
    # block-scoped assignments → tower-wise plans (plan shared by several towers is cloned per tower, snapshot ids unchanged)
    async for asg in db.payment_plan_assignments.find({"is_active": True, "block_id": {"$ne": None}}, {"_id": 0}):
        plan = await db.payment_plans.find_one({"id": asg["payment_plan_id"]}, {"_id": 0})
        if not plan or plan.get("block_id"):
            if plan and plan.get("block_id") and plan["block_id"] != asg["block_id"]:
                clone = {**plan, "id": str(uuid.uuid4()), "project_id": asg["project_id"], "block_id": asg["block_id"], "name": f"{plan['name']} ({asg.get('block_name')})", "created_at": ts, "updated_at": ts, "cloned_from": plan["id"]}
                sp = await db.construction_stage_plans.find_one({"block_id": asg["block_id"], "is_active": True}, {"_id": 0, "id": 1, "name": 1})
                clone.update(stage_plan_id=(sp or {}).get("id"), stage_plan_name=(sp or {}).get("name"))
                await db.payment_plans.insert_one(clone)
                await db.payment_plan_assignments.update_one({"id": asg["id"]}, {"$set": {"payment_plan_id": clone["id"], "plan_name": clone["name"]}})
                created_pp += 1
            continue
        sp = await db.construction_stage_plans.find_one({"block_id": asg["block_id"], "is_active": True}, {"_id": 0, "id": 1, "name": 1})
        await db.payment_plans.update_one({"id": plan["id"]}, {"$set": {"project_id": asg["project_id"], "block_id": asg["block_id"], "stage_plan_id": (sp or {}).get("id"), "stage_plan_name": (sp or {}).get("name"), "updated_at": ts}})
        created_pp += 1
    print({"stage_plans_created": created_sp, "payment_plans_scoped": created_pp, "stage_plans_total": await db.construction_stage_plans.count_documents({})})


if __name__ == "__main__":
    asyncio.run(main())
