"""Phase 1 F-6: write /app/memory/qa/phase1/demo_journeys.md (per-booking journey lines + headline numbers) from the live DB/API
and refresh the generated story block in /app/memory/test_credentials.md. Run right after the story rebuild."""

import os
import re
import sys
from datetime import date
from pathlib import Path

import requests
from _env import DEMO_PASSWORD
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from services import clock
from tools.story_logic_check import bands, next_stage

BASE = os.environ.get("STORY_BASE_URL", "http://localhost:8001") + "/api"
H = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
OUT = Path("/app/memory/qa/phase1/demo_journeys.md")
CREDS = Path("/app/memory/test_credentials.md")
ROLES = (
    "owner",
    "bounce",
    "bounce2",
    "revision",
    "transfer",
    "swap",
    "cancel",
    "forfeit",
    "reverse",
    "fullpaid",
    "possession",
    "late30",
    "late60",
    "late90",
    "late90p",
    "noshow",
    "oc",
)


def inr(p):
    s = f"{abs(p) // 100:,}"
    return ("-" if p < 0 else "") + "₹" + s


def journey(db, b, blocks, projects):
    cust = db.customers.find_one({"id": b["customer_id"]}, {"_id": 0, "full_name": 1, "customer_code": 1}) or {}
    lead = db.leads.find_one({"id": b.get("lead_id")}, {"_id": 0, "source": 1, "created_at": 1}) or {}
    visit = db.site_visits.find_one({"lead_id": b.get("lead_id"), "status": "Completed"}, {"_id": 0, "date": 1}) or {}
    pays = list(
        db.payments.find({"booking_id": b["id"], "status": "Cleared"}, {"_id": 0, "payment_date": 1}).sort(
            "payment_date", 1
        )
    )
    dem = list(
        db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0, "demand_date": 1}).sort(
            "demand_date", 1
        )
    )
    s = b.get("summary") or {}
    flat = db.flats.find_one({"id": b["flat_id"]}, {"_id": 0, "flat_number": 1}) or {}
    role = (b.get("remarks") or "").split(" ")[0]
    where = f"{projects.get(b['project_id'])} · {blocks.get(b['block_id'])} · {flat.get('flat_number')}"
    bills = f"{dem[0]['demand_date']}…{dem[-1]['demand_date']}" if dem else "—"
    rcpts = f"{pays[0]['payment_date']}…{pays[-1]['payment_date']}" if pays else "—"
    dates = f"{clock.day_of(lead.get('created_at')) or ''} → {visit.get('date', '—')} → {b['booking_date']} → bills {bills} → receipts {rcpts}"
    money = f"{inr(b.get('agreement_value_paise', 0))} | {inr(s.get('paid_paise', 0))} | {inr(s.get('outstanding_paise', 0))}"
    return (
        f"| {b['booking_number']} | {role} | {cust.get('full_name')} ({cust.get('customer_code')}) | {where} "
        f"| {lead.get('source', '—')} | {dates} | {money} | {b['status']} |"
    )


def due_window(db, today):
    """Not-due open bills split by due date: within the next 30 days vs later (REQ-46)."""
    soon, later = set(), set()
    for d in db.demands.find(
        {
            "voided": {"$ne": True},
            "status": {"$in": ["Open", "Partially Paid"]},
            "due_date": {"$gt": today.isoformat()},
        },
        {"_id": 0, "booking_id": 1, "due_date": 1},
    ):
        (soon if (date.fromisoformat(d["due_date"]) - today).days <= 30 else later).add(d["booking_id"])
    return len(soon), len(later)


def _jrn11_lines(db, b, post) -> list[tuple[str, str]]:
    """E13: every open line of the JRN-11 booking, oldest first (= the auto-allocation order of a Cash receipt), and the
    exact Cash receipt that clears an instalment part + a charge part (Σ open lines up to the first charge line)."""
    cash = db.payment_modes.find_one({"code": "CASH"}, {"_id": 0, "id": 1})["id"]
    pv = post("/payments/allocation-preview", {"booking_id": b["id"], "amount": 10**9, "payment_mode_id": cash})
    lines = [a for a in pv["allocations"] if a["kind"] != "ADVANCE"]
    out, run, seen, exact = [], 0, set(), None
    for i, a in enumerate(lines, 1):
        what = "charge" if a["kind"] == "OTHER_CHARGE" else f"{a['category']} instalment part"
        out.append(
            (
                f"· JRN-11 open line {i}",
                f"{a['name']} ({what}) · due {a.get('due_date') or '—'} · {inr(a['open_paise'])}",
            )
        )
        run += a["open_paise"]
        seen.add(a["kind"])
        if exact is None and seen >= {"FLAT_VALUE", "OTHER_CHARGE"}:
            exact = (i, run)
    if exact:
        out.append(
            (
                "· JRN-11 exact payment (Cash, auto allocation)",
                f"{inr(exact[1])} clears open lines 1–{exact[0]} (instalment part + charge part), no advance",
            )
        )
    return out


