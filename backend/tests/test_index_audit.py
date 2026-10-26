"""Index audit: every list/search/aggregation query must use an index on seed data (no COLLSCAN). Runs in-process against Mongo."""
import asyncio
import os
import sys

import pytest
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from db import db  # noqa: E402

TODAY = "2026-10-24"
QUERIES = [
    ("customers list", db.customers, {"company_id": "c", "is_active": True}, [("created_at", -1), ("id", 1)]),
    ("customers by RM followup", db.customers, {"company_id": "c", "assigned_sales_user_id": "u"}, [("next_follow_up_at", 1)]),
    ("customers phone prefix", db.customers, {"company_id": "c", "phone": {"$regex": "^98"}}, None),
    ("bookings list", db.bookings, {"company_id": "c", "status": {"$in": ["Active"]}}, [("booking_date", -1), ("id", 1)]),
    ("bookings by customer", db.bookings, {"company_id": "c", "customer_id": "x"}, [("booking_date", -1)]),
    ("bookings by project status", db.bookings, {"company_id": "c", "project_id": "p", "status": {"$in": ["Active"]}}, [("booking_date", -1)]),
    ("bookings by block", db.bookings, {"block_id": "b", "status": "Active"}, None),
    ("payments list", db.payments, {"company_id": "c", "status": {"$in": ["Cleared"]}}, [("payment_date", -1), ("id", 1)]),
    ("payments by booking bucket", db.payments, {"booking_id": "b", "against": "FLAT_VALUE", "payment_category": "Cash", "status": "Cleared"}, None),
    ("payments by project date", db.payments, {"project_id": "p"}, [("payment_date", -1)]),
    ("cheques pending", db.payments, {"company_id": "c", "status": "Pending"}, None),
    ("demands overdue", db.demands, {"company_id": "c", "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": TODAY}}, None),
    ("demands by booking", db.demands, {"booking_id": "b"}, [("posted_at", 1)]),
    ("demands by customer", db.demands, {"customer_id": "x", "status": {"$in": ["Open"]}}, [("due_date", 1)]),
    ("leads list", db.leads, {"company_id": "c", "status": {"$in": ["New"]}}, [("created_at", -1), ("id", 1)]),
    ("leads by phone", db.leads, {"company_id": "c", "phone": "9876543210"}, None),
    ("leads followups", db.leads, {"company_id": "c", "assigned_to": "u", "next_follow_up_at": {"$lte": TODAY}}, None),
    ("flats grid", db.flats, {"block_id": "b"}, [("floor", 1), ("position", 1)]),
    ("flats by project status", db.flats, {"project_id": "p", "status": "Available"}, None),
    ("flats search", db.flats, {"flat_number": {"$regex": "^A1"}}, None),
    ("visits calendar", db.site_visits, {"company_id": "c", "date": {"$gte": TODAY, "$lte": TODAY}}, [("slot_start", 1)]),
    ("visits capacity", db.site_visits, {"project_id": "p", "date": TODAY, "status": {"$nin": ["Cancelled"]}}, None),
    ("visits by lead", db.site_visits, {"lead_id": "l", "status": {"$in": ["Confirmed", "Rescheduled"]}, "date": {"$gte": TODAY}}, None),
    ("tickets list", db.service_requests, {"company_id": "c", "status": {"$nin": ["Closed"]}}, [("created_at", -1)]),
    ("tickets by customer", db.service_requests, {"customer_id": "x"}, [("created_at", -1)]),
    ("notifications unread", db.notifications, {"user_id": "u", "read": False}, [("created_at", -1)]),
    ("ledger rows", db.ledger_entries, {"booking_id": "b"}, [("seq", 1)]),
    ("audit by entity", db.audit_logs, {"entity_type": "booking", "entity_id": "b"}, [("created_at", -1)]),
    ("audit by company", db.audit_logs, {"company_id": "c"}, [("created_at", -1)]),
    ("catalogue bundle", db.catalogue_items, {"company_id": "c", "is_active": True}, [("type", 1), ("sort_order", 1)]),
    ("catalogue type", db.catalogue_items, {"company_id": "c", "type": "state", "is_active": True}, [("sort_order", 1)]),
    ("communications by customer", db.communications, {"company_id": "c", "customer_id": "x"}, [("happened_at", -1)]),
    ("documents by entity", db.documents, {"entity_type": "booking", "entity_id": "b", "is_active": True}, None),
    ("brochure stats", db.brochure_downloads, {"project_id": "p", "at": {"$gte": TODAY}}, None),
    ("project summaries", db.project_summaries, {"company_id": "c"}, None),
    ("block summaries", db.block_summaries, {"project_id": "p"}, None),
    ("customer summaries", db.customer_summaries, {"customer_id": "x"}, None),
    ("rate limits", db.rate_limits, {"bucket": "b", "slot": 1}, None),
    ("idempotency", db.idempotency_keys, {"user_id": "u", "key": "k"}, None),
    ("refresh tokens", db.refresh_tokens, {"token_hash": "h"}, None),
    ("users by email", db.users, {"email": "a@b.c"}, None),
]


def _stages(plan: dict) -> set[str]:
    out = set()

    def walk(n):
        if isinstance(n, dict):
            if "stage" in n:
                out.add(n["stage"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(plan)
    return out


async def _explain(coll, q, sort):
    cur = coll.find(q)
    if sort:
        cur = cur.sort(sort)
    return await cur.explain()


@pytest.mark.parametrize("name,coll,q,sort", QUERIES, ids=[q[0] for q in QUERIES])
def test_query_uses_index(name, coll, q, sort):
    plan = asyncio.get_event_loop().run_until_complete(_explain(coll, q, sort))["queryPlanner"]["winningPlan"]
    stages = _stages(plan)
    assert "COLLSCAN" not in stages, f"{name}: COLLSCAN — {stages}"
    assert "IXSCAN" in stages or "EOF" in stages, f"{name}: {stages}"
    if sort and "SORT" in stages and "IXSCAN" not in stages:
        pytest.fail(f"{name}: in-memory sort without index")
