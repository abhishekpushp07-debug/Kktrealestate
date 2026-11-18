import re
import sys

B = "/app/backend/"
R = {
    "routers/bootstrap.py": [
        ("today = now_iso()[:10]", "today = clock.today_iso()"),
        ('"next_follow_up_at": {"$lte": now_iso()},', '"next_follow_up_at": {"$lte": clock.day_end_utc()},'),
    ],
    "routers/reports_n.py": [
        ('"as_of": now_iso()[:10],', '"as_of": clock.today_iso(),', 4),
        ("now = datetime.now(timezone.utc)\n    soon", "now = clock.now()\n    soon"),
    ],
    "routers/demand_register.py": [("today = now_iso()[:10]", "today = clock.today_iso()", 3)],
    "routers/messaging.py": [
        ("as_of=now_iso()[:10],", "as_of=clock.today_iso(),"),
        ('"due_date": now_iso()[:10]}', '"due_date": clock.today_iso()}'),
        ("days = max((date.today() - ", "days = max((clock.today() - "),
        (
            '**({"$lte": date_to + "T23:59:59" if date_to else "~"} if date_to else {}),',
            '**({"$lte": clock.day_end_utc(date_to)} if date_to else {}),',
        ),
        ('**({"$gte": date_from} if date_from else {}),', '**({"$gte": clock.day_start_utc(date_from)} if date_from else {}),', 2),
        ('**({"$lte": date_to + "T23:59:59"} if date_to else {}),', '**({"$lte": clock.day_end_utc(date_to)} if date_to else {}),'),
    ],
    "routers/notifications.py": [("today = now_iso()[:10]", "today = clock.today_iso()")],
    "routers/project_setup.py": [
        ('"effective_to": now_iso()[:10]}', '"effective_to": clock.today_iso()}'),
        ('"effective_from": now_iso()[:10]}', '"effective_from": clock.today_iso()}'),
    ],
    "routers/customers.py": [("today = now_iso()[:10]", "today = clock.today_iso()")],
    "routers/docgen.py": [
        ("today = now_iso()[:10]", "today = clock.today_iso()"),
        ('{"$gte": ["$generated_at", today]}', '{"$gte": ["$generated_at", clock.day_start_utc(today)]}'),
        ('{"$gte": ["$generated_at", today[:7]]}', '{"$gte": ["$generated_at", clock.day_start_utc(today[:8] + "01")]}'),
        ('**({"$gte": date_from} if date_from else {}),', '**({"$gte": clock.day_start_utc(date_from)} if date_from else {}),'),
        ('**({"$lte": date_to + "T23:59:59"} if date_to else {}),', '**({"$lte": clock.day_end_utc(date_to)} if date_to else {}),'),
    ],
    "services/documents.py": [
        ("today = now_iso()[:10]", "today = clock.today_iso()"),
        ("date=now_iso()[:10],", "date=clock.today_iso(),"),
        ('date=(r.get("created_at") or now_iso())[:10],', 'date=clock.day_of(r.get("created_at")) or clock.today_iso(),'),
        ("_pdf.fmt_date(b['cancelled_at'][:10])", "_pdf.fmt_date(clock.day_of(b['cancelled_at']))"),
        ("_pdf.fmt_date((d.get('voided_at') or '')[:10])", "_pdf.fmt_date(clock.day_of(d.get('voided_at')) or '')"),
    ],
    "services/messaging/outbox.py": [('"as_of": as_of or now_iso()[:10],', '"as_of": as_of or clock.today_iso(),')],
    "seed_phase5.py": [('(m.get("completed_on") or now_iso()[:10])', '(m.get("completed_on") or clock.today_iso())')],
    "routers/files.py": [("> datetime.now(timezone.utc).date().isoformat()", "> clock.today_iso()")],
    "routers/public.py": [("TODAY = lambda: datetime.now(UTC).date().isoformat()", "TODAY = clock.today_iso")],
    "routers/propagation.py": [('"date": a["created_at"][:10]}', '"date": clock.day_of(a["created_at"])}')],
    "routers/construction.py": [('"accepted_on": ts[:10],', '"accepted_on": clock.day_of(ts),')],
    "services/ledger.py": [('"date": at[:10],', '"date": clock.day_of(at),')],
    "services/allocation.py": [
        ('"due_date": (l.get("due_date") or l["demanded_at"])[:10],', '"due_date": clock.day_of(l.get("due_date") or l["demanded_at"]),')
    ],
    "services/definitions.py": [
        ('((l.get("demanded_at") or "")[:10], l.get("demanded_paise") or 0)', '(clock.day_of(l["demanded_at"]), l.get("demanded_paise") or 0)')
    ],
    "services/trends.py": [("d = (until or date.today()).replace(day=1)", "d = (until or clock.today()).replace(day=1)")],
    "services/alerts.py": [("today = datetime.now(UTC).date().isoformat()", "today = clock.today_iso()")],
    "services/job_runs.py": [("today = _now().date().isoformat()", "today = clock.today_iso()")],
    "services/numbering.py": [("d = d or clock.now().date()", "d = d or clock.today()")],
    "routers/home.py": [('"posted_at": {"$gte": today}}', '"posted_at": {"$gte": clock.day_start_utc(today)}}')],
    "routers/dashboard.py": [("end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()", "end = clock.day_end_utc()")],
    "routers/dashboard_widgets.py": [
        ("end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()", "end = clock.day_end_utc()")
    ],
    "routers/leads.py": [
        ("end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()", "end = clock.day_end_utc()"),
        (
            '"next_follow_up_at": body.next_follow_up_at.isoformat() if body.next_follow_up_at else None,',
            '"next_follow_up_at": clock.to_utc_iso(body.next_follow_up_at),',
        ),
    ],
    "routers/crm.py": [
        (
            '**({"next_follow_up_at": body.next_follow_up_at.isoformat()} if body.next_follow_up_at else {}),',
            '**({"next_follow_up_at": clock.to_utc_iso(body.next_follow_up_at)} if body.next_follow_up_at else {}),',
        )
    ],
    "services/read_models.py": [('"next_follow_up_at": {"$lte": now_iso()},', '"next_follow_up_at": {"$lte": clock.day_end_utc()},')],
    "routers/roznamcha.py": [
        (
            '"reversal.at": {"$gte": d1.isoformat(), "$lte": d2.isoformat() + "T23:59:59.999999+00:00"},',
            '"reversal.at": clock.day_range(d1, d2),',
        )
    ],
    "routers/reports.py": [
        ('"cancellation.at": {"$gte": f, "$lte": t + "T23:59:59"}}', '"cancellation.at": clock.day_range(f, t)}'),
        ('"created_at": {"$gte": f, "$lte": t + "T23:59:59"},', '"created_at": clock.day_range(f, t),'),
        ('rng = {"$gte": f, "$lte": t + "T23:59:59"}', "rng = clock.day_range(f, t)"),
        ('"created_at": {"$gte": f, "$lte": t + "T23:59:59"}}', '"created_at": clock.day_range(f, t)}'),
    ],
    "routers/reports_i.py": [
        (
            'return (p.get("cleared_at") or p["payment_date"])[:10] if date_basis',
            'return clock.day_of(p.get("cleared_at") or p["payment_date"]) if date_basis',
        ),
        ('rd = (p["reversal"].get("at") or p["updated_at"])[:10]', 'rd = clock.day_of(p["reversal"].get("at") or p["updated_at"])'),
        ('"created_at": {"$gte": f, "$lte": t + "T23:59:59"}}', '"created_at": clock.day_range(f, t)}'),
    ],
    "routers/audit.py": [
        ('rng["$gte"] = date_from\n', 'rng["$gte"] = date_from if len(date_from) > 10 else clock.day_start_utc(date_from)\n'),
        (
            'rng["$lte"] = date_to if len(date_to) > 10 else date_to + "T23:59:59.999999+00:00"',
            'rng["$lte"] = date_to if len(date_to) > 10 else clock.day_end_utc(date_to)',
        ),
    ],
    "routers/visits.py": [("clock.now(IST).date().isoformat()", "clock.today_iso()", 3), ("clock.now(IST).date()", "clock.today()", 2)],
    "services/pdf.py": [("return clock.now(clock.IST).date().isoformat()", "return clock.today_iso()")],
    "services/messaging/reminders.py": [("as_of = as_of or datetime.now(IST).date().isoformat()", "as_of = as_of or clock.today_iso()")],
    "routers/demo_refresh.py": [
        ("datetime.now(UTC), datetime.now(clock.IST).date().isoformat()", "datetime.now(UTC), clock.today_iso()"),
        ('"as_of": datetime.now(clock.IST).date().isoformat()}', '"as_of": clock.today_iso()}'),
    ],
    "routers/admin.py": [('kkt-backup-{b["created_at"][:10]}.zip', 'kkt-backup-{clock.day_of(b["created_at"])}.zip')],
    "routers/exports.py": [("filename=f\"{e['report']}-{e['created_at'][:10]}.csv\"", "filename=f\"{e['report']}-{clock.day_of(e['created_at'])}.csv\"")],
    "routers/project_statement.py": [
        ("{now_iso()[:16].replace('T', ' ')}", "{clock.now(clock.business_tz()).strftime('%Y-%m-%d %H:%M')}")
    ],
}
total, bad = 0, []
for f, reps in R.items():
    p = B + f
    s = open(p).read()
    for r in reps:
        old, new, n = (r + (1,))[:3]
        c = s.count(old)
        if c != n:
            bad.append(f"{f}: expected {n} got {c}: {old[:70]}")
            continue
        s = s.replace(old, new)
        total += n
    if not re.search(r"^from services import (.*\bclock\b)", s, re.M) and "clock." in s:
        lines = s.split("\n")
        idx = next(i for i, l in enumerate(lines) if re.match(r"^(import \S+|from \S+ import [^(]+)$", l))
        lines.insert(idx + 1, "from services import clock")
        s = "\n".join(lines)
    open(p, "w").write(s)
print("replaced", total)
print("\n".join(bad) or "all matched")
sys.exit(1 if bad else 0)
