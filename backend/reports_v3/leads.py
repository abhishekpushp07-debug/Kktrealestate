"""Phase 3F F6 Leads providers. Read-only. One lead row (owner, source, stage, first response, last action, follow-up,
visits, conversion) feeds every lead report; per-stage / per-source / per-person reports aggregate the filtered rows."""

from datetime import datetime, timedelta

from db import db
from deps import report_scope_filter
from services import clock, ttlcache
from services.pdf import inr

STAGES = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Converted", "Lost"]
OPEN = set(STAGES[:5])
RESP_BANDS = ["Within 1 h", "1–4 h", "4–24 h", "1–3 days", "Over 3 days", "Not yet"]
AGE_BANDS = ["0–7 days", "8–30 days", "31–90 days", "Over 90 days"]


def _dt(s):
    return datetime.fromisoformat(s) if s else None


def _resp_band(h):
    if h is None:
        return "Not yet"
    return (
        "Within 1 h"
        if h <= 1
        else "1–4 h"
        if h <= 4
        else "4–24 h"
        if h <= 24
        else "1–3 days"
        if h <= 72
        else "Over 3 days"
    )


def _age_band(d):
    return AGE_BANDS[0] if d <= 7 else AGE_BANDS[1] if d <= 30 else AGE_BANDS[2] if d <= 90 else AGE_BANDS[3]


async def base(user: dict, stamp: str | None = None) -> list[dict]:
    cid = user["company_id"]

    async def load():
        q = {"company_id": cid, "deleted_at": None, **report_scope_filter(user)}
        proj = {
            "_id": 0,
            "id": 1,
            "lead_number": 1,
            "name": 1,
            "phone": 1,
            "project_id": 1,
            "source": 1,
            "status": 1,
            "assigned_to": 1,
        }
        proj |= {
            "created_at": 1,
            "stage_history": 1,
            "follow_ups": 1,
            "activities": 1,
            "next_follow_up_at": 1,
            "lost_reason": 1,
            "booking_id": 1,
            "budget_max": 1,
        }
        leads = await db.leads.find(q, proj).to_list(None)
        users = {
            u["id"]: u.get("name") async for u in db.users.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1})
        }
        projects = {
            p["id"]: p.get("code") async for p in db.projects.find({"company_id": cid}, {"_id": 0, "id": 1, "code": 1})
        }
        visits = {}
        async for v in db.site_visits.find(
            {"company_id": cid, "is_active": {"$ne": False}, "lead_id": {"$ne": None}},
            {"_id": 0, "lead_id": 1, "status": 1},
        ):
            e = visits.setdefault(v["lead_id"], {"visits": 0, "visits_done": 0})
            e["visits"] += 1
            e["visits_done"] += v.get("status") == "Completed"
        bids = [l["booking_id"] for l in leads if l.get("booking_id")]
        value = {
            b["id"]: b.get("agreement_value_paise") or 0
            async for b in db.bookings.find(
                {"id": {"$in": bids}, "status": {"$ne": "Cancelled"}}, {"_id": 0, "id": 1, "agreement_value_paise": 1}
            )
        }
        now = clock.now()
        today = clock.today().isoformat()
        out = []
        for l in leads:
            hist = l.get("stage_history") or []
            created = _dt(l["created_at"])
            first = next((h for h in hist if h.get("status") not in (None, "New") and h.get("at")), None)
            resp = round((_dt(first["at"]) - created).total_seconds() / 3600, 1) if first else None
            touches = (
                [h.get("at") for h in hist]
                + [f.get("at") for f in l.get("follow_ups") or []]
                + [a.get("at") for a in l.get("activities") or []]
            )
            last = max([t for t in touches if t] or [l["created_at"]])
            lost = next((h for h in reversed(hist) if h.get("status") == "Lost"), None)
            nf, status = l.get("next_follow_up_at"), l.get("status") or "New"
            fu = None
            if nf and status in OPEN:
                # same rule as the existing Sales & leads report: overdue = the follow-up time has passed
                fu = "Overdue" if nf < now.isoformat() else "Today" if nf[:10] == today else "Upcoming"
            v = visits.get(l["id"], {"visits": 0, "visits_done": 0})
            converted = status == "Converted" or bool(l.get("booking_id"))
            age = (now - created).days
            idle = (now - _dt(last)).days
            fus = l.get("follow_ups") or []
            out.append(
                {
                    "lead_id": l["id"],
                    "lead_number": l.get("lead_number"),
                    "name": l.get("name"),
                    "phone": l.get("phone"),
                    "project_id": l.get("project_id") or "-",
                    "project": projects.get(l.get("project_id")) or "General",
                    "source": l.get("source") or "Unknown",
                    "status": status,
                    "owner_id": l.get("assigned_to") or "-",
                    "owner": users.get(l.get("assigned_to")) or "Unassigned",
                    "created_on": clock.day_of(l["created_at"]),
                    "age_days": age,
                    "age_band": _age_band(age),
                    "last_action_on": clock.day_of(last),
                    "idle_days": idle,
                    "first_response_hours": resp,
                    "response_band": _resp_band(resp),
                    "next_follow_up": clock.day_of(nf) if nf else None,
                    "follow_up_state": fu or "None set",
                    "follow_up_days_late": max((now - _dt(nf)).days, 0) if fu == "Overdue" else 0,
                    "last_note": (fus[-1].get("note") if fus else None) or "—",
                    "visits": v["visits"],
                    "visits_done": v["visits_done"],
                    "converted": converted,
                    "booking_value": value.get(l.get("booking_id"), 0),
                    "lost_reason": (l.get("lost_reason") or "Not recorded") if status == "Lost" else None,
                    "lost_on": clock.day_of(lost["at"]) if lost and status == "Lost" else None,
                    "days_to_lose": (_dt(lost["at"]) - created).days if lost and status == "Lost" else None,
                    "open": status in OPEN,
                    "budget": round((l.get("budget_max") or 0) * 100),
                }
            )
        return out

    key = f"rpt3:leads:{ttlcache.scope_key(user)}:{stamp}"
    return await ttlcache.cached(key, 600 if stamp else 60, load, stamped=bool(stamp), stamp=stamp)


