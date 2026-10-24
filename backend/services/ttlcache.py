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
