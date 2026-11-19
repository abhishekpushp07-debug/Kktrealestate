"""Tiny in-process TTL cache for expensive read endpoints (per worker; use Redis for multi-node).
Phase J6: bounded LRU (TTLCACHE_MAX entries, default 2000, oldest evicted) + single-flight so 100 concurrent misses compute once."""

import asyncio
import os
import time
from collections import OrderedDict

MAX_ENTRIES = int(os.environ.get("TTLCACHE_MAX", "2000"))
MAX_BYTES = int(os.environ.get("TTLCACHE_MAX_MB", "512")) * 1048576  # 3I: bounded by bytes too (report rows are MBs)
_store: OrderedDict[str, tuple[float, object]] = OrderedDict()
_SIZE: dict[str, int] = {}
_BYTES = [0]


def approx_size(v, depth: int = 0) -> int:
    """Cheap estimate of a cached value's own memory (sampled for long lists / dicts; short strings and small ints are
    mostly shared objects, so they're not counted) — over-counts ~3× vs RSS (50 reports: est 203 MB, real ≈ 60 MB on kkt_volume)."""
    if isinstance(v, (str, bytes)):
        return 50 + len(v) if len(v) > 32 else 0
    if isinstance(v, dict):
        n = len(v)
        if depth >= 6 or not n:
            return 64 + 24 * n
        vals = list(v.values())[:40]
        return 64 + 24 * n + sum(approx_size(x, depth + 1) for x in vals) * n // len(vals)
    if isinstance(v, (list, tuple, set)):
        n = len(v)
        if not n:
            return 56
        sample = list(v)[:20]
        return 56 + 8 * n + sum(approx_size(x, depth + 1) for x in sample) * n // len(sample)
    return 0


def clear_all():
    _store.clear()
    _SIZE.clear()
    _TAG.clear()
    _BYTES[0] = 0


def _drop(key: str):
    _TAG.pop(key, None)
    if _store.pop(key, None) is not None:
        _BYTES[0] -= _SIZE.pop(key, 0)


_inflight: dict[str, asyncio.Future] = {}
STATS = {"evictions": 0, "coalesced": 0}
_gen = [0]  # bumped by every invalidate: a compute that started before it must not store its (stale) result


def get(key: str):
    v = _store.get(key)
    if v and v[0] > time.monotonic():
        _store.move_to_end(key)
        return v[1]
    _drop(key)
    return None


def generation() -> int:
    return _gen[0]


def put(key: str, value, ttl: float = 10.0, gen: int | None = None):
    if gen is not None and gen != _gen[0]:
        return  # invalidated while the caller computed `value`: it may be stale
    size = approx_size(value)
    if size > MAX_BYTES // 4:
        return  # one result larger than a quarter of the budget is never kept
    _drop(key)
    while _store and (len(_store) >= MAX_ENTRIES or _BYTES[0] + size > MAX_BYTES):
        _drop(next(iter(_store)))
        STATS["evictions"] += 1
    _store[key] = (time.monotonic() + ttl, value)
    _SIZE[key] = size
    _BYTES[0] += size


def snapshot() -> dict:
    return {
        "entries": len(_store),
        "max_entries": MAX_ENTRIES,
        "mb": round(_BYTES[0] / 1048576, 1),
        "max_mb": MAX_BYTES // 1048576,
        "inflight": len(_inflight),
        **STATS,
        **HITS,
    }


def invalidate(prefix: str):
    _gen[0] += 1
    for k in [k for k in _store if k.startswith(prefix)]:
        _drop(k)
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


from contextvars import ContextVar  # noqa: E402

REQ_STAMPS: ContextVar[dict | None] = ContextVar("req_stamps", default=None)  # set to {} for each GET request


async def memo_stamp(name: str, read):
    """3I: one GET request reads each data stamp once (a Home bundle made 13 identical 3-query stamp reads). Only for
    GET requests (no write of its own in between) and only for 1 s, so a background task that inherited the context
    never reuses an old stamp."""
    m = REQ_STAMPS.get()
    if m is None:
        return await read()
    hit = m.get(name)
    if hit and time.monotonic() - hit[0] < 1.0:
        return await hit[1]
    fut = asyncio.ensure_future(read())
    m[name] = (time.monotonic(), fut)
    return await fut


async def data_stamp() -> str:
    return await memo_stamp("ttl", _data_stamp_read)


