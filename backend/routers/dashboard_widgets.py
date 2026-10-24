"""Role-aware dashboard widgets (Phase 4)."""
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends

from db import db
from deps import project_scope_filter, require
from services.money import present_money

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/widgets")
async def widgets(user: dict = Depends(require("project.read"))):
    from services import ttlcache
    ck = f"widgets:{user['company_id']}:{user.get('role_name')}:{user['id'] if user.get('role_name') == 'Sales' else ''}:{','.join(sorted(user.get('project_scope') or []))}"
    hit = ttlcache.get(ck)
    if hit is not None:
        return hit
    role = user.get("role_name")
    perms = set(user["permissions"])
    cid = user["company_id"]
    scope = project_scope_filter(user)
    base = {"company_id": cid, **scope}
    today = date.today()
    out = {"role": role}
    if "payment.read" in perms and role != "Sales":
        since = (today.replace(day=1) - timedelta(days=335)).replace(day=1).isoformat()
        rows = await db.payments.aggregate([{"$match": {**base, "status": "Cleared", "payment_date": {"$gte": since}}}, {"$group": {"_id": {"m": {"$substr": ["$payment_date", 0, 7]}, "c": {"$cond": [{"$ne": ["$against", "FLAT_VALUE"]}, "Other", "$payment_category"]}}, "s": {"$sum": "$amount_paise"}}}]).to_list(None)
        trend = {}
        for r in rows:
            trend.setdefault(r["_id"]["m"], {"month": r["_id"]["m"], "Cash_paise": 0, "Account_paise": 0, "Other_paise": 0})[f"{r['_id']['c']}_paise"] += r["s"]
        out["collections_trend"] = sorted(trend.values(), key=lambda x: x["month"])
        ageing = {"Not due": 0, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0}
        async for d in db.demands.find({**base, "voided": False, "status": {"$in": ["Open", "Partially Paid"]}}, {"_id": 0, "due_date": 1, "total_demand_paise": 1, "paid_paise": 1}):
            rem = d["total_demand_paise"] - d.get("paid_paise", 0)
            try:
                days = (today - date.fromisoformat(d["due_date"])).days
            except (TypeError, ValueError):
                days = -1
            ageing["Not due" if days < 0 else "0-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"] += rem
        out["ageing"] = [{"bucket": k, "amount_paise": v} for k, v in ageing.items()]
        pend = await db.payments.find({**base, "status": "Pending"}, {"_id": 0, "id": 1, "receipt_number": 1, "customer_name": 1, "amount_paise": 1, "instrument": 1, "booking_id": 1}).sort("instrument.date", 1).to_list(20)
        out["pending_cheques"] = {"items": pend, "amount_paise": sum(p["amount_paise"] for p in pend), "count": len(pend)}
        over = await db.demands.find({**base, "voided": False, "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today.isoformat()}}, {"_id": 0, "id": 1, "demand_number": 1, "booking_id": 1, "due_date": 1, "total_demand_paise": 1, "paid_paise": 1, "milestone_name": 1}).sort("due_date", 1).to_list(200)
        bks = {b["id"]: b for b in await db.bookings.find({"id": {"$in": list({d["booking_id"] for d in over})}}, {"_id": 0, "id": 1, "customer_name": 1, "booking_number": 1}).to_list(None)}
        per = {}
        for d in over:
            b = bks.get(d["booking_id"], {})
            e = per.setdefault(d["booking_id"], {"booking_id": d["booking_id"], "booking_number": b.get("booking_number"), "customer_name": b.get("customer_name"), "overdue_paise": 0, "demands": 0, "oldest_due": d["due_date"]})
            e["overdue_paise"] += d["total_demand_paise"] - d.get("paid_paise", 0)
            e["demands"] += 1
        out["top_overdue"] = sorted(per.values(), key=lambda x: -x["overdue_paise"])[:5]
        out["overdue_demands"] = [{**d, "customer_name": bks.get(d["booking_id"], {}).get("customer_name"), "booking_number": bks.get(d["booking_id"], {}).get("booking_number"), "balance_paise": d["total_demand_paise"] - d.get("paid_paise", 0)} for d in over[:15]]
        out["bounced_recent"] = await db.payments.find({**base, "status": "Bounced", "bounced_at": {"$gte": (datetime.now(UTC) - timedelta(days=30)).isoformat()}}, {"_id": 0, "id": 1, "receipt_number": 1, "customer_name": 1, "amount_paise": 1, "bounced_at": 1}).sort("bounced_at", -1).to_list(10)
        tm = await db.payments.aggregate([{"$match": {**base, "status": "Cleared", "payment_date": {"$gte": today.replace(day=1).isoformat()}}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(1)
        td = await db.payments.aggregate([{"$match": {**base, "status": "Cleared", "payment_date": today.isoformat()}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(1)
        out["collections_today"] = {"amount_paise": td[0]["s"] if td else 0, "count": td[0]["n"] if td else 0}
        out["collections_month"] = {"amount_paise": tm[0]["s"] if tm else 0, "count": tm[0]["n"] if tm else 0}
    if "booking.read" in perms:
        since = (today.replace(day=1) - timedelta(days=335)).replace(day=1).isoformat()
        vel = await db.bookings.aggregate([{"$match": {**base, "booking_date": {"$gte": since}}}, {"$group": {"_id": {"$substr": ["$booking_date", 0, 7]}, "n": {"$sum": 1}, "v": {"$sum": "$agreement_value_paise"}}}, {"$sort": {"_id": 1}}]).to_list(None)
        out["sales_velocity"] = [{"month": v["_id"], "bookings": v["n"], "value_paise": v["v"]} for v in vel]
        mine = {**base, "booking_date": {"$gte": today.replace(day=1).isoformat()}}
        if role == "Sales":
            mine["sales_user_id"] = user["id"]
        mb = await db.bookings.aggregate([{"$match": mine}, {"$group": {"_id": None, "n": {"$sum": 1}, "v": {"$sum": "$agreement_value_paise"}}}]).to_list(1)
        out["my_bookings_month"] = {"count": mb[0]["n"] if mb else 0, "value_paise": mb[0]["v"] if mb else 0}
    projects = await db.projects.find({"company_id": cid, "is_active": True, **project_scope_filter(user, "id")}, {"_id": 0, "id": 1, "name": 1, "code": 1, "unit_counts": 1}).to_list(None)
    out["inventory_by_project"] = [{"project": p["code"], "name": p["name"], **(p.get("unit_counts") or {})} for p in projects]
    blocks = await db.blocks.find({**base, "is_active": True}, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_code": 1, "construction_percent": 1, "milestones": 1, "unit_counts": 1}).sort("code", 1).to_list(None)
    out["construction"] = [{"id": b["id"], "block": f"{b.get('project_code', '')} {b['name']}", "percent": b.get("construction_percent", 0), "next_milestone": next((m["name"] for m in b.get("milestones") or [] if m["status"] == "Pending"), None), "available": (b.get("unit_counts") or {}).get("available", 0), "total": (b.get("unit_counts") or {}).get("total", 0)} for b in blocks]
    if "payment.read" in perms or "booking.read" in perms:
        m0 = today.replace(day=1).isoformat()
        dm = await db.demands.aggregate([{"$match": {**base, "voided": {"$ne": True}, "demand_date": {"$gte": m0}}}, {"$group": {"_id": None, "n": {"$sum": 1}, "v": {"$sum": "$total_demand_paise"}, "p": {"$sum": "$paid_paise"}}}]).to_list(1)
        out["dues_raised_month"] = {"count": dm[0]["n"] if dm else 0, "total_paise": dm[0]["v"] if dm else 0, "paid_paise": dm[0]["p"] if dm else 0}
        from services.dues_engine import schedule
        up = []
        horizon = (today + timedelta(days=30)).isoformat()
        async for bk in db.bookings.find({**base, "status": "Active", "payment_plan_snapshot": {"$ne": None}}, {"_id": 0}):
            blk = await db.blocks.find_one({"id": bk["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
            for r in schedule(bk, blk, await db.demands.find({"booking_id": bk["id"]}, {"_id": 0}).to_list(None)):
                if r["status"] == "Not yet due" and r["expected_date"] and r["expected_date"] <= horizon:
                    up.append({"booking_number": bk["booking_number"], "booking_id": bk["id"], "customer_name": bk.get("customer_name"), "installment": r["name"], "expected_date": r["expected_date"], "total_paise": r["total_expected_paise"]})
        out["upcoming_installments"] = sorted(up, key=lambda x: x["expected_date"])[:20]
    if "lead.read" in perms:
        lq = {"company_id": cid, **scope}
        if role == "Sales":
            lq["assigned_to"] = user["id"]
        stages = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Converted", "Lost"]
        fn = await db.leads.aggregate([{"$match": lq}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
        fm = {f["_id"]: f["n"] for f in fn}
        out["funnel"] = [{"stage": s, "count": fm.get(s, 0)} for s in stages]
        week = (datetime.now(UTC) - timedelta(days=7)).isoformat()
        out["website_enquiries_week"] = await db.leads.count_documents({"company_id": cid, "source": "Website", "created_at": {"$gte": week}})
        out["new_enquiries"] = await db.leads.find({"company_id": cid, "source": "Website", "is_read": False}, {"_id": 0, "id": 1, "lead_number": 1, "name": 1, "phone": 1, "project_name": 1, "created_at": 1}).sort("created_at", -1).to_list(10)
        end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()
        out["follow_ups_due"] = await db.leads.find({**lq, "next_follow_up_at": {"$lte": end}, "status": {"$nin": ["Converted", "Lost"]}}, {"_id": 0, "id": 1, "lead_number": 1, "name": 1, "phone": 1, "status": 1, "next_follow_up_at": 1}).sort("next_follow_up_at", 1).to_list(15)
    if "milestone.update" in perms or role == "Project Admin":
        out["demands_raised_month"] = await db.demands.count_documents({**base, "voided": False, "demand_date": {"$gte": today.replace(day=1).isoformat()}})
    res = present_money(out)
    ttlcache.put(ck, res, 10)
    return res
