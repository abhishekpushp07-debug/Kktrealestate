"""Phase 2D proof: Home as Owner / Accounts / Sales / Site engineer × Light / Night × 1440 / 390 px + timing."""

import asyncio
import json
import os
import sys

import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1]
OUT = "/app/memory/qa/phase2/screens"
PW = os.environ["ADMIN_PW"]
ROLES = {"owner": "admin@kkt.in", "accounts": "accounts@kkt.in", "sales": "sales@kkt.in", "siteengineer": "siteengineer@kkt.in"}


def set_theme(email, theme):
    import time

    for _ in range(8):  # login rate limiter: back off and retry
        r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PW}, timeout=30).json()
        if "access_token" in r:
            break
        time.sleep(15)
    t = r["access_token"]
    requests.patch(f"{BASE}/api/auth/me/preferences", json={"theme": theme}, headers={"Authorization": f"Bearer {t}"}, timeout=30)


async def shot(pw, role, email, theme, width, res):
    if os.path.exists(f"{OUT}/home-{role}-{theme}-{width}.png") and os.environ.get("RESUME"):
        return
    set_theme(email, theme)
    b = await pw.chromium.launch()
    ctx = await b.new_context(viewport={"width": width, "height": 1000 if width > 500 else 844})
    await ctx.add_init_script(f"localStorage.setItem('kkt:theme', '{theme}')")
    p = await ctx.new_page()
    for attempt in range(5):  # the login rate limiter may refuse a burst of role logins: back off
        await p.goto(f"{BASE}/login")
        await p.get_by_test_id("login-email-input").fill(email)
        await p.get_by_test_id("login-password-input").fill(PW)
        await p.locator("[data-testid=login-form] button[type=submit]").click()
        try:
            await p.wait_for_selector("[data-testid=topbar]", timeout=15000)
            break
        except Exception:
            await p.wait_for_timeout(20000)
    await p.goto(f"{BASE}/dashboard")
    await p.wait_for_selector("[data-testid=home-grid]", timeout=30000)
    await p.wait_for_function("!document.querySelector('[aria-busy=true][data-testid^=widget-]')", timeout=30000)
    await p.wait_for_timeout(400)
    # warm reload timing: first widget content and all widgets
    t = await p.evaluate("""async () => {
        const t0 = performance.now(); location.reload(); return t0; }""")
    await p.wait_for_selector("[data-testid=home-grid] section:not([aria-busy=true])", timeout=30000)
    first = await p.evaluate("performance.now()")
    await p.wait_for_function("!document.querySelector('[aria-busy=true][data-testid^=widget-]')", timeout=30000)
    alldone = await p.evaluate("performance.now()")
    ids = await p.evaluate("[...document.querySelectorAll('[data-testid^=widget-]')].map(e=>e.dataset.testid).filter(x=>!x.includes('-',7))")
    sw = await p.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    res.append({"role": role, "theme": theme, "width": width, "first_content_ms": round(first), "all_widgets_ms": round(alldone), "h_overflow_px": sw, "widgets": ids})
    await p.screenshot(path=f"{OUT}/home-{role}-{theme}-{width}.png", full_page=True)
    await b.close()


async def main():
    res = []
    async with async_playwright() as pw:
        for role, email in ROLES.items():
            for theme in ("light", "night"):
                for width in (1440, 390):
                    await shot(pw, role, email, theme, width, res)
            set_theme(email, "light")
    json.dump(res, open(f"{OUT}/home_results.json", "w"), indent=1)
    print(json.dumps(res))


asyncio.run(main())
