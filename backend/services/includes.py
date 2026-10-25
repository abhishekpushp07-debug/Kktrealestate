"""`include=` expansion for list/detail endpoints: batched `$in` lookups (never N+1), compact projections."""
from db import db

COMPACT = {
    "customer": (db.customers, "customer_id", {"id": 1, "customer_code": 1, "full_name": 1, "phone": 1, "email": 1, "kyc_status": 1, "lifecycle_stage": 1, "engagement_score": 1}),
    "flat": (db.flats, "flat_id", {"id": 1, "flat_number": 1, "floor": 1, "floor_label": 1, "flat_type_code": 1, "status": 1, "price": 1, "super_builtup_sqft": 1, "facing": 1}),
    "block": (db.blocks, "block_id", {"id": 1, "name": 1, "code": 1, "construction_percent": 1, "status": 1}),
    "project": (db.projects, "project_id", {"id": 1, "name": 1, "code": 1, "status": 1, "address.city": 1}),
    "plan": (db.payment_plans, "payment_plan_id", {"id": 1, "name": 1, "code": 1, "plan_type": 1}),
    "booking": (db.bookings, "booking_id", {"id": 1, "booking_number": 1, "status": 1, "agreement_value_paise": 1, "flat_snapshot.flat_number": 1, "project_name": 1, "block_name": 1, "summary": 1}),
    "rm": (db.users, "assigned_sales_user_id", {"id": 1, "name": 1, "email": 1, "phone": 1}),
    "assigned": (db.users, "assigned_to", {"id": 1, "name": 1, "email": 1}),
    "sales_user": (db.users, "sales_user_id", {"id": 1, "name": 1}),
    "summary": (db.customer_summaries, "id", {"customer_id": 1, "bookings": 1, "agreement_paise": 1, "paid_paise": 1, "due_paise": 1, "overdue_paise": 1, "last_payment_at": 1, "engagement_score": 1, "computed_at": 1}),
}
# Allowed include keys per resource (documented in PRD "API packeting")
ALLOWED = {
    "bookings": ("customer", "flat", "block", "project", "plan", "sales_user"),
    "customers": ("rm", "summary", "bookings"),
    "payments": ("booking", "customer", "project"),
    "leads": ("project", "assigned", "customer"),
}


async def expand(items: list[dict], include: str | None, resource: str) -> list[dict]:
    if not include or not items:
        return items
    wanted = [i for i in include.split(",") if i in ALLOWED[resource]]
    for inc in wanted:
        if inc == "bookings":  # reverse relation
            ids = [i["id"] for i in items]
            rows = await db.bookings.find({"customer_id": {"$in": ids}}, {"_id": 0, "id": 1, "customer_id": 1, "booking_number": 1, "status": 1, "project_name": 1, "block_name": 1, "flat_snapshot.flat_number": 1, "agreement_value_paise": 1, "summary.due_paise": 1}).to_list(None)
            by = {}
            for r in rows:
                by.setdefault(r["customer_id"], []).append(r)
            for i in items:
                i["bookings"] = by.get(i["id"], [])
            continue
        coll, fk, proj = COMPACT[inc]
        if resource == "leads" and inc == "customer":
            fk = "converted_customer_id"
        ids = list({i.get(fk) for i in items if i.get(fk)})
        if not ids:
            for i in items:
                i[inc] = None
            continue
        key = "customer_id" if inc == "summary" else "id"
        rows = {r[key]: r for r in await coll.find({key: {"$in": ids}}, {"_id": 0, **proj}).to_list(None)}
        for i in items:
            i[inc] = rows.get(i.get(fk))
    return items
