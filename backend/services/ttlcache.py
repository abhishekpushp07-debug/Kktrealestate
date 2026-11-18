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
import json  # noqa: E402
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

_NOISE = _re.compile(r"^(reminder\.|document\.generated|message\.|notification\.|auth\.|login|report\.|export\.|session\.)")


async def data_stamp() -> str:
    """3G (REQ-314): one value every replica reads from the shared database. It moves when any business write is
    audited (every write is), when any ledger is rebuilt, and when a read-model mark is set or flushed — so a cache
    key that carries it is never served after a write that returned on another process (with or without Redis)."""
    from db import db
    from services import read_model_state

    a = await db.audit_logs.find_one({"action": {"$not": _NOISE}}, {"_id": 1}, sort=[("_id", -1)])
    led = await db.ledger_entries.find_one({}, {"_id": 1}, sort=[("_id", -1)])
    return f"{a and a['_id']}.{led and led['_id']}.{await read_model_state.version()}"


async def cached(key: str, ttl: float, compute, stamped: bool = False):
    """stamped=True: the key already carries a data stamp read before computing, so a write during the compute
    changes the next key — the result is still right for this key and is cached (Phase 3F reports).
    Otherwise (3G) the shared data stamp is appended here, so every cached read is cross-replica safe."""
    if not stamped:
        key = f"{key}|{await data_stamp()}"
        stamped = True
    use_redis = os.environ.get("REDIS_URL")
    if use_redis:
        from services import cache

        hit = await cache.get("ttl:" + key)
    else:
        hit = get(key)
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
        val = await compute()
        if gen != _gen[0] and not stamped:  # invalidated while computing: serve it to this caller, never cache it
            fut.set_result(val)
            return val
        if use_redis:
            from services import cache

            await cache.set("ttl:" + key, json.loads(json.dumps(val, default=str)), max(1, int(ttl)))
        else:
            put(key, val, ttl)
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
            invalidate(p)
        if os.environ.get("REDIS_URL"):
            from services import cache

            for p in prefixes:
                await cache.delete("ttl:" + p)


_subscribe()
