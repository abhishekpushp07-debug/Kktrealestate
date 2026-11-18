"""F-42 root cause (2B/2C full run): a Home compute that started before a read-model flush finished after it and cached
the pre-flush totals for 10 s. An invalidate during a compute must never let that stale result be stored or shared."""

import asyncio

from services import ttlcache


def test_invalidate_during_compute_is_not_cached(monkeypatch):
    async def stamp():
        return "s"

    monkeypatch.setattr(ttlcache, "data_stamp", stamp)  # 3G: cached() keys carry the shared data stamp; fixed here

    async def go():
        key = "home:test-race"
        ttlcache.invalidate("home:test-race")
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_old():
            started.set()
            await release.wait()
            return "stale"

        first = asyncio.create_task(ttlcache.cached(key, 10, slow_old))
        await started.wait()
        ttlcache.invalidate("home:")  # the flush lands while the old compute is still running

        async def fresh():
            return "fresh"

        second = await ttlcache.cached(key, 10, fresh)  # must not join the pre-invalidation compute
        release.set()
        assert await first == "stale"  # its own caller still gets an answer
        assert second == "fresh"
        assert ttlcache.get(f"{key}|s") == "fresh"  # and the stale value never overwrote the cache

    asyncio.run(go())


def test_manual_put_skips_after_invalidate():
    gen = ttlcache.generation()
    ttlcache.invalidate("dash:")
    ttlcache.put("dash:test-race", "stale", 10, gen)
    assert ttlcache.get("dash:test-race") is None
    ttlcache.put("dash:test-race", "fresh", 10, ttlcache.generation())
    assert ttlcache.get("dash:test-race") == "fresh"
