"""3I: background work on a request worker (after-commit snapshots, read-model flush) takes at most DUTY of the
process — after each step it rests in proportion to what the step took and lets in-flight requests finish first,
so a request never waits behind a batch."""

import asyncio
import os
import time

DUTY = float(os.environ.get("KKT_BG_DUTY", "0.5"))
IDLE_WAIT_S = 1.0  # a busy worker still gets its background work done: never wait longer than this per step
INFLIGHT = [0]  # requests being served by this process (ObservabilityMiddleware)


async def idle():
    end = time.perf_counter() + IDLE_WAIT_S
    while INFLIGHT[0] > 0 and time.perf_counter() < end:
        await asyncio.sleep(0.005)


async def breathe(t0: float) -> float:
    """Rest after a step that started at t0 (perf_counter); returns the next step's start."""
    took = time.perf_counter() - t0
    await asyncio.sleep(min(0.5, took * (1 - DUTY) / DUTY))
    await idle()
    return time.perf_counter()


def start() -> float:
    return time.perf_counter()
