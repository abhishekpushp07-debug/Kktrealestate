"""Phase S3.2 — full-story proof driver (API = what the UI calls). Creates a scratch project, walks the owner's story, asserts
downstream effects after every step, writes /app/memory/qa/phase_s3/story.md, and cleans up through audited paths.
Run: cd /app/backend && set -a && . ./.env && set +a && python -m tools.story_s3 [--keep]"""

import json
import os
import sys
import uuid
from datetime import date
from pathlib import Path

import requests

BASE = os.environ.get("STORY_BASE", "http://localhost:8001")
PW = os.environ.get("TEST_PASSWORD") or os.environ["DEMO_PASSWORD"]
TAG = uuid.uuid4().hex[:4].upper()
OUT = "/app/memory/qa/phase_s3"
ROWS: list[tuple] = []
STATE: dict = {}


C360_KEYS = ("agreement_paise", "bill_raised_paise", "received_paise", "balance_paise", "due_paise")


def _h():
    if "h" not in STATE:
        tok = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": PW}).json()[
            "access_token"
        ]
        STATE["h"] = {"Authorization": f"Bearer {tok}"}
    return STATE["h"]


def api(method, path, body=None, code=None, **params):
    r = requests.request(
        method,
        f"{BASE}/api{path}",
        json=body,
        params=params or None,
        headers={**_h(), "Idempotency-Key": uuid.uuid4().hex},
    )
    if code and r.status_code != code or not code and r.status_code >= 400:
        raise RuntimeError(f"{method} {path} → {r.status_code} {r.text[:400]}")
    return r.json() if r.headers.get("content-type", "").startswith("application/json") else r.content


def step(n, title, expected, observed, shots=""):
    ROWS.append((n, title, expected, observed, shots))
    print(f"[{n}] {title}\n     → {observed}")


def reg_rows_of(reg, booking_number):
    out = []
    for day in reg["groups"]:
        for pg in (
            (day.get("projects") or {}).values()
            if isinstance(day.get("projects"), dict)
            else (day.get("projects") or [])
        ):
            for tg in (
                (pg.get("towers") or {}).values() if isinstance(pg.get("towers"), dict) else (pg.get("towers") or [])
            ):
                out += [r for r in tg.get("rows", []) if r.get("booking_number") == booking_number]
    return out


def inr(p):
    return f"₹{p / 100:,.0f}"


def headline():
    home = api("GET", "/dashboard/home")
    tiles = (
        {t.get("key") or t.get("label"): t.get("value") for t in (home.get("tiles") or home.get("kpis") or [])}
        if isinstance(home, dict)
        else {}
    )
    integ = api("GET", "/admin/integrity-report", fresh=1)
    return {
        "tiles": tiles,
        "integrity_findings": sum((integ.get("counts") or {}).values()),
        "projects": api("GET", "/projects", page_size=1)["total"],
        "customers": api("GET", "/customers", page_size=1)["total"],
        "bookings": api("GET", "/bookings", page_size=1)["total"],
    }


