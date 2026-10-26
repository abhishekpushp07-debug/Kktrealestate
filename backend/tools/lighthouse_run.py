"""Phase E5: Lighthouse (desktop preset) on authenticated ERP screens via a Playwright-captured session.
Usage: python3 tools/lighthouse_run.py <base_url> <out_dir>"""
import json
import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
LH = "/tmp/lh/node_modules/.bin/lighthouse"
EMAIL, PASSWORD = os.environ.get("KKT_EMAIL", "admin@kkt.in"), os.environ.get("KKT_PASSWORD", "Kkt@12345")
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page()
    pg.goto(f"{BASE}/login")
    pg.fill("[data-testid=login-email-input]", EMAIL)
    pg.fill("[data-testid=login-password-input]", PASSWORD)
    pg.click("[data-testid=login-submit-button]")
    pg.wait_for_url("**/dashboard", timeout=30000)
    storage = pg.evaluate("() => Object.fromEntries(Object.entries(localStorage))")
    cust = pg.evaluate("async () => { const r = await fetch('/api/customers?page_size=1', {headers:{Authorization:'Bearer '+localStorage.getItem(Object.keys(localStorage).find(k => /access/i.test(k)))}}); return (await r.json()).items[0]?.id }")
    bk = pg.evaluate("async () => { const r = await fetch('/api/bookings?page_size=1', {headers:{Authorization:'Bearer '+localStorage.getItem(Object.keys(localStorage).find(k => /access/i.test(k)))}}); return (await r.json()).items[0]?.id }")
    blk = pg.evaluate("async () => { const r = await fetch('/api/blocks?page_size=1', {headers:{Authorization:'Bearer '+localStorage.getItem(Object.keys(localStorage).find(k => /access/i.test(k)))}}); return (await r.json()).items[0]?.id }")
    b.close()

screens = {"home": "/dashboard", "customers": "/customers", "customer_360": f"/customers/{cust}", "booking_detail": f"/bookings/{bk}", "payments": "/payments", "inventory_grid": f"/blocks/{blk}"}
# Lighthouse replays localStorage through a tiny setup page: use --extra-headers for API auth and seed storage via chrome flags is not supported,
# so we inject the session by pointing Lighthouse at /login?lh=1 after writing storage with a preloaded profile dir.
profile = "/tmp/lh/profile"
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(profile, executable_path="/usr/bin/google-chrome", headless=True)
    pg = ctx.new_page(); pg.goto(f"{BASE}/login")
    pg.evaluate("(s) => { for (const [k,v] of Object.entries(s)) localStorage.setItem(k, v); }", storage)
    ctx.close()

rows = []
for name, path in screens.items():
    out = os.path.join(OUT, name)
    cmd = [LH, f"{BASE}{path}", "--preset=desktop", "--quiet", "--output=json", "--output=html", f"--output-path={out}", "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --user-data-dir=" + profile,
           "--only-categories=performance,accessibility,best-practices", "--disable-storage-reset"]
    env = {**os.environ, "CHROME_PATH": "/usr/bin/google-chrome"}
    subprocess.run(cmd, env=env, timeout=240, check=False)
    try:
        rep = json.load(open(out + ".report.json"))
        cats = {k: round((v["score"] or 0) * 100) for k, v in rep["categories"].items()}
        url = rep.get("finalDisplayedUrl", "")
        rows.append((name, path, cats.get("performance"), cats.get("accessibility"), cats.get("best-practices"), url))
    except Exception as e:  # noqa: BLE001
        rows.append((name, path, None, None, None, f"error: {e}"))

with open(os.path.join(OUT, "summary.md"), "w") as f:
    f.write(f"# Lighthouse · desktop preset · {BASE}\n\n| Screen | Path | Performance | Accessibility | Best Practices | Final URL |\n|---|---|---|---|---|---|\n")
    for r in rows:
        f.write(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |\n")
print(open(os.path.join(OUT, "summary.md")).read())
