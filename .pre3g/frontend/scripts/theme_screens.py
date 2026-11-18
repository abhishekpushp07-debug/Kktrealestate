"""Phase 2B/2C proof: Light + Night screenshots at 1440 and 390 px of the key screens; search timing on screen."""

import asyncio
import json
import os
import sys

import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
API = os.environ["API_URL"]
OUT = "/app/memory/qa/phase2/screens"
EMAIL, PW = os.environ.get("EMAIL", "admin@kkt.in"), os.environ["ADMIN_PW"]


def token():
    return requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30).json()["access_token"]


def pick(tok):
    h = {"Authorization": f"Bearer {tok}"}
    b = requests.get(f"{API}/api/bookings", headers=h, params={"page_size": 1, "status": "Active"}, timeout=30).json()
    b = (b.get("items") or b.get("rows"))[0]
    return b["id"], b["customer_id"]


async def login(page):
    await page.goto(f"{BASE}/login")
    await page.get_by_test_id("login-email-input").fill(EMAIL)
    await page.get_by_test_id("login-password-input").fill(PW)
    await page.locator("[data-testid=login-form] button[type=submit]").click()
    await page.wait_for_selector("[data-testid=topbar]", timeout=30000)


async def shoot(pw, theme, width, screens, results):
    tok = token()
    requests.patch(
        f"{API}/api/auth/me/preferences", json={"theme": theme}, headers={"Authorization": f"Bearer {tok}"}, timeout=30
    )
    browser = await pw.chromium.launch()
    ctx = await browser.new_context(viewport={"width": width, "height": 900 if width > 500 else 844})
    await ctx.add_init_script(f"localStorage.setItem('kkt:theme', '{theme}')")
    page = await ctx.new_page()
    await page.goto(f"{BASE}/login")
    await page.wait_for_selector("[data-testid=login-form]")
    await page.screenshot(path=f"{OUT}/{theme}-{width}-login.png")
    await login(page)
    for name, path in screens:
        await page.goto(f"{BASE}{path}")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(700)
        sw = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        attr = await page.evaluate("document.documentElement.dataset.theme")
        results.append({"theme": theme, "width": width, "screen": name, "h_overflow_px": sw, "data_theme": attr})
        await page.screenshot(path=f"{OUT}/{theme}-{width}-{name}.png")
    if width > 500:
        await page.keyboard.press("Control+k")
        box = page.get_by_test_id("command-palette-input")
        await box.wait_for()
        for q in ("Rah", "A-1", "BK", "zzqx"):
            await box.fill("")
            t0 = await page.evaluate("performance.now()")
            await box.fill(q)
            await page.wait_for_function(
                "document.querySelector('[data-testid=command-palette-list]')?.dataset.searchMs !== ''"
                " || !!document.querySelector('[data-testid=palette-no-match]')",
                timeout=5000,
            )
            ms = await page.evaluate(
                "document.querySelector('[data-testid=command-palette-list]').dataset.searchMs"
            )
            wall = await page.evaluate("performance.now()") - t0
            results.append({"theme": theme, "search": q, "shown_ms": ms, "wall_ms": round(wall)})
        await page.screenshot(path=f"{OUT}/{theme}-{width}-search.png")
    await browser.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    bid, cid = pick(token())
    screens = [
        ("home", "/dashboard"),
        ("booking", f"/bookings/{bid}"),
        ("customer360", f"/customers/{cid}"),
        ("bills-raised", "/demands"),
        ("roznamcha", "/roznamcha"),
        ("reports", "/reports"),
        ("masters", "/masters"),
    ]
    results = []
    async with async_playwright() as pw:
        for theme in ("light", "night"):
            for width in (1440, 390):
                await shoot(pw, theme, width, screens, results)
    tok = token()
    requests.patch(
        f"{API}/api/auth/me/preferences", json={"theme": "light"}, headers={"Authorization": f"Bearer {tok}"}, timeout=30
    )
    json.dump(results, open(f"{OUT}/results.json", "w"), indent=1)
    print(json.dumps(results))


asyncio.run(main())
