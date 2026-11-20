"""REQ-111: non-critical follow-up work (audit surface snapshots, auto documents) runs after the response is sent.

Inside a request, `defer(key, fn, item)` queues `fn(items)`; the same key in one request is coalesced (items accumulate,
the last fn wins). The middleware hands the queue to `flush()` once the response is ready; batches from all requests run
one at a time, in arrival order. Outside a request (jobs, seeders, tests calling services directly) the work runs inline."""

import asyncio
import logging
from contextvars import ContextVar

PENDING: ContextVar[dict | None] = ContextVar("kkt_after_commit", default=None)
_TASKS: set[asyncio.Task] = set()
_LOCK: dict[str, asyncio.Lock] = {}
log = logging.getLogger("kkt.after_commit")


async def defer(key, fn, item=None):
    q = PENDING.get()
    if q is None:
        await fn([item] if item is not None else [])
        return
    prev = q.pop(key, None)
    items = (prev[1] if prev else []) + ([item] if item is not None else [])
    q[key] = (fn, items)


def _lock(lane: str) -> asyncio.Lock:
    return _LOCK.setdefault(lane, asyncio.Lock())


def _lane(key) -> str:  # 3I: audit surface snapshots are heavy; letters / notifications never queue behind them
    return "snapshot" if isinstance(key, tuple) and key and key[0] == "snapshot" else "user"


def flush(q: dict | None):
    if not q:
        return
    for lane in ("user", "snapshot"):
        batch = [v for k, v in q.items() if _lane(k) == lane]
        if batch:
            _spawn(lane, batch)


def _spawn(lane: str, batch: list):
    async def run():
        from services import duty

        async with _lock(lane):
            await duty.idle()  # 3I: in-flight requests on this worker finish first (≤ 0.25 s)
            for fn, items in batch:
                try:
                    await fn(items)
                except Exception:
                    log.exception("after-commit task failed")

    t = asyncio.create_task(run())
    _TASKS.add(t)
    t.add_done_callback(_TASKS.discard)


async def drain(timeout: float = 30.0) -> int:
    """Wait for queued follow-up work (shutdown, /api/health?drain, tests). Returns the number still pending."""
    if _TASKS:
        from services import duty

        duty.INFLIGHT[0] -= 1  # 3I: a request waiting for background work must not hold that work back
        try:
            await asyncio.wait(list(_TASKS), timeout=timeout)
        finally:
            duty.INFLIGHT[0] += 1
    return len(_TASKS)
