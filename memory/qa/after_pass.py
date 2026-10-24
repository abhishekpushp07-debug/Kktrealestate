"""Phase 8A after-pass: screenshots at 1440 and 390 for the audited ERP pages + timings + overflow checks."""
import asyncio, json, sys, time
from playwright.async_api import async_playwright

BASE = "https://royal-realty-hub-2.preview.emergentagent.com"
OUT = "/app/memory/qa/after"
PAGES = [
    ("erp_login", "/erp/login", None), ("erp_dashboard", "/erp/dashboard", None), ("erp_projects", "/erp/projects", None),
    ("erp_project_SGH_detail", "/erp/projects/e677b47c-8eff-4678-80d9-09f4412fc5b9", None), ("erp_towerA_inventory", "/erp/blocks/05b195d4-402f-4f24-954e-988c9a7ec872", None),
    ("erp_bookings_list", "/erp/bookings", None), ("erp_payments_list", "/erp/payments", None), ("erp_reports", "/erp/reports", None), ("erp_report_outstanding", "/erp/reports/outstanding", None),
    ("erp_master_payment_plans", "/erp/master/payment-plans", None), ("erp_customers", "/erp/customers", None), ("erp_customer360", "/erp/customers/1c179390-185a-44fa-aed2-a34a4a398ada", None),
    ("erp_booking_BK0001_ledger", "/erp/bookings/473d1218-3478-42f9-bb10-3de2ccdae62f", "ledger"), ("erp_wizard_step1", "/erp/bookings/new", None), ("erp_wizard_step2_grid", "/erp/bookings/new", "wiz2"),
]


async def run():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w, label in ((1440, "1440"), (390, "390")):
            ctx = await b.new_context(viewport={"width": w, "height": 900 if w > 400 else 844}, device_scale_factor=1)
            page = await ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            await page.goto(f"{BASE}/erp/login", wait_until="networkidle")
            await page.fill('input[type="email"]', "admin@kkt.in"); await page.fill('input[type="password"]', "Kkt@12345")
            await page.click('button[type="submit"]'); await page.wait_for_url("**/erp/dashboard", timeout=30000)
            for name, path, extra in PAGES:
                t0 = time.time()
                await page.goto(f"{BASE}{path}", wait_until="networkidle")
                if extra == "ledger":
                    try:
                        await page.locator("[data-testid=booking-tab-ledger]").click(force=True, timeout=8000); await page.wait_for_timeout(600)
                    except Exception as e:
                        print("ledger tab click failed", e)
                if extra == "wiz2":
                    try:
                        await page.locator('[data-testid="wiz-discard"]').click(timeout=1500)
                    except Exception:
                        pass
                    try:
                        await page.locator('[data-testid="wiz-project"]').click(force=True, timeout=8000); await page.locator('[data-testid^="wiz-project-option-"]').first.click(timeout=8000)
                        await page.locator('[data-testid="wiz-block"]').click(force=True, timeout=8000); await page.locator('[data-testid^="wiz-block-option-"]').first.click(timeout=8000)
                        await page.locator('[data-testid="wiz-next"]').click(force=True, timeout=8000); await page.wait_for_selector('[data-testid="wiz-grid"]', timeout=8000)
                    except Exception as e:
                        print("wizard step2 failed", str(e)[:80])
                if name == "erp_login":
                    lctx = await b.new_context(viewport=page.viewport_size); lp = await lctx.new_page()
                    t0 = time.time(); await lp.goto(f"{BASE}/erp/login", wait_until="networkidle"); ms = round((time.time() - t0) * 1000)
                    sw = await lp.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
                    await lp.screenshot(path=f"{OUT}/{name}_{label}.png", full_page=False); await lctx.close()
                    res[f"{name}_{label}"] = {"ms": ms, "scrollWidth": sw[0], "innerWidth": sw[1], "overflow": sw[0] > sw[1] + 1}
                    continue
                ms = round((time.time() - t0) * 1000)
                sw = await page.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
                await page.screenshot(path=f"{OUT}/{name}_{label}.png", full_page=False)
                res[f"{name}_{label}"] = {"ms": ms, "scrollWidth": sw[0], "innerWidth": sw[1], "overflow": sw[0] > sw[1] + 1}
                if name == "erp_login":  # back to logged-in state
                    await page.goto(f"{BASE}/erp/dashboard", wait_until="networkidle")
            res[f"console_errors_{label}"] = [e for e in errors if "favicon" not in e][:10]
            await ctx.close()
        await b.close()
    json.dump(res, open(f"{OUT}/results.json", "w"), indent=1)
    for k, v in res.items():
        print(k, v if not isinstance(v, dict) else f"{v['ms']} ms, overflow={v['overflow']} ({v['scrollWidth']}/{v['innerWidth']})")

asyncio.run(run())
