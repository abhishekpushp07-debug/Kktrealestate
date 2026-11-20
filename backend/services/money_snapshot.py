"""3I REQ-355/359/360: per-booking money snapshot — the booking's live bills (due date, shares, total, paid, status)
kept on the booking by every ledger rebuild, so ageing / Outstanding bridges read bookings only.

Self-validating: every write to `demands` outside a rebuild bumps `bookings.money_rev` before and after the write
(crash- and race-safe); a snapshot counts only while its `rev` equals the booking's `money_rev`. A missing or
out-of-date snapshot is computed from the bills (correct figure) and repaired in the background."""

import asyncio
import logging
from contextvars import ContextVar

log = logging.getLogger("kkt")
SKIP: ContextVar[bool] = ContextVar("money_rev_skip", default=False)
FIELDS = ("due_date", "cash_demand_paise", "account_demand_paise", "total_demand_paise", "paid_paise", "status")
RELEVANT = set(FIELDS) | {"voided", "booking_id"}
_REPAIRING: set[str] = set()


def bill(d: dict, **over) -> dict:
    return {k: d.get(k) for k in FIELDS} | over


def valid(b: dict) -> bool:
    s = b.get("money_snapshot")
    return bool(s) and s.get("rev") == (b.get("money_rev") or 0)


def _touches(update) -> bool:
    if not isinstance(update, dict) or not all(k.startswith("$") for k in update):
        return True  # replacement / pipeline update: assume it matters
    return any(f.split(".")[0] in RELEVANT for op in update.values() if isinstance(op, dict) for f in op)


async def _bump(raw_db, ids, session=None):
    ids = [i for i in set(ids) if i]
    if ids:  # inside a transaction the bump joins it (an outside write would conflict with the txn's booking write)
        await raw_db.bookings.update_many({"id": {"$in": ids}}, {"$inc": {"money_rev": 1}}, session=session)


class DemandsCollection:
    """`db.demands`: every bill write outside a ledger rebuild invalidates the touched bookings' snapshots."""

    def __init__(self, coll, raw_db):
        self._coll, self._db = coll, raw_db

    def __getattr__(self, item):
        return getattr(self._coll, item)

    async def _around(self, ids, op, session=None):
        if SKIP.get():
            return await op()
        await _bump(self._db, ids, session)
        try:
            return await op()
        finally:
            await _bump(self._db, ids, session)

    async def insert_one(self, doc, *a, **k):
        return await self._around(
            [doc.get("booking_id")], lambda: self._coll.insert_one(doc, *a, **k), k.get("session")
        )

    async def insert_many(self, docs, *a, **k):
        docs = list(docs)
        return await self._around(
            [d.get("booking_id") for d in docs], lambda: self._coll.insert_many(docs, *a, **k), k.get("session")
        )

    async def _ids(self, flt, update=None, session=None):
        if update is not None and not _touches(update):
            return []
        if isinstance(flt, dict) and isinstance(flt.get("booking_id"), str):
            return [flt["booking_id"]]
        return await self._coll.distinct("booking_id", flt, session=session)

    async def update_one(self, flt, update, *a, **k):
        ids = [] if SKIP.get() else await self._ids(flt, update, k.get("session"))
        if not ids and not SKIP.get():
            return await self._coll.update_one(flt, update, *a, **k)
        return await self._around(ids, lambda: self._coll.update_one(flt, update, *a, **k), k.get("session"))

    async def update_many(self, flt, update, *a, **k):
        ids = [] if SKIP.get() else await self._ids(flt, update, k.get("session"))
        if not ids and not SKIP.get():
            return await self._coll.update_many(flt, update, *a, **k)
        return await self._around(ids, lambda: self._coll.update_many(flt, update, *a, **k), k.get("session"))

    async def find_one_and_update(self, flt, update, *a, **k):
        ids = [] if SKIP.get() else await self._ids(flt, update, k.get("session"))
        return await self._around(ids, lambda: self._coll.find_one_and_update(flt, update, *a, **k), k.get("session"))

    async def delete_one(self, flt, *a, **k):
        ss = k.get("session")
        return await self._around(await self._ids(flt, None, ss), lambda: self._coll.delete_one(flt, *a, **k), ss)

    async def delete_many(self, flt, *a, **k):
        ss = k.get("session")
        return await self._around(await self._ids(flt, None, ss), lambda: self._coll.delete_many(flt, *a, **k), ss)


