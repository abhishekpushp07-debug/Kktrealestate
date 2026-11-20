"""REQ-146 / Q-32 phone sweep: every ERP route at 390 × 844, Light and Night.
Checks: 0 px horizontal scroll · content tables shown as cards · main action reachable (inside the screen) ·
no bottom tab bar. Usage: phone_sweep.py <base>  → /app/memory/qa/phase3/phone_sweep.md; exit 1 on any failure."""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]
IDS = json.load(open(os.path.join(os.path.dirname(__file__), "p3_ids.json")))
OUT = "/app/memory/qa/phase3/phone_sweep.md"
B, C, P = IDS["booking"], IDS["customer"], IDS["project"]
PAY, DEM, SR = IDS["payment"], IDS["demand"], IDS["service_request"]
ROUTES = [
    "/dashboard", "/projects", f"/projects/{P}", f"/projects/{IDS['ye']}", "/flats", "/customers", "/customers/new",
    f"/customers/{C}", f"/customers/{C}/edit", "/leads", "/leads?tab=visits", "/bookings", "/bookings/new",
    f"/bookings/{B}", "/payments", "/documents", "/demands", "/messaging", "/roznamcha", "/reports",
    "/reports/exports", "/reports/collections-v2", "/reports/outstanding-v2", "/reports/discount-register",
    "/reports/waiver-register", f"/bookings/{B}?tab=bills", "/service-requests",
    f"/service-requests/{SR}", "/construction", "/users", "/roles", "/audit", "/admin/access-control",
    "/admin/audit-logs", "/admin/advanced", "/settings", "/settings/definitions", "/settings/catalogues",
    "/masters", "/masters/m/flat-types", "/masters/m/charge-types", "/masters/floor-templates",
    "/masters/tower-templates", "/masters/stage-plan-templates", "/masters/payment-plan-templates",
    "/masters/company", "/website/settings", "/website/notices",
    f"/print/receipt/{PAY}", f"/print/demand/{B}/{DEM}", f"/print/statement/{B}", f"/print/allotment/{B}",
    f"/print/cost-sheet/{B}",
]
CHECK = """() => {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const overflow = document.documentElement.scrollWidth - W;
  const tables = [...document.querySelectorAll('main table')].filter(vis)
    .filter(t => getComputedStyle(t).display === 'table' && t.querySelectorAll('thead th').length >= 4
                 && !t.closest('.print-page,[data-print]') && !t.matches('.keep-table,[role=grid]')).length;
  const prim = [...document.querySelectorAll('main .btn-primary, main [data-primary-action]')].filter(vis);
  const scrolls = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  const reach = prim.length === 0 ? null : prim.every(b => { const r = b.getBoundingClientRect();
    return (r.left >= 0 && r.right <= W + 1) || scrolls(b); });
  const clipped = [...document.querySelectorAll('main .card, main button, main a.btn')].filter(vis)
    .filter(e => e.getBoundingClientRect().right > W + 1 && !scrolls(e)).length;
  const bar = [...document.querySelectorAll('body *')].some(e => { const s = getComputedStyle(e);
    if (s.position !== 'fixed') return false; const r = e.getBoundingClientRect();
    return r.bottom >= H - 2 && r.height < 120 && r.width > W * 0.8 && e.querySelectorAll('a').length >= 3; });
  return {overflow, tables, reach, bar, clipped};
}"""


async def main():
    rows = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for theme in ("night", "day"):
            pg = await br.new_page(viewport={"width": 390, "height": 844})
            await pg.goto(BASE + "/login")
            await pg.evaluate(f"() => localStorage.setItem('kkt:theme', '{theme}')")
            await pg.fill("input[type=email]", "admin@kkt.in")
            await pg.fill("input[type=password]", PW)
            await pg.keyboard.press("Enter")
            await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
            # the profile wins over localStorage: switch through the real Night / Day control
            await pg.evaluate(f"() => document.querySelector('[data-testid=theme-{theme}]')?.click()")
            await pg.wait_for_timeout(800)
            for r in ROUTES:
                try:
                    await pg.goto(BASE + r)
                    await pg.wait_for_load_state("networkidle", timeout=20000)
                except Exception:
                    pass
                await pg.wait_for_timeout(900)
                c = await pg.evaluate(CHECK)
                c["ok"] = c["overflow"] <= 0 and c["tables"] == 0 and c["reach"] is not False and not c["bar"] and c["clipped"] == 0
                rows.append((theme, r, c))
            await pg.close()
        await br.close()
    bad = [x for x in rows if not x[2]["ok"]]
    lines = [
        "# Phone sweep — 390 × 844 (REQ-146, Q-32)",
        "",
        f"{len(ROUTES)} routes × Light/Night = {len(rows)} checks · **{len(rows) - len(bad)} pass, {len(bad)} fail**",
        "",
        "Checks: sideways scroll (px) · content tables still shown as tables (≥ 4 columns) · main action inside the screen"
        " (every main button; — = page has none) · cards/buttons cut off at the right edge · bottom tab bar.",
        "",
        "| Theme | Route | Sideways px | Tables left | Main action | Cut-off items | Bottom bar | Result |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for theme, r, c in rows:
        ra = "—" if c["reach"] is None else ("yes" if c["reach"] else "NO")
        route = r.replace(B, "{booking}").replace(C, "{customer}").replace(P, "{project}").replace(IDS["ye"], "{Ye}")
        route = route.replace(PAY, "{receipt}").replace(DEM, "{bill}").replace(SR, "{request}")
        lines.append(
            f"| {theme} | `{route}` | {max(c['overflow'], 0)} | {c['tables']} | {ra} | {c['clipped']} | {'yes' if c['bar'] else 'no'} |"
            f" {'✅' if c['ok'] else '❌'} |"
        )
    open(OUT, "w").write("\n".join(lines) + "\n")
    print(f"{len(rows)} checks, {len(bad)} fail")
    for b in bad:
        print(b)
    sys.exit(1 if bad else 0)


BASE = sys.argv[1].rstrip("/")
if os.environ.get("ONLY"):  # e.g. ONLY=/home for a one-screen check
    ROUTES = [r for r in ROUTES if r in os.environ["ONLY"].split(",")]
asyncio.run(main())
