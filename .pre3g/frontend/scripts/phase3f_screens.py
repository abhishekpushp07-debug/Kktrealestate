"""Phase 3F proof: Day + Night screenshots at 1440 and 390 px of report screens, plus Excel / PDF first pages as PNG.
Usage: API_URL=… ADMIN_PW=… python phase3f_screens.py <BASE> [part]   (part = f1, f2 … ; screens listed in SCREENS)"""

import asyncio
import html
import io
import json
import os
import sys

import requests
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
PART = sys.argv[2] if len(sys.argv) > 2 else "f1"
API = os.environ["API_URL"]
OUT = "/app/memory/qa/phase3f/screens"
EMAIL, PW = os.environ.get("EMAIL", "admin@kkt.in"), os.environ["ADMIN_PW"]
CS = "/reports/v3/customer-status"

# (name, path, action) — action: None | ("click", testid…) to open a menu before the shot
SCREENS = {
    "f1": [
        ("hub", "/reports", None),
        ("customer-status", CS, None),
        ("customer-status-grouped", f"{CS}?group=project,tower", ("group",)),
        ("customer-status-filter-multiselect", CS, ("click", "rf-toggle?", "rf-tower")),
        ("customer-status-date-presets", CS, ("click", "rf-toggle?", "rf-booked-preset")),
        ("customer-status-as-of-31mar", f"{CS}?as_of=2026-03-31&include_cancelled=1", None),
    ],
    "f2": [
        ("hub-customers", "/reports", None),
        ("customer-statement", "/reports/v3/customer-statement?customer=" + os.environ.get("STMT_CUSTOMER", ""), None),
        ("customer-ageing", "/reports/v3/customer-ageing", None),
        ("advance-holders", "/reports/v3/advance-holders", None),
        ("call-list", "/reports/v3/call-list", None),
        ("kyc-pending", "/reports/v3/kyc-pending", None),
        ("payment-behaviour", "/reports/v3/payment-behaviour", None),
        ("customer-directory", "/reports/v3/customer-directory", None),
        ("cancelled-customers", "/reports/v3/cancelled-customers", None),
    ],
    "f3": [("hub-finance", "/reports", None), ("legacy-redirect-collections-v2", "/reports/collections-v2", None)]
    + [(k, f"/reports/v3/{k}", None) for k in ("collections", "day-book", "bank-receipts", "cheques", "bills-vs-collection", "outstanding", "cash-vs-account", "other-charges", "receivables-forecast", "waivers")],
    "f4": [("hub-bookings", "/reports", None)]
    + [(k, f"/reports/v3/{k}", None) for k in ("booking-register", "sales-summary", "discount-register", "plan-position", "agreements", "cancellations", "transfers", "sales-team", "realised-rate", "booking-health")]
    + [("booking-register-filters", "/reports/v3/booking-register", ("click", "rf-toggle?")), ("booking-health-grouped", "/reports/v3/booking-health?group=health,project", ("group",))],
    "f5": [("hub-inventory", "/reports#project-inventory", None)]
    + [(k, f"/reports/v3/{k}", None) for k in ("inventory-status", "stacking-plan", "price-list", "hold-register", "landowner", "parking", "construction-vs-plan", "stage-bills", "sales-velocity")]
    + [("project-statement-pick", "/reports/v3/project-statement", None), ("project-statement", "/reports/v3/project-statement?project=" + os.environ.get("SGH_ID", ""), None), ("booking-health-why", "/reports/v3/booking-health", None)],
    "f6": [("hub", "/reports", None)]
    + [(k, f"/reports/v3/{k}", None) for k in ("lead-funnel", "lead-register", "source-performance", "follow-ups", "visit-register", "visit-conversion", "lost-leads", "response-time", "team-pipeline", "lead-ageing", "service-sla")]
    + [("lead-register-filters", "/reports/v3/lead-register", ("click", "rf-toggle?"))],
    "f5sales": [(k, f"/reports/v3/{k}", None) for k in ("stacking-plan", "inventory-status", "price-list", "hold-register", "parking", "sales-velocity")] + [("hub", "/reports", None)],
    "f5acc": [("stacking-plan", "/reports/v3/stacking-plan", None), ("inventory-status", "/reports/v3/inventory-status", None)],
    "f3fix": [
        ("collections", "/reports/v3/collections", None),
        ("collections-filters", "/reports/v3/collections", ("click", "rf-toggle?")),
        ("collections-period-open", "/reports/v3/collections", ("click", "rf-toggle?", "rf-period-preset")),
        ("collections-basis-open", "/reports/v3/collections", ("click", "rf-toggle?", "rf-basis")),
        ("outstanding-filters", "/reports/v3/outstanding", ("click", "rf-toggle?")),
        ("cheques-filters", "/reports/v3/cheques", ("click", "rf-toggle?")),
        ("customer-ageing-filters", "/reports/v3/customer-ageing", ("click", "rf-toggle?")),
    ],
}
EXPORTS = {
    "f3": [("collections", "group=project"), ("outstanding", "")],
    "f1": [("customer-status", "group=project,tower")],
    "f2": [("customer-ageing", "group=project"), ("customer-statement", "customer=" + os.environ.get("STMT_CUSTOMER", ""))],
}


