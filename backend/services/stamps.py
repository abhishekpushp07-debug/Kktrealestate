"""3I: per-domain data versions, so a save only moves the stamp of the reports that read what it changed (a payment
must not evict lead or inventory results). Bumped beside every audited write (every write is audited)."""

import re
import uuid

from db import db

DOMAINS = ("money", "bookings", "leads", "inventory", "service", "other", "bills")
_RULES = (  # action prefix → the domains it changes; anything unlisted moves "other", which every report reads
    # "bills" = raised bills + tower stages (Home next milestone): a receipt does not move it
    (re.compile(r"^demand"), ("money", "bills")),
    (re.compile(r"^(payment|waiver|cancel|ledger|refund|receipt|cheque|allocation)"), ("money",)),
    (re.compile(r"^booking"), ("money", "bookings", "inventory", "bills")),
    (re.compile(r"^lead\.convert"), ("leads", "bookings")),
    (re.compile(r"^(lead|visit|site_visit)"), ("leads",)),
    (re.compile(r"^block"), ("inventory", "bills")),
    (re.compile(r"^(flat|project|price|rate_card|parking|hold)"), ("inventory",)),
    (re.compile(r"^service"), ("service",)),
    (re.compile(r"^(construction|stage|payment_plan)"), ("other", "bills")),
)


def domains_of(action: str) -> tuple:
    for rx, doms in _RULES:
        if rx.match(action or ""):
            return doms
    return ("other",)


async def bump(company_id: str | None, action: str):
    await db.cache_stamps.update_one(
        {"_id": company_id or "-"}, {"$inc": {d: 1 for d in domains_of(action)}}, upsert=True
    )


async def read(company_id: str | None, deps: tuple) -> str:
    """e.g. "e3f9a1-m12.b4.o7"; the epoch is new whenever the stamps doc is new (fresh / restored / reseeded data)."""
    d = await db.cache_stamps.find_one({"_id": company_id or "-"})
    if d is None or "epoch" not in d:
        await db.cache_stamps.update_one(
            {"_id": company_id or "-"}, {"$setOnInsert": {"epoch": uuid.uuid4().hex[:8]}}, upsert=True
        )
        await db.cache_stamps.update_one(
            {"_id": company_id or "-", "epoch": {"$exists": False}}, {"$set": {"epoch": uuid.uuid4().hex[:8]}}
        )
        d = await db.cache_stamps.find_one({"_id": company_id or "-"}) or {}
    return f"{d.get('epoch')}-" + ".".join(f"{x[0]}{d.get(x, 0)}" for x in deps)
