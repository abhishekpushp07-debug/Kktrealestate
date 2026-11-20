"""Q4: warm login → first Home widget with content, same tab, N runs (median). Usage: login_timing.py <base> [runs]"""

import asyncio
import json
import os
import statistics
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]  # demo staff password, never in source

FIRST = """() => new Promise(res => { const t0 = performance.now(); const f = () => {
  const s = [...document.querySelectorAll("[data-testid='home-grid'] > section")].find(e => e.getAttribute('aria-busy') !== 'true' && !e.querySelector('.animate-pulse'));
  s ? res(Math.round(performance.now() - t0)) : requestAnimationFrame(f); }; f(); })"""


async def main():
    base, runs = sys.argv[1].rstrip("/"), int(sys.argv[2]) if len(sys.argv) > 2 else 6
    out = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 1440, "height": 900})
        await pg.goto(base + "/login")
        for i in range(runs):
            await pg.wait_for_selector("input[type=email]", timeout=30000)
            await pg.fill("input[type=email]", ("admin@kkt.in", "accounts@kkt.in")[i % 2])  # a different user each time
            await pg.fill("input[type=password]", PW)
            t = asyncio.ensure_future(pg.evaluate(FIRST))
            await pg.keyboard.press("Enter")
            out.append(await t)
            await pg.wait_for_timeout(800)
            await pg.click("[data-testid='user-menu']")
            await pg.click("[data-testid='menu-logout']")
            await pg.wait_for_timeout(3000 if i % 3 == 2 else 600)  # stay under the login rate limit
        await br.close()
    print(json.dumps({"runs_ms": out, "median_ms": statistics.median(out[1:] or out), "first_cold_ms": out[0]}))


asyncio.run(main())
