"""REQ-111: non-critical follow-up work (audit surface snapshots, auto documents) runs after the response is sent.

Inside a request, `defer(key, fn, item)` queues `fn(items)`; the same key in one request is coalesced (items accumulate,
the last fn wins). The middleware hands the queue to `flush()` once the response is ready; batches from all requests run
one at a time, in arrival order. Outside a request (jobs, seeders, tests calling services directly) the work runs inline."""

import asyncio
import logging
from contextvars import ContextVar

PENDING: ContextVar[dict | None] = ContextVar("kkt_after_commit", default=None)
_TASKS: set[asyncio.Task] = set()
_LOCK: list[asyncio.Lock] = []
log = logging.getLogger("kkt.after_commit")


async def defer(key, fn, item=None):
    q = PENDING.get()
    if q is None:
        await fn([item] if item is not None else [])
        return
    prev = q.pop(key, None)
    items = (prev[1] if prev else []) + ([item] if item is not None else [])
    q[key] = (fn, items)


def _lock() -> asyncio.Lock:
    if not _LOCK:
        _LOCK.append(asyncio.Lock())
    return _LOCK[0]


def flush(q: dict | None):
    if not q:
        return
    batch = list(q.values())

    async def run():
        async with _lock():
            for fn, items in batch:
                try:
                    await fn(items)
                except Exception:  # noqa: BLE001 — follow-up work never fails the request that queued it
                    log.exception("after-commit task failed")

    t = asyncio.create_task(run())
    _TASKS.add(t)
    t.add_done_callback(_TASKS.discard)


async def drain(timeout: float = 30.0) -> int:
    """Wait for queued follow-up work (shutdown, /api/health?drain, tests). Returns the number still pending."""
    if _TASKS:
        await asyncio.wait(list(_TASKS), timeout=timeout)
    return len(_TASKS)
