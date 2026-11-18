"""axe-core colour-contrast + full AA run on booking detail and Customer 360, Light and Night. Usage: axe_check.py <base>"""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
PW = os.environ["KKT_DEMO_PASSWORD"]  # demo staff password, never in source


async def main():
    base = sys.argv[1].rstrip("/")
    out = {}
    async with async_playwright() as p:
        br = await p.chromium.launch()
        pg = await br.new_page(viewport={"width": 1440, "height": 900})
        await pg.goto(base + "/login")
        await pg.fill("input[type=email]", "admin@kkt.in")
        await pg.fill("input[type=password]", PW)
        await pg.keyboard.press("Enter")
        await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
        import urllib.request

        def api(path, body=None, tok=None):
            req = urllib.request.Request(base + "/api" + path, data=json.dumps(body).encode() if body else None)
            req.add_header("Content-Type", "application/json")
            req.add_header("User-Agent", "Mozilla/5.0 kkt-axe")
            if tok:
                req.add_header("Authorization", f"Bearer {tok}")
            return json.load(urllib.request.urlopen(req, timeout=30))

        tok = api("/auth/login", {"email": "admin@kkt.in", "password": PW})["access_token"]
        bid = api("/bookings?page_size=1&status=Active", tok=tok)["items"][0]
        pages = {}
        if bid:
            pages["booking"] = f"/bookings/{bid['id']}"
            pages["customer360"] = f"/customers/{bid['customer_id']}"
        for theme in ("light", "night"):
            for name, path in pages.items():
                await pg.evaluate(f"() => localStorage.setItem('kkt:theme', '{theme}')")
                await pg.goto(base + path)
                await pg.evaluate(f"() => document.documentElement.setAttribute('data-theme', '{theme}')")
                await pg.wait_for_load_state("networkidle")
                await pg.wait_for_timeout(1200)  # entrance animations settle before measuring
                await pg.add_script_tag(url=AXE)
                res = await pg.evaluate(
                    "async () => { const r = await axe.run(document, {runOnly: ['wcag2a','wcag2aa']});"
                    " return r.violations.map(v => ({id: v.id, n: v.nodes.length,"
                    " targets: v.nodes.slice(0,4).map(x => x.target.join(' ')), summary: v.nodes[0]?.failureSummary?.slice(0,160)})); }"
                )
                out[f"{name}-{theme}"] = res
        await br.close()
    print(json.dumps(out, indent=1))


asyncio.run(main())
