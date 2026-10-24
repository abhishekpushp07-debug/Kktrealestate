"""Pre-aggregated unit_counts on blocks and projects, kept in sync with flat status changes."""
from db import db

STATUSES = ["Available", "Hold", "Booked", "Sold", "Blocked"]
EMPTY = {**{s.lower(): 0 for s in STATUSES}, "total": 0}


def _counts_from_rows(rows) -> dict:
    c = dict(EMPTY)
    for r in rows:
        key = (r["_id"] or "").lower()
        if key in c:
            c[key] = r["n"]
    c["total"] = sum(c[s.lower()] for s in STATUSES)
    return c


async def recompute_block_counts(block_id: str) -> dict:
    rows = await db.flats.aggregate([{"$match": {"block_id": block_id, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "v": {"$sum": {"$ifNull": ["$price", 0]}}}}]).to_list(None)
    c = _counts_from_rows(rows)
    c["inventory_value"] = round(sum(r["v"] for r in rows), 2)
    await db.blocks.update_one({"id": block_id}, {"$set": {"unit_counts": c}})
    return c


async def recompute_project_counts(project_id: str) -> dict:
    rows = await db.flats.aggregate([{"$match": {"project_id": project_id, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "v": {"$sum": {"$ifNull": ["$price", 0]}}}}]).to_list(None)
    c = _counts_from_rows(rows)
    c["inventory_value"] = round(sum(r["v"] for r in rows), 2)
    bc = await db.blocks.count_documents({"project_id": project_id, "is_active": True})
    await db.projects.update_one({"id": project_id}, {"$set": {"unit_counts": c, "block_count": bc}})
    return c


async def refresh_counts(block_id: str | None = None, project_id: str | None = None):
    if block_id and not project_id:
        b = await db.blocks.find_one({"id": block_id}, {"_id": 0, "project_id": 1})
        project_id = b["project_id"] if b else None
    if block_id:
        await recompute_block_counts(block_id)
    if project_id:
        await recompute_project_counts(project_id)


async def apply_status_delta(block_id: str, project_id: str, old: str | None, new: str | None, session=None):
    """Atomic $inc on both parents for a single flat transition (old -> new)."""
    inc = {}
    if old and old in STATUSES:
        inc[f"unit_counts.{old.lower()}"] = -1
    if new and new in STATUSES:
        inc[f"unit_counts.{new.lower()}"] = inc.get(f"unit_counts.{new.lower()}", 0) + 1
    if not old:
        inc["unit_counts.total"] = 1
    if not new:
        inc["unit_counts.total"] = inc.get("unit_counts.total", 0) - 1
    inc = {k: v for k, v in inc.items() if v}
    if not inc:
        return
    kw = {"session": session} if session else {}
    await db.blocks.update_one({"id": block_id}, {"$inc": inc}, **kw)
    await db.projects.update_one({"id": project_id}, {"$inc": inc}, **kw)


async def recompute_all() -> dict:
    blocks = await db.blocks.find({}, {"_id": 0, "id": 1}).to_list(None)
    projects = await db.projects.find({}, {"_id": 0, "id": 1}).to_list(None)
    for b in blocks:
        await recompute_block_counts(b["id"])
    for p in projects:
        await recompute_project_counts(p["id"])
    return {"blocks": len(blocks), "projects": len(projects)}


def present_counts(doc: dict) -> dict:
    """Expose legacy `inventory` shape from unit_counts for existing UI."""
    c = doc.get("unit_counts") or EMPTY
    doc["inventory"] = {**{s: c.get(s.lower(), 0) for s in STATUSES}, "total": c.get("total", 0), "inventory_value": c.get("inventory_value", 0)}
    return doc
