"""Phase 2D shared filters: the Home widgets and the lists they drill into use these same matches."""

from datetime import timedelta

from db import db
from services import clock
from services.definitions import OPEN_DEMAND_STATUSES

STALE_DAYS = 30
HOLD_HOURS = 48


def hold_expiry_cutoff() -> str:
    """Holds expiring within 48 h of the business clock (Flats list `hold_expiring` uses this too)."""
    return (clock.now() + timedelta(hours=HOLD_HOURS)).isoformat()


async def unreplaced_bounced_ids(match: dict) -> list[str]:
    """A bounced receipt is replaced once its booking has a later Cleared/Pending receipt of at least its amount."""
    bounced = await db.payments.find(
        {**match, "status": "Bounced"},
        {"_id": 0, "id": 1, "booking_id": 1, "amount_paise": 1, "bounced_at": 1, "posted_at": 1},
    ).to_list(None)
    later: dict = {}  # 3I: one read of the candidate replacements (was one query per bounced receipt)
    async for r in db.payments.find(
        {"booking_id": {"$in": list({p["booking_id"] for p in bounced})}, "status": {"$in": ["Cleared", "Pending"]}},
        {"_id": 0, "booking_id": 1, "posted_at": 1, "amount_paise": 1},
    ):
        later.setdefault(r["booking_id"], []).append(r)
    out = []
    for p in bounced:
        since = p.get("bounced_at") or p.get("posted_at") or ""
        if not any(
            (r.get("posted_at") or "") > since and r["amount_paise"] >= p["amount_paise"]
            for r in later.get(p["booking_id"], ())
        ):
            out.append(p["id"])
    return out


async def stale_part_paid_match(company_id: str, days: int = STALE_DAYS) -> dict:
    """Part-paid open bills whose booking has had no cleared receipt for `days` days (Demand register `stale_days`)."""
    cut = (clock.today() - timedelta(days=days)).isoformat()
    recent = await db.payments.distinct(
        "booking_id", {"company_id": company_id, "status": "Cleared", "payment_date": {"$gt": cut}}
    )
    return {"status": {"$in": OPEN_DEMAND_STATUSES}, "paid_paise": {"$gt": 0}, "booking_id": {"$nin": recent}}
