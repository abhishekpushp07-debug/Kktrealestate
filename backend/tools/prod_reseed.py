"""Phase L1 — production reseed runbook (story dataset) with verification. NO production calls unless --base points there and --confirm RESEED.

  OWNER_BOOTSTRAP_EMAIL=… OWNER_BOOTSTRAP_PASSWORD=… python tools/prod_reseed.py --base https://billpe.com --confirm RESEED
  (dry run on preview)  … --base https://<preview> --allow-preview --confirm RESEED
"""
import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timezone

import requests

HN = os.path.join(os.path.dirname(__file__), "..", "..", "memory", "qa", "story", "headline_numbers.json")
OUT_DIR = "/app/memory/qa/prod"
PREVIEW_MARKERS = ("preview.emergentagent.com", "localhost", "127.0.0.1")


def log(lines, msg):
    print(msg, flush=True)
    lines.append(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--confirm", required=True)
    ap.add_argument("--allow-preview", action="store_true")
    ap.add_argument("--as-of", default=None, help="story as_of (default: headline_numbers.json as_of)")
    ap.add_argument("--timeout-min", type=int, default=40)
    a = ap.parse_args()
    if a.confirm != "RESEED":
        sys.exit("refusing: --confirm RESEED required")
    base = a.base.rstrip("/")
    if any(m in base for m in PREVIEW_MARKERS) and not a.allow_preview:
        sys.exit("refusing: target looks like preview/local; pass --allow-preview")
    email, pw = os.environ.get("OWNER_BOOTSTRAP_EMAIL"), os.environ.get("OWNER_BOOTSTRAP_PASSWORD")
    if not email or not pw:
        sys.exit("OWNER_BOOTSTRAP_EMAIL / OWNER_BOOTSTRAP_PASSWORD must be set in the environment (never passed on the command line)")
    exp = json.load(open(HN))
    as_of = a.as_of or exp["as_of"]
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    lines, ok_all = [], True
    s = requests.Session()
    s.headers["X-Rate-Limit-Bypass"] = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")

    def login():
        r = s.post(f"{base}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
        r.raise_for_status()
        s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        return r.json()

    def check(name, cond, detail=""):
        nonlocal ok_all
        ok_all &= bool(cond)
        log(lines, f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + str(detail)) if detail else ''}")

    log(lines, f"# Production reseed — {base} — {ts} — as_of {as_of}")
    me = login()
    log(lines, f"login ok as {me.get('user', {}).get('email', email)} (role {me.get('user', {}).get('role_name')})")
    co = s.get(f"{base}/api/settings/company", timeout=30).json()
    before = {"company": co.get("name"), "bookings": s.get(f"{base}/api/bookings?page_size=1", timeout=60).json().get("total"), "customers": s.get(f"{base}/api/customers?page_size=1", timeout=60).json().get("total"),
              "payments": s.get(f"{base}/api/payments?page_size=1", timeout=60).json().get("total"), "marker": s.get(f"{base}/api/admin/story-marker", timeout=30).json()}
    log(lines, f"before: {json.dumps(before)}")
    r = s.post(f"{base}/api/admin/reseed", json={"confirm": "RESEED", "story": True, "as_of": as_of}, timeout=600)
    log(lines, f"POST /admin/reseed → {r.status_code} {r.text[:200]}")
    r.raise_for_status()
    t0 = time.time()
    while True:
        try:
            st = s.get(f"{base}/api/admin/reseed/status", timeout=30)
            if st.status_code == 401:
                login()
                continue
            j = st.json()
        except Exception as e:  # noqa: BLE001
            j = {"status": f"poll-error {e}"}
        log(lines, f"  … status={j.get('status')} elapsed={int(time.time() - t0)}s")
        if j.get("status") in ("done", "failed"):
            break
        if time.time() - t0 > a.timeout_min * 60:
            check("reseed finished within timeout", False, j)
            break
        time.sleep(15)
    check("reseed job done", j.get("status") == "done", j)
    login()  # sessions were invalidated
    co = s.get(f"{base}/api/settings/company", timeout=30).json()
    check("company name", co.get("name") == "KKT Constructions", co.get("name"))
    marker = s.get(f"{base}/api/admin/story-marker", timeout=30).json()
    check("story marker as_of", marker.get("as_of") == exp["as_of"], marker)
    # same assertions as tests/test_story_headline.py, via API
    home = s.get(f"{base}/api/dashboard/home", params={"fresh": 1}, timeout=120).json()["totals"]
    check("headline agreement_paise", home.get("agreement_paise") == exp["agreement_paise"], f"{home.get('agreement_paise')} vs {exp['agreement_paise']}")
    for k in ("paid_paise", "outstanding_paise", "overdue_paise", "advance_paise"):
        check(f"headline {k}", home.get(k) == exp[k], f"{home.get(k)} vs {exp[k]}")
    inv = {}
    for b in s.get(f"{base}/api/blocks", params={"page_size": 50}, timeout=60).json()["items"]:
        for f in s.get(f"{base}/api/flats", params={"block_id": b["id"], "page_size": 200}, timeout=60).json()["items"]:
            inv[f"{b['name']}|{f['status']}"] = inv.get(f"{b['name']}|{f['status']}", 0) + 1
    check("headline inventory", {k: v for k, v in inv.items() if k.split("|")[0] in ("Tower A", "Tower B", "Tower C", "Villa Block V")} == exp["inventory"], inv)
    canc = s.get(f"{base}/api/reports/cancellations", params={"from_date": "2025-04-01", "to_date": exp["as_of"]}, timeout=60).json()
    story = [r for r in canc["rows"] if r["booking_number"] in exp["cancelled_bookings"]]
    for k in ("refund_paise", "forfeiture_paise"):
        check(f"cancellations {k}", sum(r[k] for r in story) == exp["cancellations"][k])
    modes = {m["code"]: m["id"] for m in s.get(f"{base}/api/master/payment-modes", timeout=30).json()["items"]}
    chq = s.get(f"{base}/api/payments", params={"page_size": 200, "payment_mode_id": modes["CHEQUE"], "status": "Bounced"}, timeout=60).json()["items"]
    check("cheque register bounced", sum(p["amount_paise"] for p in chq if (p.get("remarks") or "").startswith("story:")) == exp["cheque_register_paise"]["Bounced"])
    ir = s.get(f"{base}/api/admin/integrity-report?fresh=1", timeout=300).json()
    check("integrity ok", ir.get("ok") is True, ir.get("counts"))
    check("owner login", bool(login().get("access_token")))
    lo = requests.get(f"{base}/api/auth/login-options", timeout=30).json()
    check("login-options demo_accounts=false (host gating)", lo.get("demo_accounts") is False, lo)
    d = requests.post(f"{base}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    check("demo login refused", d.status_code in (401, 403) if lo.get("demo_accounts") is False else True, d.status_code)
    after = {"bookings": s.get(f"{base}/api/bookings?page_size=1", timeout=60).json().get("total"), "customers": s.get(f"{base}/api/customers?page_size=1", timeout=60).json().get("total"), "payments": s.get(f"{base}/api/payments?page_size=1", timeout=60).json().get("total")}
    log(lines, f"after: {json.dumps(after)}")
    log(lines, f"\nRESULT: {'OK' if ok_all else 'FAILED'}")
    os.makedirs(OUT_DIR, exist_ok=True)
    path = f"{OUT_DIR}/reseed_{ts}.md"
    open(path, "w").write("\n".join(lines) + "\n")
    print("report:", path)
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
