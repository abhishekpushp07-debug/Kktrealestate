"""Phase F entry→effect probe. Snapshots every read surface, performs ONE entry via the API, diffs, then restores.
Usage: python tools/effects_probe.py <scenario> [--base URL] [--keep]   scenarios: payment_cash, cheque_clear, cheque_bounce,
       lead_stage, flat_hold, stage_mark, service_status, demand_manual, customer_edit, reverse_only
Writes /app/memory/qa/journey/probes/<scenario>.md"""
import argparse
import json
import os
import sys
import time
import uuid
from datetime import date

import requests

BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
OUT = "/app/memory/qa/journey/probes"


class Api:
    def __init__(self, base, email, pw):
        self.base = base.rstrip("/") + "/api"
        r = requests.post(f"{self.base}/auth/login", json={"email": email, "password": pw}, headers=BYPASS, timeout=20)
        r.raise_for_status()
        self.h = {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}

    def get(self, p, **params):
        r = requests.get(f"{self.base}{p}", headers=self.h, params=params or None, timeout=30)
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else {"_status": r.status_code, "_len": len(r.content)}

    def post(self, p, body=None, idem=True):
        h = {**self.h, **({"Idempotency-Key": uuid.uuid4().hex} if idem else {})}
        r = requests.post(f"{self.base}{p}", json=body or {}, headers=h, timeout=30)
        return r.status_code, (r.json() if r.content else {})

    def patch(self, p, body):
        r = requests.patch(f"{self.base}{p}", json=body, headers=self.h, timeout=30)
        return r.status_code, (r.json() if r.content else {})


def surfaces(api, ctx):
    """Every read surface an entry could affect. Keys are stable labels used in the matrix."""
    b, c, pj, bl, fl = ctx["booking_id"], ctx["customer_id"], ctx["project_id"], ctx["block_id"], ctx["flat_id"]
    today = date.today().isoformat()
    S = {
        "booking.detail+summary": lambda: api.get(f"/bookings/{b}"),
        "booking.ledger(cash)": lambda: api.get(f"/bookings/{b}/ledger", ledger="cash"),
        "booking.ledger(account)": lambda: api.get(f"/bookings/{b}/ledger", ledger="account"),
        "booking.ledger(other)": lambda: api.get(f"/bookings/{b}/ledger", ledger="other"),
        "booking.ledger(combined)": lambda: api.get(f"/bookings/{b}/ledger"),
        "booking.schedule/demands": lambda: api.get("/payments/demands", booking_id=b),
        "customer.360": lambda: api.get(f"/customers/{c}"),
        "customer.ledgers": lambda: api.get(f"/customers/{c}/ledgers"),
        "customer.timeline": lambda: api.get(f"/customers/{c}/payments"),
        "customer.panels(comms/docs)": lambda: api.get(f"/customers/{c}/panels"),
        "project.workspace": lambda: api.get(f"/projects/{pj}"),
        "project.summary(read-model)": lambda: api.get(f"/projects/{pj}/summary"),
        "block.summary(read-model)": lambda: api.get(f"/blocks/{bl}/summary") if api.get(f"/blocks/{bl}/summary").get("block_id") else api.get("/blocks", project_id=pj, page_size=20),
        "block.detail+grid": lambda: api.get(f"/blocks/{bl}/grid"),
        "inventory.flats(block)": lambda: api.get("/flats", block_id=bl, page_size=200),
        "flat.detail": lambda: api.get(f"/flats/{fl}"),
        "dashboard.home": lambda: api.get("/dashboard/home"),
        "dashboard.legacy": lambda: api.get("/dashboard"),
        "dashboard.widgets": lambda: api.get("/dashboard/widgets"),
        "bootstrap.counts": lambda: (api.get("/bootstrap") or {}).get("counts"),
        "payments.list+totals": lambda: api.get("/payments", page_size=5),
        "payments.summary": lambda: api.get("/payments/summary"),
        "roznamcha(today)": lambda: api.get("/roznamcha", date=today),
        "cheques.in_hand": lambda: api.get("/payments/cheques-in-hand"),
        "report.collections(today)": lambda: api.get("/reports/collections", date_from=today, date_to=today),
        "report.outstanding": lambda: api.get("/reports/outstanding"),
        "report.advances": lambda: api.get("/reports/advances"),
        "report.demand_vs_collection": lambda: api.get("/reports/demand-vs-collection"),
        "report.inventory": lambda: api.get("/reports/inventory"),
        "report.cheques": lambda: api.get("/reports/cheques"),
        "report.cancellations": lambda: api.get("/reports/cancellations"),
        "report.sales_leads": lambda: api.get("/reports/sales-leads"),
        "report.roznamcha_range": lambda: api.get("/reports/roznamcha-range", date_from=today, date_to=today),
        "report.bank_receipts": lambda: api.get("/reports/bank-receipts"),
        "report.activity": lambda: api.get("/reports/activity"),
        "report.statement": lambda: api.get(f"/reports/statement/{b}"),
        "report.construction_progress": lambda: api.get("/reports/construction-progress"),
        "report.service_sla": lambda: api.get("/reports/service-sla"),
        "notifications(staff)": lambda: api.get("/notifications", page_size=5),
        "audit.booking": lambda: api.get("/audit-logs", entity_id=b, page_size=5),
        "audit.recent": lambda: api.get("/audit-logs", page_size=3),
        "search(customer name)": lambda: api.get("/search", q=ctx["customer_name"].split()[0]),
        "leads.board": lambda: api.get("/leads/board"),
        "leads.list": lambda: api.get("/leads", page_size=5),
        "service.list": lambda: api.get("/service-requests", page_size=5),
        "construction.milestones(block)": lambda: api.get(f"/blocks/{bl}/milestones"),
        "pdf.statement(len)": lambda: api.get(f"/pdfs/bookings/{b}/statement.pdf"),
    }
    out = {}
    for k, f in S.items():
        try:
            out[k] = f()
        except Exception as e:  # noqa: BLE001
            out[k] = {"_error": str(e)[:80]}
    return out


