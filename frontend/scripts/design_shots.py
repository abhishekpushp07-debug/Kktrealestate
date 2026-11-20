"""Design proof: Night/Day × 1440/390 of the redesigned screens → memory/qa/phase3/screens/design-*.png.
Usage: KKT_DEMO_PASSWORD=… python design_shots.py <base> [screen …]"""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

HERE = os.path.dirname(__file__)
def _live_ids():
    """IDs change on every demo reseed — resolve them from the live API instead of a saved file."""
    import requests

    api = sys.argv[1].rstrip("/") + "/api"
    t = requests.post(api + "/auth/login", json={"email": "admin@kkt.in", "password": os.environ["KKT_DEMO_PASSWORD"]}).json()
    h = {"Authorization": "Bearer " + (t.get("access_token") or t.get("token"))}
    g = lambda p, **k: requests.get(api + p, headers=h, params=k).json()["items"][0]["id"]  # noqa: E731
    return {
        "customer": g("/customers", card_segment="overdue30", page_size=1),
        "booking": g("/bookings", status="Active", page_size=1),
        "project": g("/projects", search="Shree Ganesh Heights", page_size=1),
    }


IDS = _live_ids()
OUT = os.path.join(HERE, "..", "..", "memory", "qa", "phase3", "screens")
PREFIX = os.environ.get("SHOT_PREFIX", "elite")
SCREENS = {
    "home": ("/home", "home-page"),
    "projects": ("/projects", "projects-page"),
    "customers": ("/customers", "customers-page"),
    "bookings": ("/bookings", "bookings-page"),
    "booking": (f"/bookings/{IDS['booking']}", "plan-timeline"),
    "customer360": (f"/customers/{IDS['customer']}", "key-strip"),
    "project": (f"/projects/{IDS['project']}", "project-workspace"),
    "reports": ("/reports", "hub-tile-outstanding-v2"),
    "report-outstanding": ("/reports/outstanding-v2", "report-formula"),
    "report-collections": ("/reports/collections-v2", "report-formula"),
    "report-band": ("/reports/outstanding-v2?bucket=90%2B", "report-formula"),
    "report-bills": ("/reports/demand-vs-collection", "report-bridge"),
    "payments": ("/payments", "payments-page"),
    "demands": ("/demands", "demands-page"),
    "leads": ("/leads", "leads-page"),
    "documents": ("/documents", "documents-page"),
    "construction": ("/construction", "page-title"),
    "customer-form": ("/customers/new", "page-title"),
    "wizard": ("/bookings/new", "page-title"),
    "payment-sheet": ("/payments?new=1", "post-payment-sheet"),
    "roznamcha": ("/roznamcha", "roznamcha-page"),
    "masters": ("/masters", "page-title"),
}


async def main(base, names):
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for w, h in ((1440, 900), (390, 844)):
            ctx = await br.new_context(viewport={"width": w, "height": h})
            pg = await ctx.new_page()
            await pg.goto(base + "/login")
            await pg.fill("input[type=email]", os.environ.get("KKT_SHOT_USER", "admin@kkt.in"))
            await pg.fill("input[type=password]", os.environ["KKT_DEMO_PASSWORD"])
            await pg.keyboard.press("Enter")
            await pg.wait_for_url(lambda u: "/login" not in u, timeout=60000)
            await pg.wait_for_timeout(2500)
            for theme in ("night", "day"):
                await pg.evaluate(f"() => document.querySelector('[data-testid=theme-{theme}]')?.click()")
                await pg.wait_for_timeout(800)
                for n in names:
                    path, ready = SCREENS[n]
                    await pg.goto(base + path)
                    try:
                        await pg.wait_for_selector(f"[data-testid='{ready}']", timeout=30000)
                    except Exception as e:  # noqa: BLE001
                        print("MISSING", n, ready, str(e)[:80])
                    await pg.wait_for_timeout(1200)
                    f = os.path.join(OUT, f"{PREFIX}-{os.environ.get('KKT_SHOT_TAG', '')}{n}-{theme}-{w}.png")
                    await pg.screenshot(path=f, full_page=False)
                    print(f)
            await ctx.close()
        await br.close()


asyncio.run(main(sys.argv[1].rstrip("/"), sys.argv[2:] or list(SCREENS)))