async def options(user):
    rows = await base(user)
    opt = lambda f, lf: sorted({(r[f], r[lf]) for r in rows}, key=lambda x: str(x[1]))  # noqa: E731
    return {
        "project": [{"value": v, "label": l} for v, l in opt("project_id", "project")],
        "source": [{"value": v, "label": v} for v, _ in opt("source", "source")],
        "owner": [{"value": v, "label": l} for v, l in opt("owner_id", "owner")],
    }


def _filtered(rows, params, period_field="created_on"):
    """Aggregate reports filter the lead rows first (their filters are pushed down)."""
    keep = {"project": "project_id", "source": "source", "owner": "owner_id"}
    for k, f in keep.items():
        v = params.get(k)
        if v:
            vs = set(v if isinstance(v, list) else [v])
            rows = [r for r in rows if r[f] in vs]
    a, b = params.get("period_from"), params.get("period_to")
    if a:
        rows = [r for r in rows if r[period_field] and r[period_field] >= a]
    if b:
        rows = [r for r in rows if r[period_field] and r[period_field] <= b]
    return rows


async def register(user, ctx):
    return await base(user, ctx.get("stamp"))


async def funnel(user, ctx):
    rows = _filtered(await base(user, ctx.get("stamp")), ctx["params"])
    n = len(rows)
    reach = {s: 0 for s in STAGES}
    hist_reach = {}
    order = {s: i for i, s in enumerate(STAGES[:6])}
    for r in rows:
        i = order.get(r["status"])
        if i is not None:
            for s in STAGES[: i + 1]:
                reach[s] += 1
    for r in rows:
        hist_reach[r["status"]] = hist_reach.get(r["status"], 0) + 1
    out = []
    prev = None
    for s in STAGES:
        now_in = hist_reach.get(s, 0)
        row = {"stage": s, "seq": STAGES.index(s), "leads": now_in, "pct": round(100 * now_in / n, 1) if n else 0}
        if s != "Lost":
            row["reached"] = reach[s]
            row["step_pct"] = round(100 * reach[s] / prev, 1) if prev else 100.0
            prev = reach[s] or prev
        out.append(row)
    return out