def strip_volatile(o):
    if isinstance(o, dict):
        return {k: strip_volatile(v) for k, v in o.items() if k not in ("ran_at", "generated_at", "server_time", "etag", "as_of_ts", "cached_at", "last_sweep", "_len")}
    if isinstance(o, list):
        return [strip_volatile(x) for x in o]
    return o


def diff(a, b):
    changed = {}
    for k in a:
        if strip_volatile(a[k]) != strip_volatile(b[k]):
            changed[k] = _summ(a[k], b[k])
    return changed


def _summ(x, y, depth=0, path=""):
    """Compact description of what changed (first few leaf-level differences)."""
    out = []
    if isinstance(x, dict) and isinstance(y, dict):
        for k in sorted(set(x) | set(y)):
            if x.get(k) != y.get(k):
                if isinstance(x.get(k), (dict, list)) and depth < 2:
                    out += _summ(x.get(k), y.get(k), depth + 1, f"{path}.{k}")
                else:
                    out.append(f"{path}.{k}: {json.dumps(x.get(k), default=str)[:60]} → {json.dumps(y.get(k), default=str)[:60]}")
    elif isinstance(x, list) and isinstance(y, list):
        out.append(f"{path}[]: len {len(x)} → {len(y)}" if len(x) != len(y) else f"{path}[]: {len(x)} items, content changed")
    else:
        out.append(f"{path}: {json.dumps(x, default=str)[:60]} → {json.dumps(y, default=str)[:60]}")
    return out[:8]


