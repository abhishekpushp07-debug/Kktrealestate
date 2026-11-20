"""3I dev loop (read-only): in-process cold time of v3 reports on a DB, every cache cleared before each sample.
Usage: python tools/time_reports.py kkt_volume [key,key,...] [samples]"""

import asyncio
import logging
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = sys.argv[1] if len(sys.argv) > 1 else "kkt_volume"
os.environ["KKT_NO_SCHEDULER"] = "1"


async def main():
    logging.disable(logging.CRITICAL)
    import httpx

    from db import db
    from deps import create_access_token
    from reports_v3.registry import REGISTRY
    from server import app
    from services import ttlcache

    keys = sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] != "all" else list(REGISTRY)
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    u = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0})
    h = {"Authorization": f"Bearer {create_access_token(u)}"}
    out = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://p", timeout=120) as c:
        await c.get("/api/auth/me", headers=h)
        for k in keys:
            ms = []
            for _ in range(n):
                ttlcache.clear_all() if hasattr(ttlcache, "clear_all") else ttlcache._store.clear()
                a = time.perf_counter()
                r = await c.get(f"/api/reports/v3/{k}", headers=h, params={"page_size": 50})
                ms.append(1000 * (time.perf_counter() - a))
                assert r.status_code == 200, (k, r.status_code, r.text[:200])
            out.append((statistics.median(ms), k))
            print(f"{k:24} {statistics.median(ms):7.0f} ms  (min {min(ms):.0f})", flush=True)
    print("TOTAL", round(sum(m for m, _ in out)), "ms; slowest:", sorted(out, reverse=True)[:8])


asyncio.run(main())