def run(keep=False):
    os.makedirs(OUT, exist_ok=True)
    pre = headline()
    STATE["pre"] = pre
    # 1. Masters
    fts = api("GET", "/master/flat-types", page_size=100)["items"]
    rt = api("GET", "/master/room-types", page_size=5)["items"][0]
    ft3 = api(
        "POST",
        "/master/flat-types",
        {
            "name": f"3BHK-QA {TAG}",
            "code": f"3QA{TAG}"[:10],
            "bhk": 3,
            "default_saleable_sqft": 1250,
            "rooms": [{"room_type_id": rt["id"], "label": "Living", "length_ft": 18, "width_ft": 14}],
        },
        201,
    )
    ft2 = next(f for f in fts if f.get("bhk") == 2) if any(f.get("bhk") == 2 for f in fts) else fts[0]
    floor = api(
        "POST",
        "/floor-templates",
        {
            "name": f"2×3BHK-QA + 2×2BHK {TAG}",
            "positions": [
                {"pos": 1, "flat_type_id": ft3["id"]},
                {"pos": 2, "flat_type_id": ft3["id"]},
                {"pos": 3, "flat_type_id": ft2["id"]},
                {"pos": 4, "flat_type_id": ft2["id"]},
            ],
        },
        201,
    )
    stages = [s for s in api("GET", "/master/construction-stages", page_size=100)["items"] if s["is_active"]]
    booking_stage = next(s for s in stages if s.get("auto_complete_on_booking") or s["code"] == "BOOKING")
    others = [s for s in stages if s["id"] != booking_stage["id"]][:5]
    sp = api(
        "POST",
        "/stage-plan-templates",
        {"name": f"QA 6 stages {TAG}", "stage_ids": [booking_stage["id"]] + [s["id"] for s in others]},
        201,
    )
    pp = api(
        "POST",
        "/payment-plan-templates",
        {
            "name": f"QA CLP {TAG}",
            "installments": [{"label": "Booking", "percent": 10, "trigger": "on_booking"}]
            + [{"label": s["name"], "percent": 15, "trigger": "stage", "stage_id": s["id"]} for s in others]
            + [{"label": "Possession", "percent": 15, "trigger": "on_possession"}],
        },
        201,
    )
    heads = api("GET", "/master/charge-types", page_size=100)["items"]
    tt = api(
        "POST",
        "/tower-templates",
        {
            "name": f"QA G+3 {TAG}",
            "floors": 3,
            "floor_start": 1,
            "numbering_pattern": "{block}-{floor}{pos2}",
            "floor_map": [{"from": 1, "to": 3, "floor_template_id": floor["id"]}],
            "default_stage_plan_template_id": sp["id"],
            "default_payment_plan_template_ids": [pp["id"]],
            "default_payment_plan_template_id": pp["id"],
        },
        201,
    )
    step(
        1,
        "Masters",
        "Flat type, floor template (4 flats), 6-stage plan, 10+15×5+15=100 payment plan, charge heads present",
        (
            f"{ft3['name']} · {floor['preview']} · {len(sp['stages'])} stages · {sum(i['percent'] for i in pp['installments'])}% · {len(heads)} "
            f"charge heads"
        ),
        "01_masters.jpeg",
    )
    # 2. Project + tower from template
    proj = api(
        "POST",
        "/projects",
        {
            "name": f"QA Story Heights {TAG}",
            "code": f"QSH{TAG}",
            "project_type": "Residential",
            "address": {"city": "Indore"},
        },
        201,
    )
    res = api(
        "POST",
        f"/projects/{proj['id']}/towers-from-template",
        {"name": "A", "code": "A", "tower_template_id": tt["id"]},
        201,
    )
    blk = res["block"]
    plans = api("GET", f"/projects/{proj['id']}/blocks/{blk['id']}/payment-plans")["items"]
    ov = api("GET", f"/projects/{proj['id']}")
    setup = api("GET", f"/projects/{proj['id']}/setup")
    readiness = json.dumps(setup.get("readiness") or ov.get("readiness") or {})[:200]
    step(
        2,
        "Project + Tower A from template",
        "3 floors · 12 flats · stage plan + default payment plan attached · inventory 12 Available · 'what's left' flags flats without price",
        (
            f"floors={res['floors_applied']} flats={res['flats_created']} stage_plan={res['stage_plan']['name']} "
            f"plans={[p['name'] + ('*' if p['is_default'] else '') for p in plans]} "
            f"warnings={res['warnings']} "
            f"inventory={ov.get('inventory')} "
            f"readiness={readiness}"
        ),
        "02_structure.jpeg, 02_plans.jpeg",
    )
    assert res["flats_created"] == 12 and plans and res["warnings"] == []
    # 3. Flat A-201 pricing + parking + maintenance
    flats = api("GET", "/flats", block_id=blk["id"], page_size=50)["items"]
    flat = next(f for f in flats if f["flat_number"].endswith("201"))
    api(
        "PATCH",
        f"/flats/{flat['id']}/pricing",
        {
            "saleable_sqft": 1250,
            "rate_per_sqft": 5200,
            "pricing_mode": "rate",
            "maintenance": {"method": "per_sqft_months", "rate_per_sqft": 3, "months": 24},
        },
    )
    slot = api(
        "POST", "/parking", {"project_id": proj["id"], "number": f"P-{TAG}", "type": "Covered", "price": 250000}, 201
    )
    api("POST", f"/parking/{slot['id']}/attach", {"flat_id": flat["id"]})
    flat = api("GET", f"/flats/{flat['id']}")
    ps = api("GET", "/reports/project-statement", project_id=proj["id"])
    ps_row = next((r for r in ps.get("rows", []) if r.get("flat_number") == flat["flat_number"]), None)
    step(
        3,
        "Flat A-201: 1,250 × ₹5,200 + parking ₹2,50,000 + maintenance 3×24",
        "price ₹65,00,000 · parking attached · Project Statement shows the flat unsold · inventory value updated",
        (
            f"price={inr(flat['price_paise'] if 'price_paise' in flat else flat['price'] * 100)} status={flat['status']} parking={slot['number']} "
            f"ps_row={json.dumps({k: ps_row.get(k) for k in ('status', 'customer_name', 'agreement_paise') if ps_row} if ps_row else None)} "
            f"statement_totals={json.dumps(ps.get('totals'))[:160]}"
        ),
        "03_flat_pricing.jpeg",
    )
    assert round(flat.get("price") or 0) == 6500000
    # 4. Customer
    cust = api(
        "POST", "/customers", {"full_name": f"QA Ramesh {TAG}", "phone": f"98{uuid.uuid4().int % 10**8:08d}"}, 201
    )
    c360 = api("GET", f"/customers/{cust['id']}/panels")
    step(
        4,
        "Customer QA Ramesh",
        "Customer 360 opens with zero bookings/ledger",
        f"{cust['customer_code']} counts={c360.get('counts')}",
        "04_customer360_empty.jpeg",
    )
    # 5. Booking
    api(
        "POST",
        "/bookings/breakdown-preview",
        {"flat_id": flat["id"], "agreement_value": 6500000, "agreement_gst_percent": 5},
    )
    bk = api(
        "POST",
        "/bookings",
        {
            "flat_id": flat["id"],
            "customer_id": cust["id"],
            "booking_date": date.today().isoformat(),
            "agreement_value": 6500000,
            "cash_agreed": 3900000,
            "account_agreed": 2600000,
            "agreement_gst_percent": 5,
            "other_charges": None,
            "payment_plan_id": next(p["id"] for p in plans if p["is_default"]),
            "parking_slot_ids": [],
        },
        201,
    )
    full = api("GET", f"/bookings/{bk['id']}")
    flat_after = api("GET", f"/flats/{flat['id']}")
    c360 = api("GET", f"/customers/{cust['id']}/panels")
    reg = api("GET", "/demands/register", customer=bk["booking_number"], basis="raised", per_group=100)
    reg_rows = reg_rows_of(reg, bk["booking_number"])
    cost = (
        api("GET", f"/pdfs/bookings/{bk['id']}/cost-sheet.pdf")
        if False
        else requests.get(f"{BASE}/api/bookings/{bk['id']}/cost-sheet.pdf", headers=_h())
    )
    allot = requests.get(f"{BASE}/api/bookings/{bk['id']}/allotment.pdf", headers=_h())
    docs = api("GET", "/docgen/register", booking_id=bk["id"])
    ps = api("GET", "/reports/project-statement", project_id=proj["id"])
    ps_row = next((r for r in ps.get("rows", []) if r.get("flat_number") == flat["flat_number"]), None)
    audit = api("GET", "/audit-logs", entity_type="booking", entity_id=bk["id"], page_size=20)
    step(
        5,
        "Booking A-201 → QA Ramesh (GST 5 %, CLP default)",
        (
            "flat Booked · C360 shows booking + price · bills: 10 % + GST share + parking(+GST) raised today · cost sheet + allotment PDFs · "
            "documents "
            "register "
            "· Project "
            "Statement row "
            "with Bill "
            "raised & Due · "
            "audit chain"
        ),
        f"flat={flat_after['status']} total_final={inr(full['pricing']['total_final_value_paise'])} "
        f"charges={[(l['name'], inr(l['total_paise'])) for l in full['other_charges']]} "
        f"c360_bookings={len((c360.get('ledgers') or {}).get('bookings') or [])} "
        f"c360_summary={json.dumps({k: v for k, v in (c360.get('summary') or {}).items() if k in C360_KEYS})} "
        f"bills_today={[(r['demand_number'], inr(r['total_paise']), r['status']) for r in reg_rows]} "
        f"other_charges_demanded={inr(full['summary']['other_charges_demanded_paise'])} cost_sheet={cost.status_code}/{cost.content[:4]} "
        f"allotment={allot.status_code}/{allot.content[:4]} "
        f"documents={docs.get('total', len(docs.get('items', [])))} "
        f"ps_row={json.dumps(ps_row)[:220] if ps_row else None} "
        f"audit_actions={[a['action'] for a in audit['items']][:6]}",
        "05_booking_detail.jpeg, 05_customer360.jpeg, 05_demand_register.jpeg, 05_project_statement.jpeg",
    )
    assert flat_after["status"] == "Booked" and reg_rows and cost.status_code == 200 and allot.status_code == 200
    STATE.update(proj=proj, blk=blk, flat=flat, cust=cust, bk=bk, slot=slot, templates=(ft3, floor, sp, pp, tt))
    # 6. Payment auto
    modes = api("GET", "/master/payment-modes", page_size=50)["items"]
    cash = next(m for m in modes if m["code"] == "CASH")
    pv = api(
        "POST",
        "/payments/allocation-preview",
        {"booking_id": bk["id"], "amount": 500000, "payment_mode_id": cash["id"]},
    )
    pay = api(
        "POST",
        "/payments",
        {
            "booking_id": bk["id"],
            "allocation": "auto",
            "amount": 500000,
            "payment_date": date.today().isoformat(),
            "payment_mode_id": cash["id"],
        },
        201,
    )
    full = api("GET", f"/bookings/{bk['id']}")
    led = api("GET", f"/bookings/{bk['id']}/ledger")
    led_rows = [r for r in (led.get("rows") or led.get("items") or []) if r.get("ref") == pay["receipt_number"]]
    rec = requests.get(f"{BASE}/api/payments/{pay['id']}/receipt.pdf", headers=_h())
    roz = api("GET", "/roznamcha", date=date.today().isoformat())
    roz_hit = any(pay["receipt_number"] in json.dumps(e) for e in roz.get("receipts") or [])
    reg = api(
        "GET", "/demands/register", customer=bk["booking_number"], basis="raised", per_group=100, include_void="true"
    )
    reg_rows = reg_rows_of(reg, bk["booking_number"])
    step(
        6,
        "Payment: Cash ₹5,00,000 auto",
        (
            "allocated oldest-first (preview == receipt) · ledger Received rows per allocation · balance down · receipt PDF 'Applied to' · Roznamcha "
            "cash entry "
            "· Demand "
            "Register bills "
            "paid/part-paid"
        ),
        (
            f"allocations={[(a['name'], inr(a['amount_paise'])) for a in pay['allocations']]} "
            f"preview_match={pay['allocations'] == pv['allocations']} "
            f"ledger_rows={len(led_rows)} "
            f"balance={inr(full['summary']['balance_paise'])} "
            f"paid={inr(full['summary']['paid_paise'] + full['summary']['other_charges_paid_paise'])} "
            f"receipt_pdf={rec.status_code} "
            f"roznamcha_has_receipt={roz_hit} "
            f"bills={[(r['demand_number'], r['status']) for r in reg_rows]}"
        ),
        "06_payment_sheet.jpeg, 06_ledger.jpeg, 06_roznamcha.jpeg",
    )
    assert (
        pay["allocations"] == pv["allocations"] and len(led_rows) == len(pay["allocations"]) and rec.status_code == 200
    )
    # 7. Construction stage 1 complete
    cs = api("GET", f"/blocks/{blk['id']}/construction")
    nxt = next(
        s
        for s in cs["stages"]
        if s["status"] != "Completed"
        and s.get("code") != "BOOKING"
        and not s.get("auto_complete_on_booking")
        and s["name"] != "Booking"
    )
    before_dem = len(api("GET", f"/bookings/{bk['id']}")["demands"])
    api(
        "POST",
        f"/blocks/{blk['id']}/construction/stage",
        {"stage_id": nxt["stage_id"], "completed_on": date.today().isoformat()},
    )
    full = api("GET", f"/bookings/{bk['id']}")
    new_dem = [d for d in full["demands"]][before_dem:]
    docs = api("GET", "/docgen/register", booking_id=bk["id"])
    ps = api("GET", "/reports/project-statement", project_id=proj["id"])
    step(
        7,
        f"Construction: Tower A → '{nxt['name']}' complete",
        "15 % instalment (+GST share) raised for the booking · demand letter in documents · Project Statement totals updated · C360 timeline event",
        (
            f"new_bills={[(d['demand_number'], d.get('installment_name') or d.get('milestone_name'), inr(d['total_demand_paise'])) for d in new_dem]} "
            f"documents_now={docs.get('total', len(docs.get('items', [])))} "
            f"statement_totals={json.dumps(ps.get('totals'))[:200]}"
        ),
        "07_construction.jpeg, 07_booking_demands.jpeg",
    )
    assert new_dem, "stage completion must raise the plan instalment"
    # 8. Overdue
    od = api(
        "POST",
        "/demands/manual",
        {
            "booking_id": bk["id"],
            "name": f"QA overdue {TAG}",
            "account_amount": 10000,
            "due_date": "2026-01-31",
            "demand_date": "2026-01-01",
        },
        201,
    )
    reg = api(
        "GET", "/demands/register", customer=bk["booking_number"], basis="raised", status="Overdue", per_group=100
    )
    od_rows = [r for r in reg_rows_of(reg, bk["booking_number"]) if r["demand_number"] == od["demand_number"]]
    step(
        8,
        "Overdue / ageing",
        "a backdated bill shows the booking in Overdue with an age band",
        f"{[(r['demand_number'], r['status'], r['age_band']) for r in od_rows]} (backdated manual demand — as-of shifting not used)",
        "08_overdue.jpeg",
    )
    # 9. Cancel
    full = api("GET", f"/bookings/{bk['id']}")
    api("POST", f"/bookings/{bk['id']}/cancel", {"reason": f"QA story cancel {TAG}", "version": full["version"]})
    full = api("GET", f"/bookings/{bk['id']}")
    flat_after = api("GET", f"/flats/{flat['id']}")
    slot_after = next(
        x for x in api("GET", "/parking", project_id=proj["id"], page_size=50)["items"] if x["id"] == slot["id"]
    )
    refunds = api("GET", f"/bookings/{bk['id']}/refunds")
    ps = api("GET", "/reports/project-statement", project_id=proj["id"])
    ps_row = next(
        (r for r in ps.get("rows", []) if r.get("flat_number") == flat["flat_number"] and r.get("customer_name")), None
    )
    c360 = api("GET", f"/customers/{cust['id']}/panels")
    docs = api("GET", "/docgen/register", booking_id=bk["id"])
    step(
        9,
        "Cancel booking (policy deduction)",
        (
            "flat Available · slot back to Attached · open bills Cancelled · refund per policy · documents stamped VOID · statement row gone · "
            "C360 shows "
            "cancellation"
        ),
        (
            f"booking={full['status']} flat={flat_after['status']} slot={slot_after['status']} "
            f"demands={sorted(set(d['status'] for d in full['demands']))} "
            f"cancellation={ {k: inr(v) for k, v in full['cancellation'].items() if k.endswith('_paise')} } "
            f"refunds={len(refunds.get('items', refunds) if isinstance(refunds, dict) else refunds)} "
            f"ps_row={ps_row is None} "
            f"c360_status={[b.get('status') for b in (c360.get('ledgers') or {}).get('bookings') or []]} "
            f"c360_counts={c360.get('counts')} "
            f"docs_void={[(d['type'], bool(d.get('voided'))) for d in docs.get('items', [])]}"
        ),
        "09_cancelled_booking.jpeg",
    )
    assert full["status"] == "Cancelled" and flat_after["status"] == "Available"
    if keep:
        print("--keep: leaving scratch data for screenshots")
        write_md(pre, None)
        return
    cleanup(pre)