def pick_context(api):
    bk = next(b for b in api.get("/bookings", status="Active", page_size=50)["items"] if b["cash_agreed_paise"] - b["summary"]["cash_paid_paise"] > 2_000_000)
    full = api.get(f"/bookings/{bk['id']}")
    return {"booking_id": bk["id"], "booking_number": bk["booking_number"], "customer_id": bk["customer_id"], "customer_name": full.get("customer_name") or "Customer",
            "project_id": bk["project_id"], "block_id": bk["block_id"], "flat_id": bk["flat_id"], "version": full["version"]}


SCENARIOS = {}


def scenario(name):
    def deco(f):
        SCENARIOS[name] = f
        return f
    return deco


@scenario("payment_cash")
def payment_cash(api, ctx):
    modes = {m["code"]: m for m in api.get("/master/payment-modes", page_size=50)["items"]}
    st, r = api.post("/payments", {"booking_id": ctx["booking_id"], "payment_category": "Cash", "against": "FLAT_VALUE", "amount": 10000, "payment_date": date.today().isoformat(),
                                   "payment_mode_id": modes["CASH"]["id"], "instrument": None, "remarks": "F-probe"})
    assert st == 201, r
    return r, lambda: api.post(f"/payments/{r['id']}/reverse", {"reason": "F-probe restore"}, idem=False)


@scenario("cheque_clear")
def cheque_clear(api, ctx):
    modes = {m["code"]: m for m in api.get("/master/payment-modes", page_size=50)["items"]}
    banks = api.get("/master/bank-accounts", page_size=10)["items"]
    st, r = api.post("/payments", {"booking_id": ctx["booking_id"], "payment_category": "Account", "against": "FLAT_VALUE", "amount": 10000, "payment_date": date.today().isoformat(),
                                   "payment_mode_id": modes["CHEQUE"]["id"], "bank_account_id": banks[0]["id"], "instrument": {"number": "999901", "bank_name": "Probe Bank", "date": date.today().isoformat()}, "remarks": "F-probe"})
    assert st == 201, r
    pre = surfaces(api, ctx)  # pending state
    st2, r2 = api.post(f"/payments/{r['id']}/clear", {}, idem=False)
    assert st2 == 200, r2
    return {"posted_pending": r, "cleared": r2, "_pre_override": pre}, lambda: api.post(f"/payments/{r['id']}/reverse", {"reason": "F-probe restore"}, idem=False)


@scenario("cheque_bounce")
def cheque_bounce(api, ctx):
    modes = {m["code"]: m for m in api.get("/master/payment-modes", page_size=50)["items"]}
    banks = api.get("/master/bank-accounts", page_size=10)["items"]
    st, r = api.post("/payments", {"booking_id": ctx["booking_id"], "payment_category": "Account", "against": "FLAT_VALUE", "amount": 10000, "payment_date": date.today().isoformat(),
                                   "payment_mode_id": modes["CHEQUE"]["id"], "bank_account_id": banks[0]["id"], "instrument": {"number": "999902", "bank_name": "Probe Bank", "date": date.today().isoformat()}, "remarks": "F-probe"})
    assert st == 201, r
    pre = surfaces(api, ctx)
    st2, r2 = api.post(f"/payments/{r['id']}/bounce", {"reason": "F-probe bounce"}, idem=False)
    assert st2 == 200, r2
    return {"posted_pending": r, "bounced": r2, "_pre_override": pre}, None  # bounced has no ledger effect; nothing to restore


@scenario("lead_stage")
def lead_stage(api, ctx):
    lead = api.get("/leads", page_size=1, status="New")["items"][0]
    st, r = api.post(f"/leads/{lead['id']}/stage", {"status": "Contacted"}, idem=False)
    assert st == 200, r
    return r, lambda: api.post(f"/leads/{lead['id']}/stage", {"status": "New", "note": "F-probe restore"}, idem=False)


@scenario("flat_hold")
def flat_hold(api, ctx):
    fl = next(f for f in api.get("/flats", block_id=ctx["block_id"], status="Available", page_size=50)["items"])
    st, r = api.patch(f"/flats/{fl['id']}/status", {"status": "Hold", "reason": "F-probe", "version": fl["version"]})
    assert st == 200, r
    return r, lambda: api.patch(f"/flats/{fl['id']}/status", {"status": "Available", "reason": "F-probe restore", "version": r["version"]})


