"""Phase 3E proof: Day (light) + Night screenshots at 1440 and 390 px of every new / changed 3E screen."""

import asyncio
import json
import os
import sys

import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
API = os.environ["API_URL"]
OUT = "/app/memory/qa/phase3e/screens"
EMAIL, PW = os.environ.get("EMAIL", "admin@kkt.in"), os.environ["ADMIN_PW"]


def token():
    return requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30).json()["access_token"]


def pick(tok):  # the demo booking that carries the 3E waivers (tools/demo_3e.py)
    h = {"Authorization": f"Bearer {tok}"}
    w = requests.get(f"{API}/api/waivers", headers=h, params={"status": "Pending"}, timeout=30).json()["items"][0]
    b = requests.get(f"{API}/api/bookings/{w['booking_id']}", headers=h, timeout=30).json()
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
        if name == "booking-waivers":  # the 3E panel sits under the bills table
            await page.get_by_test_id("waivers-panel").scroll_into_view_if_needed()
            await page.wait_for_timeout(300)
        sw = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        attr = await page.evaluate("document.documentElement.dataset.theme")
        results.append({"theme": theme, "width": width, "screen": name, "h_overflow_px": sw, "data_theme": attr})
        await page.screenshot(path=f"{OUT}/{theme}-{width}-{name}.png")
    await browser.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    bid, cid = pick(token())
    screens = [
        ("home", "/dashboard"),
        ("booking-waivers", f"/bookings/{bid}?tab=bills"),
        ("booking-overview-discount", f"/bookings/{bid}"),
        ("discount-register", "/reports/discount-register?from_date=2025-04-01"),
        ("waiver-register", "/reports/waiver-register?from_date=2025-04-01"),
        ("customer360-lifecycle", f"/customers/{cid}"),
        ("service-requests", "/service-requests"),
        ("roznamcha", "/roznamcha"),
        ("booking-wizard", "/bookings/new"),
    ]
    results = []
    async with async_playwright() as pw:
        for theme in ("light", "night"):  # light = Day
            for width in (1440, 390):
                await shoot(pw, theme, width, screens, results)
    tok = token()
    requests.patch(
        f"{API}/api/auth/me/preferences", json={"theme": "light"}, headers={"Authorization": f"Bearer {tok}"}, timeout=30
    )
    json.dump(results, open(f"{OUT}/results.json", "w"), indent=1)
    print(json.dumps(results))


asyncio.run(main())