def funnel_formula(t):
    n = t.get("leads", 0)
    c = t.get("converted_n", 0)
    return (
        f"{n:,} leads in the period · {c:,} converted = {100 * c / n:.1f}% · {t.get('lost_n', 0):,} lost · {t.get('open_n', 0):,} still open"
        if n
        else "No leads in the period"
    )


def funnel_totals(t, rows):
    by = {r["stage"]: r["leads"] for r in rows}
    return {
        "converted_n": by.get("Converted", 0),
        "lost_n": by.get("Lost", 0),
        "open_n": sum(by.get(s, 0) for s in STAGES[:5]),
    }


def funnel_illus(rows, t):
    return {"type": "counts", "title": "Leads now in each stage", "counts": {r["stage"]: r["leads"] for r in rows}}


async def sources(user, ctx):
    rows = _filtered(await base(user, ctx.get("stamp")), ctx["params"])
    agg = {}
    for r in rows:
        a = agg.setdefault(
            r["source"],
            {
                "source": r["source"],
                "leads": 0,
                "contacted": 0,
                "visited": 0,
                "converted": 0,
                "lost": 0,
                "booking_value": 0,
            },
        )
        a["leads"] += 1
        a["contacted"] += r["first_response_hours"] is not None
        a["visited"] += r["visits_done"] > 0
        a["converted"] += r["status"] == "Converted"
        a["lost"] += r["status"] == "Lost"
        a["booking_value"] += r["booking_value"]
    for a in agg.values():
        a["conversion_pct"] = round(100 * a["converted"] / a["leads"], 1) if a["leads"] else 0
        a["visit_pct"] = round(100 * a["visited"] / a["leads"], 1) if a["leads"] else 0
    return list(agg.values())


def pct_totals(t, rows):
    return {"conversion_pct": round(100 * t["converted"] / t["leads"], 1) if t.get("leads") else 0}


def sources_formula(t):
    return (
        f"{t.get('leads', 0):,} leads · {t.get('visited', 0):,} visited · {t.get('converted', 0):,} converted = "
        f"{t.get('conversion_pct', 0)}% · bookings from leads {inr(t.get('booking_value', 0))}"
    )


def sources_illus(rows, t):
    return {
        "type": "counts",
        "title": "Converted by source",
        "counts": {r["source"]: r["converted"] for r in sorted(rows, key=lambda r: -r["converted"])},
    }


async def follow_ups(user, ctx):
    return [r for r in await base(user, ctx.get("stamp")) if r["follow_up_state"] != "None set"]


def fu_totals(t, rows):
    c = {s: 0 for s in ("Overdue", "Today", "Upcoming")}
    for r in rows:
        c[r["follow_up_state"]] += 1
    return {"fu": c, "n": len(rows)}


def fu_formula(t):
    c = t.get("fu") or {}
    n = t.get("n", 0)
    return (
        f"{c.get('Overdue', 0):,} overdue + {c.get('Today', 0):,} due today + {c.get('Upcoming', 0):,} upcoming "
        f"= {n:,} open lead{'s' if n != 1 else ''} with a follow-up"
    )


def fu_illus(rows, t):
    c = t.get("fu") or {}
    return {
        "type": "split_bar",
        "title": "Follow-ups",
        "count": True,
        "parts": [
            {"label": "Overdue", "value": c.get("Overdue", 0), "tone": "coral"},
            {"label": "Today", "value": c.get("Today", 0), "tone": "sapphire"},
            {"label": "Upcoming", "value": c.get("Upcoming", 0), "tone": "steel"},
        ],
    }


