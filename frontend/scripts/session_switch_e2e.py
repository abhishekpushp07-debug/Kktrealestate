"""Q1 e2e: one tab, no reload — Owner → logout → Sales sees only Sales widgets and no ₹; Sales → logout → Accounts.
Usage: session_switch_e2e.py <base>. Exit 1 on any leak."""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]  # demo staff password, never in source
SALES = {"call_today", "pipeline", "inventory", "flat_status"}
ACCOUNTS = {"money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "attention"}


async def login(pg, email):
    await pg.wait_for_selector("input[type=email]", timeout=30000)
    await pg.fill("input[type=email]", email)
    await pg.fill("input[type=password]", PW)
    await pg.keyboard.press("Enter")
    await pg.wait_for_selector("[data-testid='home-grid'] section[data-testid^='widget-']", timeout=40000)
    await pg.wait_for_timeout(1500)  # let any stale cache flash render if it exists


async def widgets(pg):
    ids = await pg.eval_on_selector_all(
        "[data-testid='home-grid'] > section[data-testid^='widget-']", "els => els.map(e => e.dataset.testid)"
    )
    return {i.removeprefix("widget-") for i in ids}


async def logout(pg):
    await pg.click("[data-testid='user-menu']", timeout=10000)
    await pg.click("[data-testid='menu-logout']", timeout=10000)


async def main():
    base = sys.argv[1].rstrip("/")
    res, ok = {}, True
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 1440, "height": 900})
        await pg.goto(base + "/login")
        await login(pg, "admin@kkt.in")
        res["owner"] = sorted(await widgets(pg))
        for email, want, money in (("sales@kkt.in", SALES, False), ("accounts@kkt.in", ACCOUNTS, True)):
            await logout(pg)
            await login(pg, email)
            got = await widgets(pg)
            text = await pg.inner_text("[data-testid='home-grid']")
            leak = got - want
            res[email] = {"widgets": sorted(got), "extra": sorted(leak), "has_rupee": "₹" in text}
            ok &= not leak and got == want and (money or "₹" not in text)
        await br.close()
    print(json.dumps({"ok": ok, **res}, indent=1))
    sys.exit(0 if ok else 1)


asyncio.run(main())