def seed_facts(db, g, today, post):
    """Tester facts: next billing stage + expected ₹ (real preview), a JRN-11 booking, a free flat (JRN-4/18)."""
    rows = []
    for s in next_stage(db)[1]:
        pv = g(f"/blocks/{s['block_id']}/stages/{s['stage_id']}/preview")
        rows.append(
            (
                f"Next billing stage · {s['tower']}",
                f"{s['stage']} · {pv['bookings_count']} bookings · {inr(pv['total_paise'])}",
            )
        )
    blocks = {b["id"]: b for b in db.blocks.find({}, {"_id": 0, "id": 1, "name": 1, "project_id": 1})}
    sgh = (db.projects.find_one({"code": "SGH"}, {"_id": 0, "id": 1}) or {}).get("id")
    for b in db.bookings.find({"status": "Active", "project_id": sgh}, {"_id": 0}).sort("booking_date", 1):
        s = b.get("summary") or {}
        oc = [l for l in b.get("other_charges") or [] if (l.get("demanded_paise") or 0) > (l.get("paid_paise") or 0)]
        oc.sort(key=lambda l: l.get("code") != "PARKING")
        if (
            s.get("cash_due_paise", 0) > 0
            and oc
            and b.get("remarks") in ("story:ontime", "story:loan", "story:advance")
        ):
            rows.append(
                (
                    "JRN-11 booking (open Cash instalment + open other charge)",
                    f"{b['booking_number']} ({(b.get('remarks') or '').split(' ')[0]})",
                )
            )
            rows.extend(_jrn11_lines(db, b, post))
            break
    f = db.flats.find_one(
        {"status": "Available", "block_id": {"$in": list(blocks)}, "price_paise": {"$gt": 0}},
        {"_id": 0},
        sort=[("block_id", 1), ("floor", -1)],
    )
    if f:
        rows.append(
            (
                "Free flat to book (JRN-4/18)",
                f"{blocks[f['block_id']]['name']} · {f['flat_number']} · {inr(f['price_paise'])}",
            )
        )
    return rows


def home_expected(g) -> list[str]:
    """Phase 2D: every Home Command Center number (admin, all projects) with the list it must equal."""
    from tests.test_home_bundle import _numbers

    L = ["", "## Home Command Center — expected numbers (admin@kkt.in, all projects)", ""]
    for period in ("today", "month", "fy"):
        b = g("/home/bundle", period=period)
        L += [f"### Period: {b['period']['label']} ({b['period']['from']} → {b['period']['to']})", ""]
        L += ["| Widget | Figure | Value | Click opens | Must equal |", "|---|---|---|---|---|"]
        for wid, w in b["widgets"].items():
            if not w.get("ok"):
                L.append(f"| {b['labels'][wid]} | — | Couldn't load | | |")
                continue
            for n in _numbers(w["data"], []):
                api, params = n["drill"]["api"]
                pick = n["drill"]["pick"]
                cnt = pick.endswith(("count", "total")) and "count" in n
                val = n["count"] if cnt else inr(n.get("amount_paise") or 0)
                L.append(f"| {b['labels'][wid]} | {pick} | {val} | {n['drill']['to']} | {api} {params} → {pick} |")
        L.append("")
    return L