def cleanup(pre):
    s = STATE
    api("POST", f"/parking/{s['slot']['id']}/detach", {})
    requests.delete(f"{BASE}/api/parking/{s['slot']['id']}", headers=_h())
    requests.patch(f"{BASE}/api/blocks/{s['blk']['id']}", json={"is_active": False}, headers=_h())
    requests.patch(f"{BASE}/api/projects/{s['proj']['id']}", json={"is_active": False}, headers=_h())
    requests.patch(f"{BASE}/api/customers/{s['cust']['id']}", json={"is_active": False}, headers=_h())
    for kind, t in zip(
        ("master/flat-types", "floor-templates", "stage-plan-templates", "payment-plan-templates", "tower-templates"),
        s["templates"],
    ):
        requests.delete(f"{BASE}/api/{kind}/{t['id']}", headers=_h())
    post = headline()
    step(
        10,
        "Cleanup via audited paths",
        "integrity report clean · headline numbers back to the pre-story snapshot (cancelled booking + archived project remain as audit history)",
        (
            f"integrity_findings {pre['integrity_findings']} → {post['integrity_findings']} · tiles_equal={pre['tiles'] == post['tiles']} · projects "
            f"{pre['projects']}→{post['projects']} "
            f"customers "
            f"{pre['customers']}→{post['customers']} "
            f"bookings "
            f"{pre['bookings']}→{post['bookings']}"
        ),
        "10_integrity.jpeg",
    )
    write_md(pre, post)


