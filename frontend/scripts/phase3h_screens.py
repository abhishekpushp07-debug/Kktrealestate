"""Phase 3H REQ-350 proof: every report on the sheet in Light and Night at 1440 and 390 px, with horizontal overflow
measured per screen (phone sweep). Usage: API_URL=… ADMIN_PW=… python phase3h_screens.py <BASE>
→ /app/memory/qa/phase3h/screens/*.png + sweep.md; exit 1 on any horizontal overflow."""

import asyncio
import os
import sys

import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
API = os.environ["API_URL"]
OUT = "/app/memory/qa/phase3h/screens"
EMAIL, PW = os.environ.get("EMAIL", "admin@kkt.in"), os.environ["ADMIN_PW"]
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")}


def token():
    r = requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PW}, headers=BYPASS, timeout=30)
    return r.json()["access_token"]


def keys(tok):
    r = requests.get(f"{API}/api/reports/v3", headers={"Authorization": f"Bearer {tok}"}, timeout=60).json()
    return [t["key"] for seg in r["segments"] for t in seg["tiles"]]


async def login(page):
    await page.goto(f"{BASE}/login")
    await page.get_by_test_id("login-email-input").fill(EMAIL)
    await page.get_by_test_id("login-password-input").fill(PW)
    await page.locator("[data-testid=login-form] button[type=submit]").click()
    await page.wait_for_selector("[data-testid=topbar]", timeout=30000)


async def shoot(pw, theme, width, ks, results):
    tok = token()
    requests.patch(
        f"{API}/api/auth/me/preferences", json={"theme": theme}, headers={"Authorization": f"Bearer {tok}"}, timeout=30
    )
    browser = await pw.chromium.launch()
    ctx = await browser.new_context(viewport={"width": width, "height": 900 if width > 500 else 844})
    await ctx.add_init_script(f"localStorage.setItem('kkt:theme', '{theme}')")
    page = await ctx.new_page()
    await login(page)
    for k in ks:
        await page.goto(f"{BASE}/reports/v3/{k}")
        try:
            await page.wait_for_load_state("networkidle", timeout=30000)
        except Exception:  # noqa: BLE001
            pass
        await page.wait_for_timeout(500)
        sw = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        results.append((theme, width, k, sw))
        await page.screenshot(path=f"{OUT}/{theme}-{width}-{k}.jpeg", quality=40)
    await browser.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    ks = keys(token())
    results = []
    async with async_playwright() as pw:
        for theme in ("day", "night"):
            for width in (1440, 390):
                await shoot(pw, theme, width, ks, results)
    bad = [r for r in results if r[3] > 0]
    lines = [f"# 3H screens + phone sweep — {len(ks)} reports × Day (Light)/Night × 1440/390 = {len(results)} shots", ""]
    lines += [f"**{'PASS' if not bad else 'FAIL'}** — {len(bad)} screens with horizontal overflow", ""]
    lines += ["| Theme | Width | Report | Overflow px |", "|---|---:|---|---:|"]
    lines += [f"| {t} | {w} | {k} | {s} |" for t, w, k, s in results]
    open("/app/memory/qa/phase3h/sweep.md", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:3]))
    sys.exit(1 if bad else 0)


asyncio.run(main())
