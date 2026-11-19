"""3I dev loop: cProfile one write (POST /api/payments, cash ₹1,000, auto allocation) in-process on a scratch DB.
Usage: python tools/profile_write.py kkt_w   (never on preview / production)"""

import asyncio
import cProfile
import logging
import os
import pstats
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = sys.argv[1]
assert sys.argv[1].startswith(("kkt_w", "kkt_perf")), "scratch databases only"


CMDS: list = []


def _listen():
    from pymongo import monitoring

    class L(monitoring.CommandListener):
        def started(self, e):
            CMDS.append((e.command_name, next(iter(e.command.values())) if e.command else "", time.perf_counter()))

        def succeeded(self, e):
            CMDS.append(("ok", e.duration_micros, time.perf_counter()))

        def failed(self, e):
            pass

    monitoring.register(L())


async def main():
    _listen()
    logging.disable(logging.CRITICAL)
    import httpx

    from db import db
    from deps import create_access_token
    from server import app

    u = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0})
    b = await db.bookings.find_one({"company_id": u["company_id"], "status": "Active"}, {"_id": 0, "id": 1})
    mode = await db.payment_modes.find_one({"code": "CASH"}, {"_id": 0, "id": 1})
    h = {"Authorization": f"Bearer {create_access_token(u)}", "X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
    body = {"booking_id": b["id"], "amount": 1000, "payment_date": "2026-11-18", "payment_mode_id": mode["id"]}
    body |= {"allocation": "auto", "remarks": "perf"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://p", timeout=60) as c:
        for i in range(4):
            pr = cProfile.Profile() if i == 3 else None
            pr and pr.enable()
            CMDS.clear()
            a = time.perf_counter()
            r = await c.post("/api/payments", json=body, headers=h | {"Idempotency-Key": os.urandom(8).hex()})
            print(r.status_code, f"{1000 * (time.perf_counter() - a):.0f} ms")
            pr and pr.disable()
    from collections import Counter

    starts = [(n, c) for n, c, _ in CMDS if n != "ok"]
    us = sum(c for n, c, _ in CMDS if n == "ok")
    print(len(starts), "commands,", us // 1000, "ms inside mongod")
    print(Counter(f"{n}:{c}" for n, c in starts).most_common(40))


asyncio.run(main())
