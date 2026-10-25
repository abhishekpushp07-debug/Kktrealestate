"""Single-leader background jobs: a Mongo lease (`locks` collection) makes sure one process across all workers/instances
runs the schedulers. Non-leaders poll and take over when the lease expires."""
import asyncio
import logging
import os
import socket
from datetime import UTC, datetime, timedelta

from db import db

log = logging.getLogger("kkt.leader")
ME = f"{socket.gethostname()}:{os.getpid()}"
TTL = 60


async def try_acquire(name: str) -> bool:
    now = datetime.now(UTC)
    try:
        await db.locks.update_one({"name": name, "$or": [{"owner": ME}, {"expires_at": {"$lt": now}}]}, {"$set": {"owner": ME, "expires_at": now + timedelta(seconds=TTL)}}, upsert=True)
    except Exception:  # duplicate key: someone else holds it
        return False
    doc = await db.locks.find_one({"name": name}, {"_id": 0, "owner": 1})
    return bool(doc and doc["owner"] == ME)


async def run_as_leader(name: str, *coros):
    """Runs `coros` (long-lived loops) only while this process holds the lease; cancels them when the lease is lost."""
    tasks = []
    while True:
        leader = await try_acquire(name)
        if leader and not tasks:
            log.info("[leader] %s acquired %s", ME, name)
            tasks = [asyncio.create_task(c()) for c in coros]
        elif not leader and tasks:
            log.info("[leader] %s lost %s", ME, name)
            for t in tasks:
                t.cancel()
            tasks = []
        await asyncio.sleep(TTL / 3)
