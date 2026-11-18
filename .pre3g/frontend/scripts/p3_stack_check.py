"""390 px check: stacked ledger/table cards carry column labels and rows don't overlap. Usage: p3_stack_check.py <base>"""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]
IDS = json.load(open(os.path.join(os.path.dirname(__file__), "p3_ids.json")))
OUT = "/app/memory/qa/phase3/screens"
CHECK = """() => [...document.querySelectorAll('table.stack-table')].filter(t => t.offsetParent).map(t => {
  const tds = [...t.querySelectorAll('tbody td')];
  const rows = [...t.querySelectorAll('tbody tr')].map(r => r.getBoundingClientRect());
  let overlap = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i-1].bottom - 1) overlap++;
  return {id: t.dataset.testid || t.closest('[data-testid]')?.dataset.testid, cells: tds.length,
          labelled: tds.filter(td => td.dataset.label).length, overlap};
})"""


async def main():
    base = sys.argv[1].rstrip("/")
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 390, "height": 844})
        await pg.goto(base + "/login")
        await pg.fill("input[type=email]", "admin@kkt.in")
        await pg.fill("input[type=password]", PW)
        await pg.keyboard.press("Enter")
        await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
        for name, path in (
            ("booking-ledger", f"/bookings/{IDS['booking']}?tab=ledger"),
            ("booking-bills", f"/bookings/{IDS['booking']}?tab=bills"),
            ("c360-money", f"/customers/{IDS['customer']}?tab=money"),
        ):
            await pg.goto(base + path)
            await pg.wait_for_selector("table.stack-table tbody tr", timeout=30000)
            await pg.wait_for_timeout(1200)
            ov = await pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            print(name, "overflow", ov, json.dumps(await pg.evaluate(CHECK)))
            await pg.screenshot(path=f"{OUT}/{name}-light-390.png")
        await br.close()


asyncio.run(main())
