import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); p = await b.new_page(viewport={"width": 1440, "height": 1000})
        await p.goto(f"{BASE}/login")
        await p.get_by_test_id("login-email-input").fill("admin@kkt.in")
        await p.get_by_test_id("login-password-input").fill(os.environ["ADMIN_PW"])
        await p.locator("[data-testid=login-form] button[type=submit]").click()
        await p.wait_for_selector("[data-testid=home-grid]", timeout=30000)
        for i in range(3):
            await p.reload()
            await p.wait_for_selector("[data-testid=home-grid] section:not([aria-busy=true])", timeout=30000)
            first = await p.evaluate("performance.now()")
            await p.wait_for_function("!document.querySelector('[aria-busy=true][data-testid^=widget-]')")
            alld = await p.evaluate("performance.now()")
            res = await p.evaluate("""() => performance.getEntriesByType('resource').filter(r => /\\/api\\/|\\.js$/.test(r.name)).map(r => [r.name.replace(/^https?:\\/\\/[^/]+/, '').slice(0,60), Math.round(r.startTime), Math.round(r.responseEnd)])""")
            nav = await p.evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; return [Math.round(n.responseEnd), Math.round(n.domContentLoadedEventEnd)] })()")
            print(json.dumps({"first": round(first), "all": round(alld), "nav": nav, "res": res}))
        await b.close()
asyncio.run(main())