def write_md(pre, post):
    lines = [
        f"# Phase S3.2 — full-story proof ({date.today().isoformat()}, tag {TAG})",
        "",
        (
            "Driver: `backend/tools/story_s3.py` (calls the same `/api` endpoints the UI uses; screenshots taken with Playwright on the "
            "preview after "
            "each step)."
        ),
        "",
        "| # | Step | Expected downstream effects | Observed | Screenshots |",
        "|---|---|---|---|---|",
    ]
    for n, t, e, o, sh in ROWS:
        lines.append(f"| {n} | {t} | {e} | {o.replace('|', '/')} | {sh} |")
    lines += [
        "",
        f"Pre snapshot: `{json.dumps(pre)[:400]}`",
        f"Post snapshot: `{json.dumps(post)[:400] if post else 'n/a (--keep)'}`",
    ]
    Path(f"{OUT}/story.md").write_text("\n".join(lines) + "\n")
    Path(f"{OUT}/state.json").write_text(
        json.dumps({k: v for k, v in STATE.items() if k not in ("h", "templates")}, default=str)
    )


if __name__ == "__main__" and "--purge-scratch" not in sys.argv:
    run(keep="--keep" in sys.argv)


def purge_scratch():
    """Deactivate/remove every scratch object the story created (all tags) through the same audited endpoints."""
    n = 0
    for pj in api("GET", "/projects", search="QA Story Heights", page_size=200, include_inactive="true")["items"]:
        for bk in api("GET", "/bookings", project_id=pj["id"], status="Active", page_size=100)["items"]:
            full = api("GET", f"/bookings/{bk['id']}")
            requests.post(
                f"{BASE}/api/bookings/{bk['id']}/cancel",
                json={"reason": "QA story scratch cleanup", "version": full["version"]},
                headers={**_h(), "Idempotency-Key": uuid.uuid4().hex},
            )
            n += 1
        for fl in api("GET", "/flats", project_id=pj["id"], status="Hold", page_size=100)["items"]:
            requests.post(f"{BASE}/api/flats/{fl['id']}/release-hold", json={}, headers=_h())
        for sl in api("GET", "/parking", project_id=pj["id"], page_size=100)["items"]:
            if sl["status"] == "Attached":
                requests.post(f"{BASE}/api/parking/{sl['id']}/detach", json={}, headers=_h())
            requests.delete(f"{BASE}/api/parking/{sl['id']}", headers=_h())
        for bl in api("GET", "/blocks", project_id=pj["id"], page_size=50)["items"]:
            requests.patch(f"{BASE}/api/blocks/{bl['id']}", json={"is_active": False}, headers=_h())
        r = requests.patch(f"{BASE}/api/projects/{pj['id']}", json={"is_active": False}, headers=_h())
        n += 1
        if r.status_code >= 300:
            print("project not deactivated:", pj["name"], r.text[:160])
    for c in api("GET", "/customers", search="QA Ramesh", page_size=200)["items"]:
        requests.patch(f"{BASE}/api/customers/{c['id']}", json={"is_active": False}, headers=_h())
        n += 1
    for kind, needle in (
        ("tower-templates", "QA G+3"),
        ("payment-plan-templates", "QA CLP"),
        ("stage-plan-templates", "QA 6 stages"),
        ("floor-templates", "2×3BHK-QA"),
        ("master/flat-types", "3BHK-QA"),
    ):
        for t in api("GET", f"/{kind}", page_size=200)["items"]:
            if needle in t["name"]:
                r = requests.delete(f"{BASE}/api/{kind}/{t['id']}", headers=_h())
                n += r.status_code < 300
    print("purged", n, "integrity:", (api("GET", "/admin/integrity-report", fresh=1).get("counts")))


if __name__ == "__main__" and "--purge-scratch" in sys.argv:
    purge_scratch()