@scenario("stage_mark")
def stage_mark(api, ctx):
    ms = api.get(f"/blocks/{ctx['block_id']}/milestones")
    nxt = ms["next_seq"]
    if nxt is None:
        return {"skipped": "block has no pending stage"}, None
    st, r = api.post(f"/blocks/{ctx['block_id']}/milestones/{nxt}/complete", {"completed_on": date.today().isoformat()}, idem=False)
    assert st == 200, r
    return r, lambda: api.post(f"/blocks/{ctx['block_id']}/milestones/{nxt}/undo", {"reason": "F-probe restore"}, idem=False)


@scenario("service_status")
def service_status(api, ctx):
    sr = next(s for s in api.get("/service-requests", page_size=50)["items"] if s["status"] == "New")
    st, r = api.post(f"/service-requests/{sr['id']}/status", {"status": "In Progress"}, idem=False)
    assert st == 200, r
    return r, lambda: api.post(f"/service-requests/{sr['id']}/status", {"status": "New", "note": "F-probe restore"}, idem=False)


@scenario("demand_manual")
def demand_manual(api, ctx):
    b = api.get(f"/bookings/{ctx['booking_id']}")
    manual = [l for l in (b.get("other_charges") or []) if l.get("demand_at") == "manual" and not l.get("demanded")]
    if not manual:
        return {"skipped": "no un-demanded manual other-charge line on this booking (and there is no demand void API to restore one)"}, None
    st, r = api.post(f"/bookings/{ctx['booking_id']}/other-charges/demand", {"charge_type_id": manual[0]["charge_type_id"]}, idem=False)
    return {"status": st, **(r if isinstance(r, dict) else {})}, None


@scenario("customer_edit")
def customer_edit(api, ctx):
    c = api.get(f"/customers/{ctx['customer_id']}")
    old = c.get("occupation")
    st, r = api.patch(f"/customers/{ctx['customer_id']}", {"occupation": "F-probe occupation", "version": c["version"]})
    assert st == 200, r
    return r, lambda: api.patch(f"/customers/{ctx['customer_id']}", {"occupation": old, "version": r["version"]})


