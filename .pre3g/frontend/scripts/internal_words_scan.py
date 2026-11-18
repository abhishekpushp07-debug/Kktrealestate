"""REQ-130 / Q-28 internal-words scan: rendered text on the key screens must not show ids, snake_case keys,
"paise" or "demand" (owner word: Bill raised). Light theme at 1440 and 390. Usage: internal_words_scan.py <base>
Exit 1 when any hit; writes /app/memory/qa/phase3/internal_words.md."""

import asyncio
import json
import os
import re
import sys

from playwright.async_api import async_playwright

PW = os.environ["KKT_DEMO_PASSWORD"]
IDS = json.load(open(os.path.join(os.path.dirname(__file__), "p3_ids.json")))
OUT = "/app/memory/qa/phase3/internal_words.md"
B, C, P = IDS["booking"], IDS["customer"], IDS["project"]
REPORTS = (
    "collections-v2 outstanding-v2 demand-vs-collection cash-vs-account cheques receivables-forecast cancellations "
    "bank-receipts other-charges roznamcha-summary collections outstanding advances roznamcha-range upcoming-dues "
    "inventory sales-leads site-visits sales-team inventory-control landowner-share hold-register masked-inventory "
    "construction-vs-plan project-statement construction-progress service-sla activity data-quality discount-register "
    "waiver-register"
).split()
# Phase 3F engine reports (hub + every v3 sheet); the hub/report screens must not talk about the "engine" either
REPORTS_V3 = (
    "collections day-book bank-receipts cheques bills-vs-collection outstanding cash-vs-account other-charges "
    "receivables-forecast waivers "
    "customer-status customer-statement customer-ageing advance-holders call-list kyc-pending payment-behaviour "
    "customer-directory cancelled-customers"
).split()
PAGES = (
    [f"/bookings/{B}?tab={t}" for t in ("overview", "bills", "ledger", "documents", "activity")]
    + [f"/customers/{C}?tab={t}" for t in ("overview", "bookings", "money", "kyc", "activity")]
    + [f"/projects/{P}?tab={t}" for t in ("overview", "structure", "inventory", "plans", "construction")]
    + [f"/projects/{IDS['ye']}"]
    + ["/demands", "/roznamcha", "/reports", "/construction", "/documents", "/masters", "/admin/advanced"]
    + [
        f"/masters/m/{k}"
        for k in ("flat-types", "construction-stages", "charge-types", "parking-slot-types", "payment-modes")
    ]
    + [f"/masters/m/{k}" for k in ("bank-accounts", "document-types", "hold-reasons", "allocation-categories")]
    + [f"/masters/{k}" for k in ("floor-templates", "tower-templates", "stage-plan-templates")]
    + ["/masters/payment-plan-templates", "/masters/company", "/settings/catalogues", "/settings", "/reports"]
    + [f"/reports/{k}" for k in REPORTS]
    + [f"/reports/v3/{k}" for k in REPORTS_V3]
)
RULES = {
    "id": re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I),
    "snake_case": re.compile(r"\b(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b"),
    "paise": re.compile(r"\bpaise\b", re.I),
    "demand": re.compile(r"\bdemand(?:s|ed|ing)?\b(?! draft)", re.I),
}
# hub / report screens only: no talk about the report "engine" (Phase 3F review)
REPORT_RULES = {"engine": re.compile(r"\bengine\b", re.I)}
ONLY = os.environ.get("ONLY")  # optional path prefix, e.g. /reports
# names typed by earlier automated test runs on this copy (data, not app words)
TEST_DATA = re.compile(r"\b(?:locktest|tscheck|TSCHECK|TEST)_\w+")
TEXT = """() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode, el = n.parentElement;
    if (!el || !n.textContent.trim() || el.closest('script,style,noscript,[aria-hidden=true]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    out.push(n.textContent.trim());
  }
  document.querySelectorAll('input,textarea').forEach(i => { if (i.placeholder) out.push(i.placeholder); });
  return out;
}"""

# every text node, shown or not (a hidden fallback can flash before styles/data load, e.g. a bare actor id)
ALL_TEXT = """() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode, el = n.parentElement;
    if (el && n.textContent.trim() && !el.closest('script,style,noscript')) out.push(n.textContent.trim());
  }
  return out;
}"""


async def scan(pg, path):
    await pg.goto(BASE + path)
    await pg.wait_for_load_state("networkidle")
    await pg.wait_for_timeout(1200)
    hits = []
    for t in await pg.evaluate(TEXT):
        t = TEST_DATA.sub("", t)
        rules = RULES | (REPORT_RULES if path.startswith("/reports") else {})
        for rule, rx in rules.items():
            for m in rx.finditer(t):
                hits.append((rule, m.group(0), t[:90]))
    for t in await pg.evaluate(ALL_TEXT):
        for m in RULES["id"].finditer(t):
            hits.append(("id (hidden node)", m.group(0), t[:90]))
    return hits


async def main():
    res = {}
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for w in (1440, 390):
            pg = await br.new_page(viewport={"width": w, "height": 900 if w > 400 else 844})
            await pg.goto(BASE + "/login")
            await pg.evaluate("() => localStorage.setItem('kkt:theme', 'light')")
            await pg.fill("input[type=email]", "admin@kkt.in")
            await pg.fill("input[type=password]", PW)
            await pg.keyboard.press("Enter")
            await pg.wait_for_selector("[data-testid='home-grid']", timeout=40000)
            for path in [x for x in PAGES if not ONLY or x.startswith(ONLY)]:
                res[(w, path)] = sorted(set(await scan(pg, path)))
            await pg.close()
        await br.close()
    total = sum(len(v) for v in res.values())
    lines = [
        "# Internal-words scan (REQ-130, Q-28)",
        "",
        f"{len(PAGES)} screens × Light × 1440/390 · rules: ids, snake_case, 'paise', 'demand' · **{total} hits**",
        "",
    ]
    for (w, path), hits in res.items():
        lines.append(f"- {'✅' if not hits else '❌'} {w} {path}" + ("" if not hits else f" — {len(hits)}"))
        lines += [f"  - {r}: `{m}` in “{ctx}”" for r, m, ctx in hits]
    open(OUT, "w").write("\n".join(lines) + "\n")
    print(f"{total} hits")
    for (w, path), hits in res.items():
        for h in hits:
            print(w, path, h)
    sys.exit(1 if total else 0)


BASE = sys.argv[1].rstrip("/")
asyncio.run(main())