def token():
    return requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PW}, headers={"X-Login-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}, timeout=30).json()["access_token"]


async def login(page):
    await page.goto(f"{BASE}/login")
    await page.get_by_test_id("login-email-input").fill(EMAIL)
    await page.get_by_test_id("login-password-input").fill(PW)
    await page.locator("[data-testid=login-form] button[type=submit]").click()
    await page.wait_for_selector("[data-testid=topbar]", timeout=30000)


async def act(page, action):
    if not action:
        return
    if action[0] == "group":
        await page.locator("tr.r3-group").first.click()
        return
    for tid in action[1:]:
        loc = page.get_by_test_id(tid.rstrip("?"))
        if tid.endswith("?") and not await loc.is_visible():
            continue
        await loc.click()
        await page.wait_for_timeout(400)


async def shoot(pw, theme, width, screens, results):
    tok = token()
    requests.patch(f"{API}/api/auth/me/preferences", json={"theme": theme}, headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    browser = await pw.chromium.launch()
    ctx = await browser.new_context(viewport={"width": width, "height": 900 if width > 500 else 844})
    await ctx.add_init_script(f"localStorage.setItem('kkt:theme', '{theme}')")
    page = await ctx.new_page()
    await login(page)
    for name, path, action in screens:
        await page.goto(f"{BASE}{path}")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(700)
        await act(page, action)
        sw = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        results.append({"theme": theme, "width": width, "screen": name, "h_overflow_px": sw})
        await page.screenshot(path=f"{OUT}/{PART}-{theme}-{width}-{name}.png")
    await browser.close()


async def exports(pw, results):
    import openpyxl
    import pypdfium2 as pdfium

    h = {"Authorization": f"Bearer {token()}"}
    browser = await pw.chromium.launch()
    page = await browser.new_page(viewport={"width": 1440, "height": 900})
    for key, qs in EXPORTS.get(PART, []):
        pdf = requests.get(f"{API}/api/reports/v3/{key}/export.pdf?{qs}", headers=h, timeout=120).content
        img = pdfium.PdfDocument(pdf)[0].render(scale=1.6).to_pil()
        img.save(f"{OUT}/{PART}-export-{key}-pdf-p1.png")
        xl = requests.get(f"{API}/api/reports/v3/{key}/export.xlsx?{qs}", headers=h, timeout=120).content
        ws = openpyxl.load_workbook(io.BytesIO(xl)).active
        head = "".join(f"<p style='margin:4px 8px;font-weight:{700 if i == 1 else 400}'>{html.escape(str(ws.cell(i, 1).value or ''))}</p>" for i in (1, 2, 3))
        rows = list(ws.iter_rows(min_row=5, max_row=40))
        body = "".join(
            "<tr>"
            + "".join(
                f"<td style='{'text-align:right' if isinstance(c.value, (int, float)) else ''};font-weight:{700 if c.font.bold else 400}'>"
                f"{html.escape(f'₹{c.value:,.0f}' if isinstance(c.value, float) or (isinstance(c.value, int) and c.number_format != 'General') else str(c.value or ''))}</td>"
                for c in r
            )
            + "</tr>"
            for r in rows
        )
        await page.set_content(
            "<style>body{font:12px Calibri,Arial;margin:0}td{border:1px solid #d9d9d9;padding:3px 6px;white-space:nowrap}"
            "tr:first-child td{background:#1F2A44;color:#fff}</style>" + head + "<table style='border-collapse:collapse'>" + body + "</table>"
        )
        await page.screenshot(path=f"{OUT}/{PART}-export-{key}-xlsx-p1.png", full_page=False)
        results.append({"export": key, "pdf_pages": len(pdfium.PdfDocument(pdf)), "xlsx_rows": ws.max_row})
    await browser.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    results = []
    async with async_playwright() as pw:
        for theme in ("light", "night"):  # light = Day
            for width in (1440, 390):
                await shoot(pw, theme, width, SCREENS[PART], results)
        await exports(pw, results)
    requests.patch(f"{API}/api/auth/me/preferences", json={"theme": "light"}, headers={"Authorization": f"Bearer {token()}"}, timeout=30)
    json.dump(results, open(f"{OUT}/{PART}-results.json", "w"), indent=1)
    print(json.dumps(results))


asyncio.run(main())
