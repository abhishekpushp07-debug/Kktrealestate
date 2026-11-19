"""Phase 3I: a scheduler job never runs on two servers at once. Two real processes share one lease (short TTL): the
first stalls its event loop past its lease; the second takes over. No job heartbeat of the first may come after the
second's first heartbeat — the first fences itself (leader.check in every job) instead of finishing a step twice."""

import os
import subprocess
import sys
import time
import uuid

from pymongo import MongoClient

from tests.conftest import TEST_DB

HERE = os.path.join(os.path.dirname(__file__), "..")

SCRIPT = r"""
import asyncio, os, sys, time
sys.path.insert(0, ".")
from db import db
from services import leader
LOCK, STALL, RUN_S = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
async def job():
    while True:
        leader.check()
        await db.fence_beats.insert_one({"lock": LOCK, "owner": leader.ME, "t": time.time()})
        await asyncio.sleep(0.25)
async def stall():
    if STALL:
        await asyncio.sleep(4)
        time.sleep(STALL)  # a blocked event loop (CPU-bound work, a swapping box)
async def main():
    asyncio.get_running_loop().create_task(stall())
    try:
        await asyncio.wait_for(leader.run_as_leader(LOCK, job), RUN_S)
    except asyncio.TimeoutError:
        pass
asyncio.run(main())
"""


def test_a_stalled_leader_never_runs_beside_the_new_one():
    lock = f"fence-{uuid.uuid4().hex[:8]}"
    env = {**os.environ, "DB_NAME": TEST_DB, "KKT_LEASE_TTL": "6", "KKT_JOB_SETTLE_S": "0"}
    run = lambda stall, secs: subprocess.Popen(  # noqa: E731
        [sys.executable, "-c", SCRIPT, lock, str(stall), str(secs)], cwd=HERE, env=env
    )
    a = run(12, 30)
    time.sleep(1.5)
    b = run(0, 30)
    assert a.wait(timeout=90) == 0 and b.wait(timeout=90) == 0
    db = MongoClient(os.environ["MONGO_URL"])[TEST_DB]
    beats = list(db.fence_beats.find({"lock": lock}, {"_id": 0}).sort("t", 1))
    db.fence_beats.delete_many({"lock": lock})  # the test's own rows
    db.locks.delete_many({"name": lock})
    owners = []
    for x in beats:
        if not owners or owners[-1] != x["owner"]:
            owners.append(x["owner"])
    assert len(set(owners)) == 2, owners  # the job moved to the second process
    assert len(owners) == 2, f"the job ran on both processes in turn more than once: {owners}"
    first, second = owners
    last_first = max(x["t"] for x in beats if x["owner"] == first)
    first_second = min(x["t"] for x in beats if x["owner"] == second)
    assert last_first < first_second
