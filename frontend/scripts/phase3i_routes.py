"""Phase 3I REQ (Q-58): warm route-change time for 10 everyday routes — in-app navigation (history push), measured
from the push until the network is idle and the page's main region is painted. Usage: API_URL=… ADMIN_PW=…
python phase3i_routes.py <BASE> → /app/memory/qa/phase3i/routes.md"""

import asyncio
import os
import statistics
import sys
import time

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
EMAIL, PW = os.environ.get("EMAIL", "admin@kkt.in"), os.environ["ADMIN_PW"]
ROUTES = [
    "/",
    "/bookings",
    "/payments",
    "/customers",
    "/leads",
    "/inventory",
    "/reports/v3",
    "/reports/v3/collections",
    "/reports/v3/customer-status",
    "/admin/system-health",
]
PUSH = "p => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }"


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        page = await (await b.new_context(viewport={"width": 1440, "height": 900})).new_page()
        await page.goto(f"{BASE}/login")
        await page.get_by_test_id("login-email-input").fill(EMAIL)
        await page.get_by_test_id("login-password-input").fill(PW)
        await page.locator("[data-testid=login-form] button[type=submit]").click()
        await page.wait_for_selector("[data-testid=topbar]", timeout=30000)
        times = {r: [] for r in ROUTES}
        for rnd in range(4):  # round 0 warms the lazy chunks; rounds 1-3 are measured
            for r in ROUTES:
                t = time.perf_counter()
                await page.evaluate(PUSH, r)
                await page.wait_for_load_state("networkidle")
                await page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
                if rnd:
                    times[r].append(1000 * (time.perf_counter() - t))
        await b.close()
    lines = ["# 3I route change (warm, in-app navigation, 1440 px)", "", "| Route | median ms | max ms |", "|---|---|---|"]
    for r, v in times.items():
        lines.append(f"| `{r}` | {statistics.median(v):.0f} | {max(v):.0f} |")
    allv = [x for v in times.values() for x in v]
    lines += ["", f"All: median {statistics.median(allv):.0f} ms, max {max(allv):.0f} ms (network idle = every API call answered)."]
    open("/app/memory/qa/phase3i/routes.md", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


asyncio.run(main())
