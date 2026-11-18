"""Dirty-scope state shared by read_models (writer) and trends (reader) without an import cycle.
3G: marks are also kept in Mongo (`read_model_marks`), so a crash inside the debounce window loses nothing (the sweep
flushes them) and every replica knows a flush is pending (it serves those figures from source meanwhile). The `__v`
row changes on every mark and every finished flush; it is part of the shared cache stamp."""

from datetime import UTC, datetime

from db import db

dirty = {"projects": set(), "blocks": set(), "customers": set(), "all": False, "task": None}
_PFX = {"projects": "p:", "blocks": "b:", "customers": "c:"}


def has_marks() -> bool:
    return bool(dirty["all"] or dirty["projects"] or dirty["blocks"] or dirty["customers"])


def pending() -> bool:
    """True while a change is marked but its read-model flush has not finished (this process only)."""
    t = dirty["task"]
    return has_marks() or bool(t and not t.done())


async def persist(project_id=None, block_id=None, customer_id=None, all_=False):
    now = datetime.now(UTC)
    ids = [f"p:{project_id}" if project_id else None, f"b:{block_id}" if block_id else None,
           f"c:{customer_id}" if customer_id else None, "all" if all_ else None]  # fmt: skip
    for i in filter(None, ids):
        await db.read_model_marks.update_one({"_id": i}, {"$set": {"at": now}}, upsert=True)
    await bump()


async def bump():
    await db.read_model_marks.update_one({"_id": "__v"}, {"$inc": {"v": 1}}, upsert=True)


async def clear(flushed: dict, started: datetime):
    ids = [_PFX[k] + str(x) for k in _PFX for x in flushed.get(k) or ()] + (["all"] if flushed.get("all") else [])
    if ids:
        await db.read_model_marks.delete_many({"_id": {"$in": ids}, "at": {"$lte": started}})
    await bump()


async def load_shared(older_than_s: float = 0) -> bool:
    """Pull marks left by any process (crashed or another replica) into this process's dirty set."""
    cut = datetime.now(UTC).timestamp() - older_than_s
    found = False
    async for m in db.read_model_marks.find({"_id": {"$ne": "__v"}}):
        if m["at"].replace(tzinfo=UTC).timestamp() > cut:
            continue
        found = True
        if m["_id"] == "all":
            dirty["all"] = True
            continue
        kind = next(k for k, p in _PFX.items() if m["_id"].startswith(p))
        dirty[kind].add(m["_id"][len(_PFX[kind]) :])
    return found


async def shared_pending(scope_id: str | None = None) -> bool:
    if pending():
        return True
    q = {"_id": {"$in": [scope_id, "all"]}} if scope_id else {"_id": {"$ne": "__v"}}
    return await db.read_model_marks.find_one(q, {"_id": 1}) is not None


async def marked(kind: str) -> list[str]:
    p = _PFX[kind]
    return [m["_id"][len(p) :] async for m in db.read_model_marks.find({"_id": {"$regex": f"^{p}"}}, {"_id": 1})]


async def version() -> int:
    d = await db.read_model_marks.find_one({"_id": "__v"})
    return (d or {}).get("v", 0)
