"""Optional Redis cache (REDIS_URL) with Mongo fallback (`cache` collection, TTL index). Used for the catalogue bundle,
report results and dashboard snapshots. Everything cached here is a derived value and safe to lose.

3I: Redis is a shared layer only — never needed for money correctness. Every call is bounded (REDIS_TIMEOUT_MS,
default 50 ms); an error / timeout / full store parks Redis for 30 s and the caller carries on from Mongo / process
memory, logged at most once a minute. Commands are counted (today / this month) for the Upstash free-plan budget."""

import asyncio
import json
import logging
import os
import time
from datetime import UTC, datetime, timedelta

from db import db
from services import clock

log = logging.getLogger(__name__)
_redis = None
if os.environ.get("REDIS_URL"):
    try:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(
            os.environ["REDIS_URL"], decode_responses=True, socket_timeout=1, socket_connect_timeout=1
        )
    except Exception:  # pragma: no cover
        log.debug("handled error", exc_info=True)
        _redis = None

MODE = "redis" if _redis else "mongo"
TIMEOUT = float(os.environ.get("REDIS_TIMEOUT_MS", "50")) / 1000
MAX_VALUE = int(os.environ.get("REDIS_MAX_VALUE_BYTES", "900000"))  # Upstash free plan: 1 MB per request
STATE = {"down_until": 0.0, "last_log": 0.0, "last_error": None, "hits": 0, "misses": 0, "errors": 0, "commands": 0}
_pending = {"n": 0, "at": time.monotonic()}


def redis_on() -> bool:
    return _redis is not None and time.monotonic() >= STATE["down_until"]


async def _count(n: int = 1):
    """Commands this process sent, flushed to Mongo once a minute (System Health: today / month vs 500,000)."""
    STATE["commands"] += n
    _pending["n"] += n
    if time.monotonic() - _pending["at"] < 60:
        return
    k, _pending["n"], _pending["at"] = _pending["n"], 0, time.monotonic()
    day = clock.today().isoformat()
    await db.redis_usage.update_one({"day": day}, {"$inc": {"commands": k}}, upsert=True)


def _down(e: Exception):
    STATE["errors"] += 1
    STATE["down_until"] = time.monotonic() + 30
    STATE["last_error"] = f"{type(e).__name__}: {str(e)[:120]}"
    if time.monotonic() - STATE["last_log"] > 60:
        STATE["last_log"] = time.monotonic()
        log.warning("redis unavailable (%s) — serving from Mongo / process memory for 30 s", STATE["last_error"])


async def rget(key: str):
    """One GET. None on miss, outage or slowness."""
    if not redis_on():
        return None
    try:
        v = await asyncio.wait_for(_redis.get(key), TIMEOUT)
        await _count()
    except Exception as e:  # noqa: BLE001 — Redis is optional
        _down(e)
        return None
    STATE["hits" if v else "misses"] += 1
    return json.loads(v) if v else None


async def rset(key: str, value, ttl_s: int):
    """One SET with expiry; values over the per-request limit stay local."""
    if not redis_on():
        return
    s = json.dumps(value, default=str)
    if len(s) > MAX_VALUE:
        return
    try:
        await asyncio.wait_for(_redis.set(key, s, ex=max(1, int(ttl_s))), TIMEOUT * 4)
        await _count()
    except Exception as e:  # noqa: BLE001
        _down(e)


async def get(key: str):
    if _redis:
        return await rget(key)
    doc = await db.cache.find_one({"key": key, "expires_at": {"$gt": datetime.now(UTC)}}, {"_id": 0, "value": 1})
    return doc["value"] if doc else None


async def set(key: str, value, ttl_s: int):
    if _redis:
        await rset(key, value, ttl_s)
        return
    await db.cache.update_one(
        {"key": key},
        {"$set": {"value": value, "expires_at": datetime.now(UTC) + timedelta(seconds=ttl_s)}},
        upsert=True,
    )


async def delete(prefix: str):
    """Keys carry the shared data stamp, so a write never needs a Redis delete (old keys just expire)."""
    if _redis:
        return
    await db.cache.delete_many({"key": {"$regex": f"^{prefix}"}})


async def health() -> dict:
    """System Health card: state, hit rate, commands today / month vs the 500,000 free-plan budget."""
    day = clock.today().isoformat()
    rows = await db.redis_usage.find({"day": {"$gte": day[:8] + "01"}}, {"_id": 0}).to_list(None)
    month = sum(r["commands"] for r in rows) + _pending["n"]
    today = sum(r["commands"] for r in rows if r["day"] == day) + _pending["n"]
    looked = STATE["hits"] + STATE["misses"]
    return {
        "configured": _redis is not None,
        "state": "off" if _redis is None else ("ok" if redis_on() else "down — using Mongo"),
        "hit_rate": round(STATE["hits"] / looked, 3) if looked else None,
        "commands_today": today,
        "commands_month": month,
        "month_budget": 500_000,
        "last_error": STATE["last_error"],
    }
