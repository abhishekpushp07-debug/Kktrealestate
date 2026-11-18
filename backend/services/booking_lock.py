"""Phase 3G: one writer per booking across every process / replica (Mongo lease in `locks`, re-entrant per task).
Money flows that read-then-write a booking (post receipt, cancel, waiver decisions, ledger rebuild) run inside it, so a
second replica can never interleave with the first. A crashed holder's lease expires after LEASE_S."""

import asyncio
import contextvars
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from pymongo.errors import DuplicateKeyError

from core.errors import ApiError
from db import db

LEASE_S = 30
_held: contextvars.ContextVar[frozenset] = contextvars.ContextVar("booking_locks_held", default=frozenset())


def _me(name: str) -> tuple:
    # a task spawned inside the lock copies this context, but it is another task: it must take the lock itself
    return (name, id(asyncio.current_task()))


async def _try(name: str, token: str) -> bool:
    now = datetime.now(UTC)
    try:
        await db.locks.update_one(
            {"name": name, "expires_at": {"$lt": now}},
            {"$set": {"owner": token, "expires_at": now + timedelta(seconds=LEASE_S)}},
            upsert=True,
        )
        return True
    except DuplicateKeyError:
        return False


@asynccontextmanager
async def booking_lock(booking_id: str, wait_s: float = 20.0):
    name = f"booking:{booking_id}"
    if _me(name) in _held.get():
        yield
        return
    token = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_s
    delay = 0.005
    while not await _try(name, token):
        if loop.time() > deadline:
            raise ApiError(409, "This booking is being updated by someone else — try again in a moment", "BOOKING_BUSY")
        await asyncio.sleep(delay)
        delay = min(delay * 2, 0.1)
    reset = _held.set(_held.get() | {_me(name)})
    try:
        yield
    finally:
        _held.reset(reset)
        await db.locks.delete_one({"name": name, "owner": token})
