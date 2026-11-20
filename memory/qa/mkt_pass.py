import asyncio, json, os, time
from playwright.async_api import async_playwright

BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
OUT = "/app/memory/qa/after"
PAGES = [("mkt_home", "/"), ("mkt_projects", "/projects"), ("mkt_project_SGH", "/projects/shree-ganesh-heights"), ("mkt_contact", "/contact")]

async def run():
    res = {}
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for w, label in [(1440, "1440"), (390, "390")]:
            ctx = await b.new_context(viewport={"width": w, "height": 900 if w > 400 else 844}, device_scale_factor=1)
            for name, path in PAGES:
                page = await ctx.new_page()
                logs, reqs, bytes_ = [], [], 0
                page.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("warning", "error") else None)
                page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
                def on_resp(r):
                    nonlocal bytes_
                    reqs.append(r.url)
                    try: bytes_ += int(r.headers.get("content-length") or 0)
                    except Exception: pass
                page.on("response", on_resp)
                t0 = time.time()
                await page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=60000)
                idle = round((time.time() - t0) * 1000)
                await page.wait_for_timeout(600)
                await page.screenshot(path=f"{OUT}/{name}_{label}.png", full_page=False)
                sw = await page.evaluate("document.documentElement.scrollWidth")
                h1 = await page.evaluate("document.querySelectorAll('h1').length")
                iframes = await page.evaluate("document.querySelectorAll('iframe').length")
                res[f"{name}_{label}"] = {"idle_ms": idle, "requests": len(reqs), "kb": round(bytes_ / 1024), "scrollWidth": sw, "h1": h1, "iframes": iframes, "console": logs}
                await page.close()
            await ctx.close()
        await b.close()
    print(json.dumps(res, indent=1))

asyncio.run(run())