async def visits(user, ctx):
    cid = user["company_id"]
    leads = {r["lead_id"]: r for r in await base(user, ctx.get("stamp"))}
    users = {u["id"]: u.get("name") async for u in db.users.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1})}
    projects = {
        p["id"]: p.get("code") async for p in db.projects.find({"company_id": cid}, {"_id": 0, "id": 1, "code": 1})
    }
    q = {"company_id": cid, "is_active": {"$ne": False}, **report_scope_filter(user)}
    out = []
    async for v in db.site_visits.find(
        q,
        {
            "_id": 0,
            "id": 1,
            "visit_number": 1,
            "date": 1,
            "slot_start": 1,
            "name": 1,
            "project_id": 1,
            "status": 1,
            "outcome": 1,
            "assigned_to": 1,
            "lead_id": 1,
            "visitors_count": 1,
        },
    ):
        ld = leads.get(v.get("lead_id")) or {}
        out.append(
            {
                "visit_number": v.get("visit_number"),
                "date": v.get("date"),
                "slot": v.get("slot_start") or "—",
                "name": v.get("name"),
                "project_id": v.get("project_id") or "-",
                "project": projects.get(v.get("project_id")) or "—",
                "status": v.get("status") or "—",
                "outcome": v.get("outcome") or ("No outcome recorded" if v.get("status") == "Completed" else "—"),
                "owner_id": v.get("assigned_to") or "-",
                "owner": users.get(v.get("assigned_to")) or "Unassigned",
                "visitors": v.get("visitors_count") or 1,
                "lead_number": ld.get("lead_number") or "—",
                "source": ld.get("source") or "—",
                "converted": "Yes" if v.get("status") == "Completed" and ld.get("converted") else "No",
            }
        )
    return out


def visit_totals(t, rows):
    c = {}
    for r in rows:
        c[r["status"]] = c.get(r["status"], 0) + 1
    done = c.get("Completed", 0)
    conv = sum(1 for r in rows if r["converted"] == "Yes")
    return {
        "by_status": c,
        "n": len(rows),
        "converted_n": conv,
        "conversion_pct": round(100 * conv / done, 1) if done else 0,
    }


def visit_formula(t):
    c = t.get("by_status") or {}
    parts = " + ".join(f"{v:,} {k.lower()}" for k, v in sorted(c.items()))
    return (
        f"{parts} = {t.get('n', 0):,} visits · {t.get('converted_n', 0):,} of {c.get('Completed', 0):,} completed "
        f"visits converted = {t.get('conversion_pct', 0)}%"
    )


def visit_illus(rows, t):
    c = t.get("by_status") or {}
    tone = {"Completed": "sapphire", "Confirmed": "graphite", "No-show": "steel", "Cancelled": "muted"}
    return {
        "type": "split_bar",
        "title": "Visits by status",
        "count": True,
        "parts": [{"label": k, "value": v, "tone": tone.get(k, "steel")} for k, v in sorted(c.items())],
    }


async def lost(user, ctx):
    return [r for r in await base(user, ctx.get("stamp")) if r["status"] == "Lost"]


def lost_totals(t, rows):
    c = {}
    for r in rows:
        c[r["lost_reason"]] = c.get(r["lost_reason"], 0) + 1
    return {"reasons": c, "n": len(rows)}


def lost_formula(t):
    c = t.get("reasons") or {}
    return (
        " + ".join(f"{v:,} {k.lower()}" for k, v in sorted(c.items(), key=lambda x: -x[1]))
        + f" = {t.get('n', 0):,} lost leads"
        if c
        else "No lost leads"
    )


def lost_illus(rows, t):
    return {"type": "counts", "title": "Why leads were lost", "counts": t.get("reasons") or {}}


