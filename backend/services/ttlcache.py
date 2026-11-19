"""Tiny in-process TTL cache for expensive read endpoints (per worker; use Redis for multi-node).
Phase J6: bounded LRU (TTLCACHE_MAX entries, default 2000, oldest evicted) + single-flight so 100 concurrent misses compute once."""

import asyncio
import os
import time
from collections import OrderedDict

MAX_ENTRIES = int(os.environ.get("TTLCACHE_MAX", "2000"))
_store: OrderedDict[str, tuple[float, object]] = OrderedDict()
_inflight: dict[str, asyncio.Future] = {}
STATS = {"evictions": 0, "coalesced": 0}
_gen = [0]  # bumped by every invalidate: a compute that started before it must not store its (stale) result


def get(key: str):
    v = _store.get(key)
    if v and v[0] > time.monotonic():
        _store.move_to_end(key)
        return v[1]
    _store.pop(key, None)
    return None


def generation() -> int:
    return _gen[0]


def put(key: str, value, ttl: float = 10.0, gen: int | None = None):
    if gen is not None and gen != _gen[0]:
        return  # invalidated while the caller computed `value`: it may be stale
    while len(_store) >= MAX_ENTRIES:
        _store.popitem(last=False)
        STATS["evictions"] += 1
    _store[key] = (time.monotonic() + ttl, value)
    _store.move_to_end(key)


def snapshot() -> dict:
    return {"entries": len(_store), "max_entries": MAX_ENTRIES, "inflight": len(_inflight), **STATS, **HITS}


def invalidate(prefix: str):
    _gen[0] += 1
    for k in [k for k in _store if k.startswith(prefix)]:
        _store.pop(k, None)
    for k in [k for k in _inflight if k.startswith(prefix)]:
        _inflight.pop(k, None)  # later readers start a fresh compute instead of joining the pre-invalidation one


# ---- Phase E0: async read-through cache with event-bus invalidation (Redis when REDIS_URL, else in-process) ----
import os  # noqa: E402

HITS = {"hit": 0, "miss": 0}
_ENTITY_PREFIXES = {
    "payment": ("home:", "dash:", "boot:", "list:payments", "list:demands", "list:bookings"),
    "demand": ("home:", "dash:", "boot:", "list:demands", "list:bookings"),
    "booking": ("home:", "dash:", "boot:", "list:bookings", "list:flats"),
    "flat": ("dash:", "list:flats"),
    "block": ("dash:", "list:blocks"),
    "project": ("dash:", "home:", "list:projects", "bundle:"),
    "customer": ("list:customers",),
    "lead": ("home:", "boot:", "list:leads"),
    "site_visit": ("home:", "boot:", "list:site_visits"),
    "service_request": ("list:service_requests",),
    "catalogue_item": ("bundle:",),
    "notification": ("boot:",),
    "user": ("boot:", "list:users"),
}


def scope_key(user: dict) -> str:
    return f"{user['company_id']}:{','.join(sorted(user.get('project_scope') or []))}"


# writes that never change business figures (sign-ins, reminders, generated PDFs, messages) don't move the stamp
import re as _re  # noqa: E402

_NOISE = _re.compile(
    r"^(reminder\.|document\.generated|message\.|notification\.|auth\.|login|report\.|export\.|session\.)"
)


async def data_stamp() -> str:
    """3G (REQ-314): one value every replica reads from the shared database. It moves when any business write is
    audited (every write is), when any ledger is rebuilt, and when a read-model mark is set or flushed — so a cache
    key that carries it is never served after a write that returned on another process (with or without Redis)."""
    from db import db
    from services import read_model_state

    a = await db.audit_logs.find_one({"action": {"$not": _NOISE}}, {"_id": 1}, sort=[("_id", -1)])
    led = await db.ledger_entries.find_one({}, {"_id": 1}, sort=[("_id", -1)])
    return f"{a and a['_id']}.{led and led['_id']}.{await read_model_state.version()}"


SLOW_S = float(os.environ.get("REDIS_SHARE_MIN_MS", "100")) / 1000
_SLOW: set[str] = set()  # key families whose compute once took > SLOW_S: the only ones that spend Redis commands
_TAG: dict[str, tuple] = {}  # key → (stamp family, the data stamp it was computed at)
_CUR: dict[str, str] = {}


def _fam(key: str) -> str:
    return "v3" if key.startswith("rpt3") else "ttl"  # the two stamp formats (reports v3 / shared data_stamp)


def _retire(stamp: str, fam: str):
    """3I: a new data stamp makes every entry keyed by an older stamp unreachable — free it now, not after its TTL
    (under steady writes they piled up to GBs per worker)."""
    if stamp == _CUR.get(fam):
        return
    _CUR[fam] = stamp
    for k in [k for k, (f, st) in _TAG.items() if f == fam and st != stamp]:
        _TAG.pop(k, None)
        _store.pop(k, None)


async def cached(key: str, ttl: float, compute, stamped: bool = False, stamp: str | None = None):
    """stamped=True: the key already carries a data stamp read before computing, so a write during the compute
    changes the next key — the result is still right for this key and is cached (Phase 3F reports).
    Otherwise (3G) the shared data stamp is appended here, so every cached read is cross-replica safe."""
    if not stamped:
        stamp = await data_stamp()
        key = f"{key}|{stamp}"
    if stamp:
        _retire(stamp, _fam(key))
    from services import cache

    fam = key.split(":", 2)[0] + ":" + key.split(":", 2)[1] if key.count(":") >= 2 else key.split("|")[0]
    hit = get(key)  # 3I: process memory first (0 commands), then one Redis GET shared by every replica
    if hit is None and cache.redis_on() and fam in _SLOW:
        hit = await cache.rget("ttl:" + key)
        if hit is not None:
            put(key, hit, ttl)
            if stamp:
                _TAG[key] = (_fam(key), stamp)
    if hit is not None:
        HITS["hit"] += 1
        return hit
    fut = _inflight.get(key)
    if fut is not None:  # single-flight: wait for the in-progress compute
        STATS["coalesced"] += 1
        HITS["hit"] += 1
        return await asyncio.shield(fut)
    HITS["miss"] += 1
    fut = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    gen = _gen[0]
    try:
        t0 = time.monotonic()
        val = await compute()
        slow = time.monotonic() - t0 > SLOW_S
        if slow:
            _SLOW.add(fam)
        if gen != _gen[0] and not stamped:  # invalidated while computing: serve it to this caller, never cache it
            fut.set_result(val)
            return val
        put(key, val, ttl)
        if stamp and key in _store:
            _TAG[key] = (_fam(key), stamp)
        if slow and cache.redis_on():  # command-frugal: only results worth sharing (compute > SLOW_S) go to Redis
            await cache.rset("ttl:" + key, val, ttl)
        fut.set_result(val)
        return val
    except BaseException as e:
        fut.set_exception(e)
        raise
    finally:
        if _inflight.get(key) is fut:
            _inflight.pop(key, None)


def _subscribe():
    from events import bus

    @bus.subscribe("entity.changed", "cache")
    async def _invalidate(evt: dict):
        from event_registry import cache_prefixes

        prefixes = cache_prefixes((evt.get("spec") or {}).get("surfaces") or []) | set(
            _ENTITY_PREFIXES.get(evt.get("entity_type"), ())
        )
        for p in prefixes:
            invalidate(p)  # Redis keys carry the data stamp: nothing to delete there (3I, command-frugal)


_subscribe()