async def bills_for(bookings: list[dict]) -> dict[str, list[dict]]:
    """{booking_id: live bills} — from valid snapshots; the rest straight from the bills (and repaired)."""
    from db import db

    out, stale = {}, []
    for b in bookings:
        if valid(b):
            out[b["id"]] = b["money_snapshot"]["bills"]
        else:
            stale.append(b["id"])
    if stale:
        for i in range(0, len(stale), 500):
            async for d in db.demands.find(
                {"booking_id": {"$in": stale[i : i + 500]}, "voided": {"$ne": True}},
                {"_id": 0, "booking_id": 1, **dict.fromkeys(FIELDS, 1)},
            ):
                out.setdefault(d["booking_id"], []).append(bill(d))
        for bid in stale:
            out.setdefault(bid, [])
        todo = [b for b in stale if b not in _REPAIRING][:200]  # bulk backfill = startup / nightly, not a read
        _REPAIRING.update(todo)
        if todo:
            asyncio.get_running_loop().create_task(_repair_many(todo))
    return out


async def repair(booking_id: str) -> bool:
    """Write the snapshot from the bills as they are now; lands only if no bill write happened meanwhile."""
    from db import db

    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "id": 1, "money_rev": 1})
    if not b:
        return False
    rev = b.get("money_rev") or 0
    bills = [
        bill(d)
        async for d in db.demands.find(
            {"booking_id": booking_id, "voided": {"$ne": True}}, {"_id": 0, **dict.fromkeys(FIELDS, 1)}
        ).sort("posted_at", 1)
    ]
    flt = {"id": booking_id, "money_rev": rev} if rev else {"id": booking_id, "money_rev": {"$in": [None, 0]}}
    r = await db.bookings.update_one(flt, {"$set": {"money_snapshot": {"rev": rev, "bills": bills}}})
    return r.modified_count == 1 or r.matched_count == 1


async def _repair_many(ids):
    try:
        for bid in ids:
            await repair(bid)
    except Exception:  # noqa: BLE001 — the next read repairs again
        log.exception("money snapshot repair")
    finally:
        _REPAIRING.difference_update(ids)


def _same(a: list[dict], b: list[dict]) -> bool:
    key = lambda x: tuple(str(x.get(k)) for k in FIELDS)  # noqa: E731
    return sorted(map(key, a)) == sorted(map(key, b))


async def in_step_check(repair_missing: bool = True) -> dict:
    """REQ-360 nightly: every booking's snapshot vs a recompute from its bills. Stored for System Health."""
    from db import db
    from utils import now_iso

    checked = differ = missing = 0
    examples = []
    bks = await db.bookings.find({}, {"_id": 0, "id": 1, "money_rev": 1, "money_snapshot": 1}).to_list(None)
    for i in range(0, len(bks), 500):
        chunk = bks[i : i + 500]
        src: dict = {b["id"]: [] for b in chunk}
        async for d in db.demands.find(
            {"booking_id": {"$in": list(src)}, "voided": {"$ne": True}},
            {"_id": 0, "booking_id": 1, **dict.fromkeys(FIELDS, 1)},
        ):
            src[d["booking_id"]].append(bill(d))
        for b in chunk:
            if not valid(b):
                missing += 1
                if repair_missing:
                    await repair(b["id"])
                continue
            checked += 1
            if not _same(b["money_snapshot"]["bills"], src[b["id"]]):
                differ += 1
                examples.append(b["id"])
                # moving the rev also moves the booking marker: figures kept per booking on any server recompute
                await db.bookings.update_one({"id": b["id"]}, {"$inc": {"money_rev": 1}})
                await repair(b["id"])
    res = {
        "name": "report_figures",
        "checked": checked,
        "differences": differ,
        "rebuilt_missing": missing,
        "examples": examples[:5],
        "at": now_iso(),
        "label": "Report figures: in step" if not differ else f"Report figures: {differ} differences (repaired)",
    }
    await db.system_checks.update_one({"name": "report_figures"}, {"$set": res}, upsert=True)
    return res