def run(name, base, keep):
    api = Api(base, "admin@kkt.in", "Kkt@12345")
    ctx = pick_context(api)
    before = surfaces(api, ctx)
    t0 = time.time()
    result, restore = SCENARIOS[name](api, ctx)
    time.sleep(2.5)  # let debounced read-model flush + TTL caches settle (documents what a user sees ~2 s later)
    after = surfaces(api, ctx)
    if isinstance(result, dict) and "_pre_override" in result:
        before = result.pop("_pre_override")
    changed = diff(before, after)
    unchanged = sorted(set(before) - set(changed))
    time.sleep(6)  # beyond every TTL (5 s lists / 10 s home) — second read shows what is merely *stale* vs *missing*
    after2 = surfaces(api, ctx)
    changed2 = diff(before, after2)
    stale_only = sorted(set(changed2) - set(changed))
    restored = None
    if restore and not keep:
        restored = restore()
        time.sleep(1)
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/{name}.md", "w") as f:
        f.write(f"# Probe `{name}` · {ctx['booking_number']} · {date.today()}\n\nAction result: `{json.dumps(result, default=str)[:400]}`\n\n")
        f.write(f"## Surfaces changed within 2.5 s ({len(changed)})\n")
        for k, v in changed.items():
            f.write(f"- **{k}**\n" + "".join(f"  - {line}\n" for line in v))
        f.write(f"\n## Changed only after caches expired (stale 2.5–9 s) ({len(stale_only)})\n" + "".join(f"- {k}\n" for k in stale_only))
        f.write(f"\n## Unchanged ({len(unchanged) - len(stale_only)})\n" + "".join(f"- {k}\n" for k in unchanged if k not in stale_only))
        f.write(f"\n## Restore\n`{json.dumps(restored, default=str)[:300] if restored else 'n/a (no ledger effect or --keep)'}`\n")
    # Phase G: ACTUAL (surfaces changed) vs EXPECTED (event registry). Registry surface -> probe surface prefixes.
    REG2PROBE = {"ledgers": ("booking.ledger", "customer.ledgers"), "bookings": ("booking.detail",), "demands": ("booking.schedule",), "payments": ("payments.",), "customer360": ("customer.360", "customer.timeline"),
                 "home": ("dashboard.home",), "dashboard": ("dashboard.legacy", "dashboard.widgets"), "widgets": ("dashboard.widgets",), "bootstrap": ("bootstrap.",), "roznamcha": ("roznamcha", "report.roznamcha"), "reports": ("report.",),
                 "audit": ("audit.",), "flats": ("flat.", "inventory."), "inventory": ("inventory.", "block.detail"), "blocks": ("block.",), "projects": ("project.",), "leads": ("leads.",), "notifications": ("notifications",), "service": ("service.",),
                 "cheques": ("cheques.", "report.cheques"), "customers": ("customer.",), "search": ("search",), "visits": ("visits",), "refunds": ("refunds",)}
    ENTITY = {"payment_cash": ("payment", lambda r: r["id"]), "cheque_clear": ("payment", lambda r: r["cleared"]["id"]), "cheque_bounce": ("payment", lambda r: r["bounced"]["id"]), "lead_stage": ("lead", lambda r: r["id"]),
              "flat_hold": ("flat", lambda r: r["id"]), "stage_mark": ("block", lambda r: ctx["block_id"]), "service_status": ("service_request", lambda r: r.get("id")), "customer_edit": ("customer", lambda r: ctx["customer_id"]), "demand_manual": ("booking", lambda r: ctx["booking_id"])}
    verdict = {}
    S_KEYS = set(before.keys()) if isinstance(before, dict) else set()
    try:
        et, fid = ENTITY[name]
        for a in api.get(f"/journey/entity/{et}/{fid(result)}").get("items", [])[:1]:
            j = api.get(f"/journey/{a['id']}")
            expected = {s_["surface"] for s_ in j["surfaces"]}
            actual_keys = set(changed) | set(stale_only)
            for e in expected:
                hits = [k for k in actual_keys if any(k.startswith(pfx) for pfx in REG2PROBE.get(e, (e,)))]
                verdict[e] = "changed" if hits else ("n/a-not-snapshotted" if e not in REG2PROBE or e in ("notifications", "refunds", "visits", "search", "bootstrap") and not any(k.startswith(REG2PROBE[e][0]) for k in S_KEYS) else "MISSING")
            verdict["_propagated_complete"] = j["entry"]["propagated_complete"]
    except Exception as e:  # noqa: BLE001
        verdict = {"error": str(e)[:200]}
    with open(f"{OUT}/{name}.md", "a") as f:
        f.write("\n## Expected (registry) vs actual\n" + "".join(f"- {k}: {v}\n" for k, v in sorted(verdict.items())))
    missing = [k for k, v in verdict.items() if v == "MISSING"]
    print(f"{name}: changed={len(changed)} stale_only={len(stale_only)} unchanged={len(unchanged) - len(stale_only)} missing_vs_registry={missing} in {time.time() - t0:.1f}s → {OUT}/{name}.md")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scenario", choices=list(SCENARIOS) + ["all"])
    ap.add_argument("--base", default="http://localhost:8001")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    for n in (list(SCENARIOS) if a.scenario == "all" else [a.scenario]):
        try:
            run(n, a.base, a.keep)
        except Exception as e:  # noqa: BLE001
            print(f"{n}: ERROR {e}", file=sys.stderr)
