"""D-10 proof: Edit project → Photos manager (SGH), Night 1440 → memory/qa/phase3/screens/elite-project-photos-night-1440.png."""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

OUT = os.path.join(os.path.dirname(__file__), "../../memory/qa/phase3/screens")


async def main(base, pid):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await (await br.new_context(viewport={"width": 1440, "height": 900})).new_page()
        await pg.goto(base + "/login")
        await pg.fill("input[type=email]", "admin@kkt.in")
        await pg.fill("input[type=password]", os.environ["KKT_DEMO_PASSWORD"])
        await pg.keyboard.press("Enter")
        await pg.wait_for_selector("[data-testid='home-grid']", timeout=60000)
        await pg.evaluate("() => document.querySelector('[data-testid=theme-night]')?.click()")
        await pg.goto(f"{base}/projects/{pid}")
        await pg.click("[data-testid='edit-setup-btn']")
        pass
        await pg.wait_for_selector("[data-testid='project-photos']", timeout=20000)
        await pg.locator("[data-testid='project-photos']").scroll_into_view_if_needed()
        await pg.wait_for_timeout(1200)
        f = os.path.join(OUT, "elite-project-photos-night-1440.png")
        await pg.screenshot(path=f)
        print(f)
        await br.close()


asyncio.run(main(sys.argv[1].rstrip("/"), sys.argv[2]))
