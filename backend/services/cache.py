"""Optional Redis cache (REDIS_URL) with Mongo fallback (`cache` collection, TTL index). Used for the catalogue bundle,
report results and dashboard snapshots. Everything cached here is a derived value and safe to lose."""
import json
import os
from datetime import UTC, datetime, timedelta

from db import db

_redis = None
if os.environ.get("REDIS_URL"):
    try:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    except Exception:  # pragma: no cover
        _redis = None

MODE = "redis" if _redis else "mongo"


async def get(key: str):
    if _redis:
        v = await _redis.get(key)
        return json.loads(v) if v else None
    doc = await db.cache.find_one({"key": key, "expires_at": {"$gt": datetime.now(UTC)}}, {"_id": 0, "value": 1})
    return doc["value"] if doc else None


async def set(key: str, value, ttl_s: int):
    if _redis:
        await _redis.set(key, json.dumps(value, default=str), ex=ttl_s)
        return
    await db.cache.update_one({"key": key}, {"$set": {"value": value, "expires_at": datetime.now(UTC) + timedelta(seconds=ttl_s)}}, upsert=True)


async def delete(prefix: str):
    if _redis:
        async for k in _redis.scan_iter(f"{prefix}*"):
            await _redis.delete(k)
        return
    await db.cache.delete_many({"key": {"$regex": f"^{prefix}"}})
