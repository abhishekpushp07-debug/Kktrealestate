"""Tiny in-process TTL cache for expensive read endpoints (per worker; use Redis for multi-node)."""
import time

_store: dict[str, tuple[float, object]] = {}


def get(key: str):
    v = _store.get(key)
    if v and v[0] > time.monotonic():
        return v[1]
    _store.pop(key, None)
    return None


def put(key: str, value, ttl: float = 10.0):
    if len(_store) > 2000:
        _store.clear()
    _store[key] = (time.monotonic() + ttl, value)


def invalidate(prefix: str):
    for k in [k for k in _store if k.startswith(prefix)]:
        _store.pop(k, None)


# ---- Phase E0: async read-through cache with event-bus invalidation (Redis when REDIS_URL, else in-process) ----
import json  # noqa: E402
import os  # noqa: E402

HITS = {"hit": 0, "miss": 0}
_ENTITY_PREFIXES = {
    "payment": ("home:", "dash:", "boot:", "list:payments", "list:demands", "list:bookings"),
    "demand": ("home:", "dash:", "boot:", "list:demands", "list:bookings"),
    "booking": ("home:", "dash:", "boot:", "list:bookings", "list:flats"),
    "flat": ("dash:", "list:flats"), "block": ("dash:", "list:blocks"), "project": ("dash:", "home:", "list:projects", "bundle:"),
    "customer": ("list:customers",), "lead": ("home:", "boot:", "list:leads"), "site_visit": ("home:", "boot:", "list:site_visits"),
    "service_request": ("list:service_requests",), "catalogue_item": ("bundle:",), "notification": ("boot:",), "user": ("boot:", "list:users"),
}


def scope_key(user: dict) -> str:
    return f"{user['company_id']}:{','.join(sorted(user.get('project_scope') or []))}"


async def cached(key: str, ttl: float, compute):
    use_redis = os.environ.get("REDIS_URL")
    if use_redis:
        from services import cache
        hit = await cache.get("ttl:" + key)
    else:
        hit = get(key)
    if hit is not None:
        HITS["hit"] += 1
        return hit
    HITS["miss"] += 1
    val = await compute()
    if use_redis:
        from services import cache
        await cache.set("ttl:" + key, json.loads(json.dumps(val, default=str)), max(1, int(ttl)))
    else:
        put(key, val, ttl)
    return val


def _subscribe():
    from events import bus

    @bus.subscribe("entity.changed")
    async def _invalidate(evt: dict):
        for p in _ENTITY_PREFIXES.get(evt.get("entity_type"), ()):
            invalidate(p)
        if os.environ.get("REDIS_URL"):
            from services import cache
            for p in _ENTITY_PREFIXES.get(evt.get("entity_type"), ()):
                await cache.delete("ttl:" + p)


_subscribe()
