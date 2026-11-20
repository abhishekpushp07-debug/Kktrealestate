"""Read-only profiler for one Phase 3F report on a given DB (default kkt_volume): cold (fresh process cache) and warm
timings in-process, plus a cProfile of the cold run. GET requests only — no writes.
Run: python tools/profile_reports.py collections [kkt_volume]"""

import asyncio
import logging
import cProfile
import os
import pstats
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = sys.argv[2] if len(sys.argv) > 2 else "kkt_volume"
KEY = sys.argv[1]


async def main():
    logging.disable(logging.CRITICAL)
    import httpx

    from db import db
    from deps import create_access_token
    from server import app
    from services import ttlcache

    u = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0})
    h = {"Authorization": f"Bearer {create_access_token(u)}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://p") as c:
        await c.get("/api/auth/me", headers=h)  # warm imports / rbac
        ttlcache._store.clear() if hasattr(ttlcache, "_store") else None
        pr = cProfile.Profile()
        a = time.perf_counter()
        pr.enable()
        path = KEY if KEY.startswith("/") else f"/api/reports/v3/{KEY}"
        r = await c.get(path, headers=h, params={} if KEY.startswith("/") else {"page_size": 50})
        pr.disable()
        cold = 1000 * (time.perf_counter() - a)
        a = time.perf_counter()
        await c.get(path, headers=h)
        print(f"{KEY}: status {r.status_code} rows {r.json().get('count')} cold {cold:.0f} ms warm {1000 * (time.perf_counter() - a):.0f} ms")
    pstats.Stats(pr).sort_stats("cumulative").print_stats(r"(routers|services|reports_v3|motor)", 30)


asyncio.run(main())
