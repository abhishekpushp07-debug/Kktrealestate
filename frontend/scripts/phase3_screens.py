"""Phase 3 chunk 3-1 proof: booking page, Customer 360, project page (+ owner's Ye) × Light/Night × 1440/390,
click → content timings (warm), horizontal overflow. Usage: phase3_screens.py <base>  (needs KKT_DEMO_PASSWORD)"""

import asyncio
import json
import os
import statistics
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]
OUT = "/app/memory/qa/phase3/screens"
IDS = json.load(open(os.path.join(os.path.dirname(__file__), "p3_ids.json")))
SCREENS = {
    "booking": (f"/bookings/{IDS['booking']}", "[data-testid='booking-overview']"),
    "customer360": (f"/customers/{IDS['customer']}", "[data-testid='c360-panel-overview']"),
    "project": (f"/projects/{IDS['project']}", "[data-testid='project-workspace'] [data-testid^='tower-card-']"),
    "project-ye": (f"/projects/{IDS['ye']}", "[data-testid='project-workspace']"),
}


async def main():
    base = sys.argv[1].rstrip("/")
    os.makedirs(OUT, exist_ok=True)
    res = {"timings_ms": {}, "overflow_px": {}}
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for theme in ("light", "night"):
            for w in (1440, 390):
                pg = await br.new_page(viewport={"width": w, "height": 900 if w > 400 else 844})
                await pg.goto(base + "/login")
                await pg.evaluate(f"() => localStorage.setItem('kkt:theme', '{theme}')")
                await pg.fill("input[type=email]", "admin@kkt.in")
                await pg.fill("input[type=password]", PW)
                await pg.keyboard.press("Enter")
                await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
                for name, (path, ready) in SCREENS.items():
                    times = []
                    for _ in range(3 if (theme, w) == ("light", 1440) else 1):
                        await pg.evaluate(f"() => window.history.pushState({{}}, '', '{path}')")
                        t0 = await pg.evaluate("() => performance.now()")
                        await pg.evaluate("() => window.dispatchEvent(new PopStateEvent('popstate'))")
                        await pg.wait_for_selector(ready, timeout=30000)
                        times.append(round(await pg.evaluate("() => performance.now()") - t0))
                        await pg.evaluate("() => window.history.pushState({}, '', '/dashboard')")
                        await pg.evaluate("() => window.dispatchEvent(new PopStateEvent('popstate'))")
                        await pg.wait_for_selector("[data-testid='home-grid']", timeout=30000)
                    await pg.evaluate(f"() => window.history.pushState({{}}, '', '{path}')")
                    await pg.evaluate("() => window.dispatchEvent(new PopStateEvent('popstate'))")
                    await pg.wait_for_selector(ready, timeout=30000)
                    await pg.evaluate(f"() => document.documentElement.setAttribute('data-theme', '{theme}')")
                    await pg.wait_for_timeout(900)
                    if (theme, w) == ("light", 1440):
                        res["timings_ms"][name] = {"runs": times, "median": statistics.median(times)}
                    res["overflow_px"][f"{name}-{theme}-{w}"] = await pg.evaluate(
                        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
                    )
                    await pg.screenshot(path=f"{OUT}/{name}-{theme}-{w}.png", full_page=False)
                await pg.close()
        await br.close()
    json.dump(res, open(f"{OUT}/results.json", "w"), indent=1)
    print(json.dumps(res))


asyncio.run(main())