def resp_totals(t, rows):
    hs = sorted(r["first_response_hours"] for r in rows if r["first_response_hours"] is not None)
    c = {b: 0 for b in RESP_BANDS}
    for r in rows:
        c[r["response_band"]] += 1
    med = (hs[len(hs) // 2] if len(hs) % 2 else (hs[len(hs) // 2 - 1] + hs[len(hs) // 2]) / 2) if hs else None
    return {
        "bands": c,
        "responded": len(hs),
        "n": len(rows),
        "median_h": round(med, 1) if med is not None else None,
        "avg_h": round(sum(hs) / len(hs), 1) if hs else None,
    }


def resp_formula(t):
    if not t.get("responded"):
        return "No first responses in the selection"
    return (
        f"{t['responded']:,} of {t.get('n', 0):,} leads responded · median first response {t['median_h']} h · average "
        f"{t['avg_h']} h (enquiry → first stage after New)"
    )


def resp_illus(rows, t):
    return {"type": "counts", "title": "First response", "counts": t.get("bands") or {}}


async def team(user, ctx):
    rows = _filtered(await base(user, ctx.get("stamp")), ctx["params"])
    cid = user["company_id"]
    now = clock.today()
    soon = (now + timedelta(days=7)).isoformat()
    vq = {
        "company_id": cid,
        "is_active": {"$ne": False},
        "status": "Confirmed",
        "date": {"$gte": now.isoformat(), "$lte": soon},
        **report_scope_filter(user),
    }
    upcoming = {}
    async for v in db.site_visits.find(vq, {"_id": 0, "assigned_to": 1}):
        upcoming[v.get("assigned_to") or "-"] = upcoming.get(v.get("assigned_to") or "-", 0) + 1
    agg = {}
    for r in rows:
        a = agg.setdefault(
            r["owner_id"],
            {
                "owner_id": r["owner_id"],
                "owner": r["owner"],
                "open": 0,
                "new": 0,
                "contacted": 0,
                "visit_scheduled": 0,
                "visit_done": 0,
                "negotiation": 0,
                "fu_overdue": 0,
                "converted": 0,
                "lost": 0,
                "booking_value": 0,
            },
        )
        k = {
            "New": "new",
            "Contacted": "contacted",
            "Site Visit Scheduled": "visit_scheduled",
            "Site Visit Done": "visit_done",
            "Negotiation": "negotiation",
        }.get(r["status"])
        if k:
            a[k] += 1
            a["open"] += 1
        a["fu_overdue"] += r["follow_up_state"] == "Overdue"
        a["converted"] += r["status"] == "Converted"
        a["lost"] += r["status"] == "Lost"
        a["booking_value"] += r["booking_value"]
    for k, a in agg.items():
        a["visits_next_7"] = upcoming.get(k, 0)
    return list(agg.values())


def team_formula(t):
    at_visit = t.get("visit_scheduled", 0) + t.get("visit_done", 0)
    return (
        f"{t.get('open', 0):,} open leads ({t.get('new', 0):,} new · {t.get('contacted', 0):,} contacted · {at_visit:,} "
        f"at visit · {t.get('negotiation', 0):,} negotiating) · {t.get('fu_overdue', 0):,} follow-ups overdue · "
        f"{t.get('visits_next_7', 0):,} visits in the next 7 days"
    )


def team_illus(rows, t):
    return {
        "type": "counts",
        "title": "Open leads per person",
        "counts": {r["owner"]: r["open"] for r in sorted(rows, key=lambda r: -r["open"])},
    }


async def ageing(user, ctx):
    return [r for r in await base(user, ctx.get("stamp")) if r["open"]]


def age_totals(t, rows):
    c = {b: 0 for b in AGE_BANDS}
    for r in rows:
        c[r["age_band"]] += 1
    return {"bands": c, "n": len(rows), "idle_30": sum(1 for r in rows if r["idle_days"] > 30)}


def age_formula(t):
    c = t.get("bands") or {}
    return (
        " + ".join(f"{c.get(b, 0):,} ({b.lower()} old)" for b in AGE_BANDS)
        + f" = {t.get('n', 0):,} open leads · {t.get('idle_30', 0):,} untouched for over 30 days"
    )


def age_illus(rows, t):
    return {"type": "counts", "title": "Open leads by age", "counts": t.get("bands") or {}}
