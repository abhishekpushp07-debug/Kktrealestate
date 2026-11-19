"""Single-leader background jobs: a Mongo lease (`locks` collection) makes sure one process across all workers/instances
runs the schedulers. Non-leaders poll and take over when the lease expires.

3I fencing — a job never runs on two servers at once:
- the holder stops its jobs itself as soon as its own lease time may have run out (a stalled event loop, a slow
  database), without waiting to read that someone else has it;
- a process taking over a lease that another process held waits one renew interval + margin before starting jobs,
  so the old holder has seen it lost (and stopped) first."""

import asyncio
import contextvars
import logging
import os
import socket
import time
from datetime import UTC, datetime, timedelta

from db import db

log = logging.getLogger("kkt.leader")
ME = f"{socket.gethostname()}:{os.getpid()}"
TTL = float(os.environ.get("KKT_LEASE_TTL", "60"))
RENEW = TTL / 3
_MARGIN = min(5.0, TTL / 6)
SAFE = TTL - RENEW - _MARGIN  # past this since the last renewal, the holder no longer trusts its lease
GRACE = RENEW + _MARGIN  # a new holder of another process's lease waits this long before starting jobs
LEADER_OF: contextvars.ContextVar = contextvars.ContextVar("leader_of", default=None)  # set in the leader's jobs
_RENEWED: dict[str, float] = {}


class LeaseLost(Exception):
    """A leader job found this process can no longer vouch for its lease — it stops instead of risking a twin."""


def check():
    """Called where jobs start / between job items: raises LeaseLost in a leader job whose lease may have lapsed."""
    name = LEADER_OF.get()
    if name and time.monotonic() - _RENEWED.get(name, float("-inf")) > SAFE:
        raise LeaseLost(name)


async def try_acquire(name: str) -> tuple[bool, str | None]:
    """→ (holding, previous owner when this call took the lease over from another process)."""
    now = datetime.now(UTC)
    before = await db.locks.find_one({"name": name}, {"_id": 0, "owner": 1})
    try:
        await db.locks.update_one(
            {"name": name, "$or": [{"owner": ME}, {"expires_at": {"$lt": now}}]},
            {"$set": {"owner": ME, "expires_at": now + timedelta(seconds=TTL)}},
            upsert=True,
        )
    except Exception:  # duplicate key: someone else holds it
        logging.getLogger(__name__).debug("handled error", exc_info=True)
        return False, None
    doc = await db.locks.find_one({"name": name}, {"_id": 0, "owner": 1})
    held = bool(doc and doc["owner"] == ME)
    prev = (before or {}).get("owner")
    return held, (prev if held and prev and prev != ME else None)


async def run_as_leader(name: str, *coros):
    """Runs `coros` (long-lived loops) only while this process holds the lease; cancels them when it may not."""
    tasks: list = []
    renewed = 0.0

    def stop(why: str):
        nonlocal tasks
        if tasks:
            log.info("[leader] %s %s %s", ME, why, name)
            for t in tasks:
                t.cancel()
            tasks = []

    while True:
        if tasks and time.monotonic() - renewed > SAFE:
            stop("fenced (lease may have run out)")  # before any database round trip
        try:
            held, took_from = await try_acquire(name)
        except Exception:  # database unreachable: we cannot prove the lease
            log.debug("lease check failed", exc_info=True)
            held, took_from = False, None
        if held:
            renewed = _RENEWED[name] = time.monotonic()
            if took_from:
                log.info("[leader] %s took %s over from %s; waiting %ss", ME, name, took_from, GRACE)
                await asyncio.sleep(GRACE)
                continue  # renew again before starting anything
            if not tasks:
                log.info("[leader] %s acquired %s", ME, name)
                LEADER_OF.set(name)  # inherited by the job tasks created below
                tasks = [asyncio.create_task(c()) for c in coros]
                LEADER_OF.set(None)
        else:
            stop("lost")
        await asyncio.sleep(RENEW)