def main():
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    tok = requests.post(
        f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}, headers=H, timeout=30
    ).json()["access_token"]
    A = {**H, "Authorization": f"Bearer {tok}"}
    g = lambda p, **k: requests.get(BASE + p, headers=A, params=k, timeout=60).json()  # noqa: E731
    post = lambda p, body: requests.post(BASE + p, headers=A, json=body, timeout=60).json()  # noqa: E731
    blocks = {b["id"]: b["name"] for b in db.blocks.find({}, {"_id": 0, "id": 1, "name": 1})}
    projects = {p["id"]: p["code"] for p in db.projects.find({}, {"_id": 0, "id": 1, "code": 1})}
    marker = db.settings.find_one({"key": "story"}, {"_id": 0, "value": 1}) or {}
    today = date.fromisoformat(((marker.get("value") or {}).get("as_of")) or clock.today_iso())
    home = g("/dashboard")
    col = home.get("collections", {})
    fy0 = date(today.year if today.month >= 4 else today.year - 1, 4, 1).isoformat()
    fy = g("/reports/collections", from_date=fy0, to_date=today.isoformat()).get("totals") or {}
    out = g("/reports/outstanding").get("totals") or {}
    head = [
        ("Collected this month (Home)", inr(col.get("month", {}).get("total_paise", 0))),
        (
            "· Cash / Account / Other",
            " / ".join(inr(col.get("month", {}).get(f"{k}_paise", 0)) for k in ("Cash", "Account", "Other")),
        ),
        ("Collected today (Home)", inr(col.get("today", {}).get("total_paise", 0))),
        (
            "Cheques to clear (Pending)",
            f"{db.payments.count_documents({'status': 'Pending'})} · {inr(sum(p['amount_paise'] for p in db.payments.find({'status': 'Pending'})))}",
        ),
        ("Visits today", str(db.site_visits.count_documents({"date": today.isoformat()}))),
        ("Follow-ups due (Home)", str((home.get("follow_ups_due") or {}).get("count", 0))),
        (f"Collections FY from {fy0} (report)", inr(fy.get("total_paise", 0))),
        ("Outstanding (report)", inr(out.get("due_paise", 0))),
        ("Overdue (report)", inr(out.get("overdue_paise", 0))),
        *[
            (f"Ageing · {k}", f"{inr(v['paise'])} · {v['bookings']} bookings")
            for k, v in bands(db, today.isoformat())[1].items()
        ],
        ("Not due · bookings with a bill due within 30 days / later", " / ".join(map(str, due_window(db, today)))),
        *seed_facts(db, g, today, post),
        (
            "Bookings (all / Active / Completed / Cancelled)",
            " / ".join(
                str(db.bookings.count_documents(q))
                for q in ({}, {"status": "Active"}, {"status": "Completed"}, {"status": "Cancelled"})
            ),
        ),
    ]
    anchors = []
    for r in ROLES:
        b = db.bookings.find_one({"remarks": {"$regex": f"^story:{r}( |$|—)"}}, {"_id": 0, "booking_number": 1})
        if b:
            anchors.append(f"| `story:{r}` | {b['booking_number']} |")
    for tag, name in (("first", "Amit Kumar Sinha"), ("second", "Priya Verma")):
        c = db.customers.find_one({"full_name": name}, {"_id": 0}, sort=[("created_at", 1)])
        b = c and db.bookings.find_one({"customer_id": c["id"]}, {"_id": 0, "booking_number": 1})
        if b:
            anchors.append(f"| `{tag}` (portal buyer {c['full_name']}, {c['customer_code']}) | {b['booking_number']} |")
    L = [
        f"# Demo journeys — generated by `tools/demo_journeys.py` on {today} (DB `{os.environ['DB_NAME']}`, as-of {today})",
        "",
        "Numbers only go up across rebuilds (REQ-28), so booking/receipt numbers change on every rebuild. "
        "Find a journey by its role tag. Money totals, counts and statuses stay the same.",
        "",
        "## Headline numbers",
        "| Figure | Value |",
        "|---|---|",
        *[f"| {a} | {b} |" for a, b in head],
        "",
        "## Anchors by role",
        "| Role | Booking |",
        "|---|---|",
        *anchors,
        "",
        "## Per-booking journeys (lead → visit → booking → bills → receipts)",
        "| Booking | Role | Customer | Project · Tower · Flat | Source | Key dates | Total value | Received | Balance | Status |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    L += [journey(db, b, blocks, projects) for b in db.bookings.find({}, {"_id": 0}).sort("booking_date", 1)]
    L += home_expected(g)
    OUT.write_text("\n".join(L) + "\n")
    block = "\n".join(
        [
            "<!-- STORY:BEGIN (generated by tools/demo_journeys.py — do not hand-edit) -->",
            f"## Phase 1 story (as-of {today})",
            "",
            "| Role | Booking |",
            "|---|---|",
            *anchors,
            "",
            *[f"- {a}: {b}" for a, b in head],
            "<!-- STORY:END -->",
        ]
    )
    txt = CREDS.read_text()
    txt = (
        re.sub(r"<!-- STORY:BEGIN.*?<!-- STORY:END -->", block, txt, flags=re.S)
        if "STORY:BEGIN" in txt
        else txt.rstrip() + "\n\n" + block + "\n"
    )
    CREDS.write_text(txt)
    print("\n".join(L[:30]))


if __name__ == "__main__":
    main()
