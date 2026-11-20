"""3-3 item (i): wizard cost-sheet (step 2) fits its card at 1440 and 390 — no clipped inputs, no sideways scroll."""

import asyncio
import sys

from playwright.async_api import async_playwright

FLAT, CUST = "eaf1dfc6-fa8d-4ce8-b0fe-aab507bdb16c", "c21a065a-0d70-4303-8305-d405b991f1b3"
CHECK = """() => {
  const t = document.querySelector('[data-testid=breakdown-table]');
  if (!t) return null;
  const card = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
  const clipped = [...t.querySelectorAll('input,button')].filter(e => { const b = e.getBoundingClientRect();
    return b.width > 0 && (b.right > card.right + 1 || b.width < 40); }).length;
  return {table: Math.round(r.width), card: Math.round(card.width), clipped,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
}"""


async def main(base):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for w in (1440, 390):
            pg = await br.new_page(viewport={"width": w, "height": 900})
            await pg.goto(base + "/login")
            await pg.fill("input[type=email]", "admin@kkt.in")
            await pg.fill("input[type=password]", "Kkt@12345")
            await pg.keyboard.press("Enter")
            await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
            await pg.goto(f"{base}/bookings/new?flat={FLAT}&customer_id={CUST}")
            await pg.wait_for_selector("[data-testid=wiz-next]", timeout=30000)
            await pg.wait_for_timeout(1500)
            await pg.click("[data-testid=wiz-next]")
            await pg.wait_for_selector("[data-testid=breakdown-table]", timeout=30000)
            await pg.wait_for_timeout(1500)
            print(w, await pg.evaluate(CHECK))
            await pg.locator("[data-testid=breakdown-table]").scroll_into_view_if_needed()
            await pg.screenshot(path=f"/app/memory/qa/phase3/screens/wizard-costsheet-light-{w}.png")
            await pg.close()
        await br.close()


asyncio.run(main(sys.argv[1].rstrip("/")))