async def _data_stamp_read() -> str:
    """3G (REQ-314): one value every replica reads from the shared database. It moves when any business write is
    audited (every write is), when any ledger is rebuilt, and when a read-model mark is set or flushed — so a cache
    key that carries it is never served after a write that returned on another process (with or without Redis)."""
    from db import db
    from services import read_model_state

    # 3I: the per-domain write counters (bumped beside every non-noise audit row) instead of the newest non-noise
    # audit row — that query walked back over every "viewed" row written since the last real write
    st = sorted(
        (str(d.get("_id")), d.get("epoch"), tuple(sorted((k, v) for k, v in d.items() if k not in ("_id", "epoch"))))
        for d in await db.cache_stamps.find({}).to_list(50)
    )
    led = await db.ledger_entries.find_one({}, {"_id": 1}, sort=[("_id", -1)])
    sig = __import__("hashlib").sha256(repr(st).encode()).hexdigest()[:12]
    return f"{sig}.{led and led['_id']}.{await read_model_state.version()}"


SLOW_S = float(os.environ.get("REDIS_SHARE_MIN_MS", "100")) / 1000
_SLOW: set[str] = set()  # key families whose compute once took > SLOW_S: the only ones that spend Redis commands
_TAG: dict[str, tuple] = {}  # key → (stamp family, the data stamp it was computed at)
_FAM_HITS: dict[str, list] = {}  # family → [gets, hits, muted_until]: a family Redis can't help stops spending commands


def _worth_redis(fam: str) -> bool:
    st = _FAM_HITS.setdefault(fam, [0, 0, 0.0])
    if time.monotonic() < st[2]:
        return False
    if st[0] >= 200:
        if st[1] / st[0] < 0.05:  # under 5 % hits over 200 lookups → skip Redis for this family for 10 min
            st[2] = time.monotonic() + 600
        st[0] = st[1] = 0
        return time.monotonic() >= st[2]
    return True


_CUR: dict[str, str] = {}


_BIG: set = set()  # families whose results are over the Redis share limit
SHARE_MAX = int(os.environ.get("REDIS_SHARE_MAX_BYTES", "262144"))  # 3I: only small results travel through Redis
_BG: set = set()


def _bg(coro):
    t = asyncio.get_running_loop().create_task(coro)
    _BG.add(t)
    t.add_done_callback(_BG.discard)


def _retire(stamp: str, fam: str):
    """3I: a new data stamp makes every entry keyed by an older stamp unreachable — free it now, not after its TTL
    (under steady writes they piled up to GBs per worker)."""
    if stamp == _CUR.get(fam):
        return
    _CUR[fam] = stamp
    for k in [k for k, (f, st) in _TAG.items() if f == fam and st != stamp]:
        _TAG.pop(k, None)
        _drop(k)


async def cached(key: str, ttl: float, compute, stamped: bool = False, stamp: str | None = None):
    """stamped=True: the key already carries a data stamp read before computing, so a write during the compute
    changes the next key — the result is still right for this key and is cached (Phase 3F reports).
    Otherwise (3G) the shared data stamp is appended here, so every cached read is cross-replica safe."""
    if not stamped:
        stamp = await data_stamp()
        key = f"{key}|{stamp}"
    # retire per stamp family: the shared data_stamp, or (reports v3) the domain set the stamp was read for
    sfam = ("v3:" + "".join(c for c in (stamp or "").split(":")[0].split("-")[-1] if c.isalpha())) if stamped else "ttl"
    if stamp:
        _retire(stamp, sfam)
    from services import cache

    fam = key.split(":", 2)[0] + ":" + key.split(":", 2)[1] if key.count(":") >= 2 else key.split("|")[0]
    hit = get(key)  # 3I: process memory first (0 commands), then one Redis GET shared by every replica
    if hit is None and cache.redis_on() and fam in _SLOW and fam not in _BIG and _worth_redis(fam):
        hit = await cache.rget("ttl:" + key)
        _FAM_HITS[fam][0] += 1
        if hit is not None:
            _FAM_HITS[fam][1] += 1
            put(key, hit, ttl)
            if stamp:
                _TAG[key] = (sfam, stamp)
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
            _TAG[key] = (sfam, stamp)
        if slow and cache.redis_on() and _worth_redis(fam):  # command-frugal: only results worth sharing go to Redis
            if _SIZE.get(key, 0) > SHARE_MAX:
                # 3I: too big to ship — (de)serialising it on the event loop costs the requests beside it more than
                # recomputing saves; it stays in this process and its family never GETs either
                _BIG.add(fam)
            else:
                _bg(cache.rset("ttl:" + key, val, ttl))  # 3I: off the request — the caller never waits for Redis
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
