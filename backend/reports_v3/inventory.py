"""Phase 3F F5 Project & inventory providers. Read-only. Every flat goes through services.inventory.shape, so a viewer
without the real-status permission sees the display layer only (masked = Sold, Hidden dropped) — same as the flat screens."""

import asyncio
from datetime import timedelta

from db import db
from deps import report_scope_filter
from reports_v3.customers import customer_status
from services import clock, ttlcache
from services import inventory as INV
from services.pdf import inr

ORDER = ["Available", "Hold", "Blocked", "Booked", "Sold"]
TONE = {"Available": "sapphire", "Hold": "sapphire-soft", "Blocked": "muted", "Booked": "slate", "Sold": "graphite"}


async def _names(cid: str):
    blocks = {
        b["id"]: b async for b in db.blocks.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1, "project_id": 1})
    }
    projects = {
        p["id"]: p async for p in db.projects.find({"company_id": cid}, {"_id": 0, "id": 1, "code": 1, "name": 1})
    }
    return blocks, projects


def _flat_dims(f: dict, blocks: dict, projects: dict) -> dict:
    b, pr = blocks.get(f.get("block_id")) or {}, projects.get(f.get("project_id")) or {}
    fl = f.get("floor")
    fname = "Ground" if fl == 0 else f"Floor {fl}" if fl is not None else "—"
    return {
        "project_id": f.get("project_id"),
        "project": pr.get("code") or "—",
        "tower_id": f.get("block_id"),
        "tower": b.get("name") or "—",
        "floor_id": f"{f.get('block_id')}:{fl}",
        "floor": fname,
        "floor_label": f"{b.get('name')} · {fname}",
        "floor_no": fl if isinstance(fl, int) else -1,
        "flat_id": f["id"],
        "flat": f.get("flat_number"),
        "flat_code": f"{pr.get('code')} · {b.get('name')} · {f.get('flat_number')}",
    }


async def flats(user: dict, ctx: dict) -> list[dict]:
    """One row per flat the viewer may see, in the viewer's inventory layer. A display-layer viewer sees a buyer's name
    only on their own booking, and only where the flat already shows as Sold (so a name can never hint at a mask)."""
    real, me = INV.can_see_real(user), user["id"]

    async def load():
        cid = user["company_id"]
        q = {"company_id": cid, "deleted_at": None, **report_scope_filter(user)}
        (blocks, projects), docs = await asyncio.gather(_names(cid), db.flats.find(q, {"_id": 0}).to_list(None))
        bq = {"company_id": cid, "status": {"$in": ["Active", "Completed"]}, **({} if real else {"sales_user_id": me})}
        bk = {
            b["flat_id"]: b
            async for b in db.bookings.find(
                bq,
                {"_id": 0, "flat_id": 1, "customer_name": 1, "customer_id": 1, "booking_number": 1, "booking_date": 1},
            )
        }
        out = []
        for f in docs:
            s = INV.shape(dict(f), user)
            if s is None:
                continue
            b = bk.get(f["id"]) if real or s["status"] == "Sold" else None
            b = b or {}
            h = s.get("hold") or {}
            row = _flat_dims(f, blocks, projects) | {
                "flat_type": f.get("flat_type_code") or "—",
                "facing": f.get("facing") or "—",
                "area": f.get("saleable_sqft") or 0,
                "rate": round((f.get("rate_per_sqft") or 0) * 100),
                "price": f.get("price_paise") or 0,
                "status": s["status"],
                "category": s.get("allocation_category_code") or "BUILDER",
                "customer_id": b.get("customer_id") or "-",
                "customer_label": b.get("customer_name") or "—",
                "customer_name": b.get("customer_name") or "—",
                "booking_number": b.get("booking_number"),
                "booking_date": b.get("booking_date"),
                "hold_expires": h.get("expires_at"),
                "hold_reason_id": h.get("reason_id"),
                "hold_for_user": h.get("for_user_id"),
                "hold_for_customer": h.get("for_customer_id"),
                "hold_note": h.get("note") if real else None,
            }
            if real:
                row |= {
                    "shown_as": s["display_state"],
                    "masked": s["masked"],
                    "display_reason": f.get("display_reason") or "—",
                    "display_since": clock.day_of(f.get("display_set_at")) if f.get("display_set_at") else None,
                }
            out.append(row)
        return out

    who = "real" if real else f"display:{me}"
    return await ttlcache.cached(
        f"rpt3:flats:{ttlcache.scope_key(user)}:{who}:{ctx.get('stamp')}", 600, load, stamped=True
    )


async def holds(user, ctx):
    """Flats on hold now (viewer's layer): reason, for whom, by whom, when it lapses. Names only to real-status viewers
    or the person holding it."""
    from datetime import datetime

    real, now = INV.can_see_real(user), clock.now()
    rows = [r for r in await flats(user, ctx) if r["status"] == "Hold"]
    cid = user["company_id"]
    reasons = {
        x["id"]: x.get("name") async for x in db.hold_reasons.find({"company_id": cid}, {"_id": 0, "id": 1, "name": 1})
    }
    users = {u["id"]: u.get("name") async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1})}
    cids = [r["hold_for_customer"] for r in rows if r["hold_for_customer"]]
    custs = {
        c["id"]: c.get("full_name")
        async for c in db.customers.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "full_name": 1})
    }
    out = []
    for r in rows:
        exp = datetime.fromisoformat(r["hold_expires"]) if r["hold_expires"] else None
        left = round((exp - now).total_seconds() / 3600, 1) if exp else None
        mine = real or r["hold_for_user"] == user["id"]
        out.append(
            r
            | {
                "state": "Expiring < 48 h" if left is not None and left < 48 else "Active",
                "expires_on": clock.day_of(r["hold_expires"]) if r["hold_expires"] else None,
                "hours_left": left,
                "reason": reasons.get(r["hold_reason_id"]) or "—",
                "held_by": users.get(r["hold_for_user"]) or "—",
                "held_by_id": r["hold_for_user"] or "-",
                "customer_name": (custs.get(r["hold_for_customer"]) or "—") if mine else "—",
                "customer_id": (r["hold_for_customer"] or "-") if mine else "-",
                "customer_label": (custs.get(r["hold_for_customer"]) or "—") if mine else "—",
                "note": (r["hold_note"] or "—") if real else "—",
            }
        )
    return out


def holds_totals(t, rows):
    return {"holds": len(rows), "expiring": sum(1 for r in rows if r["state"].startswith("Expiring"))}


def holds_formula(t):
    return f"{t.get('holds', 0):,} flats on hold ({t.get('expiring', 0):,} lapse within 48 h) · list value on hold {inr(t.get('price', 0))}"


def holds_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Holds",
        "count": True,
        "parts": [
            {"label": "Active", "value": t.get("holds", 0) - t.get("expiring", 0), "tone": "sapphire"},
            {"label": "Lapse within 48 h", "value": t.get("expiring", 0), "tone": "steel"},
        ],
    }


def status_totals(t, rows):
    c = {s: 0 for s in ORDER}
    v = {s: 0 for s in ORDER}
    for r in rows:
        c[r["status"]] = c.get(r["status"], 0) + 1
        v[r["status"]] = v.get(r["status"], 0) + r["price"]
    return {
        "flats": len(rows),
        "by_status": c,
        "value_by_status": v,
        "masked_n": sum(1 for r in rows if r.get("masked")),
    }


def status_formula(t):
    c = t.get("by_status") or {}
    parts = " + ".join(f"{c.get(s, 0):,} {s.lower()}" for s in ORDER if c.get(s))
    vb = t.get("value_by_status") or {}
    unsold = vb.get("Available", 0) + vb.get("Hold", 0)
    return f"{parts} = {t.get('flats', 0):,} flats · list value {inr(t.get('price', 0))} (unsold {inr(unsold)})"


def status_illus(rows, t):
    c = t.get("by_status") or {}
    return {
        "type": "split_bar",
        "title": "Flats by status",
        "count": True,
        "parts": [{"label": s, "value": c.get(s, 0), "tone": TONE[s]} for s in ORDER if c.get(s)],
    }


def stack_illus(rows, t):
    """Floors × flats per tower, towers grouped by project (ground floors aligned), coloured by status (viewer's layer)."""
    from reports_v3.engine import _natural

    towers = {}
    for r in rows:
        tw = towers.setdefault(r["tower_id"], {"project": r["project"], "name": r["tower"], "floors": {}})
        tw["floors"].setdefault(r["floor_no"], []).append(
            {"flat": r["flat"], "status": r["status"], "type": r["flat_type"]}
        )
    projects = {}
    for tw in sorted(towers.values(), key=lambda x: _natural(x["name"])):
        floors = [
            {"floor": "G" if k == 0 else str(k), "flats": sorted(v, key=lambda x: _natural(x["flat"] or ""))}
            for k, v in sorted(tw["floors"].items(), reverse=True)
        ]
        projects.setdefault(tw["project"], []).append({"name": tw["name"], "floors": floors})
    seen = {r["status"] for r in rows}  # a display-layer viewer's legend never names Booked / Blocked
    return {
        "type": "stack",
        "title": "Stacking plan",
        "projects": [{"name": k, "towers": v} for k, v in sorted(projects.items())],
        "legend": [s for s in ORDER if s in seen],
    }


async def unsold(user, ctx):
    return [r | {"unsold": True} for r in await flats(user, ctx) if r["status"] in ("Available", "Hold")]


def price_formula(t):
    rate = f" = {inr(t['price'] / t['area'])} per sq ft average" if t.get("area") else ""
    return (
        f"{t.get('flats', 0):,} unsold flats ({(t.get('by_status') or {}).get('Available', 0):,} available + {(t.get('by_status') or {}).get('Hold', 0):,} "
        f"on hold) · list value {inr(t.get('price', 0))} over {t.get('area', 0):,.0f} sq ft{rate}"
    )


def price_illus(rows, t):
    v = t.get("value_by_status") or {}
    return {
        "type": "split_bar",
        "title": "Unsold stock value",
        "parts": [
            {"label": "Available", "value": v.get("Available", 0), "tone": "sapphire"},
            {"label": "On hold", "value": v.get("Hold", 0), "tone": "steel"},
        ],
    }


async def special(user, ctx):
    """Landowner / other non-builder categories for everyone with the report; masked units for real-status viewers only."""
    out = []
    for r in await flats(user, ctx):
        kinds = (
            ["Landowner"] if r["category"] == "LANDOWNER" else ["Other category"] if r["category"] != "BUILDER" else []
        ) + (["Masked"] if r.get("masked") else [])
        for k in kinds:
            out.append(r | {"kind": k})
    return out


def special_formula(t):
    c = t.get("kinds") or {}
    return (
        f"{c.get('Landowner', 0):,} landowner + {c.get('Other category', 0):,} other-category + {c.get('Masked', 0):,} "
        f"masked = {t.get('n', 0):,} units · list value {inr(t.get('price', 0))}"
    )


def special_totals(t, rows):
    c = {}
    for r in rows:
        c[r["kind"]] = c.get(r["kind"], 0) + 1
    return {"kinds": c, "n": len(rows)}


async def parking(user, ctx):
    cid = user["company_id"]
    q = {"company_id": cid, "deleted_at": None, **report_scope_filter(user)}
    (blocks, projects), slots = await asyncio.gather(_names(cid), db.parking_slots.find(q, {"_id": 0}).to_list(None))
    own = (
        {} if INV.can_see_real(user) else {"sales_user_id": user["id"]}
    )  # display viewers: names on their own bookings only
    bks = {
        b["id"]: b
        async for b in db.bookings.find(
            {"company_id": cid, **own}, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "customer_id": 1}
        )
    }
    out = []
    for s in slots:
        b = bks.get(s.get("booking_id")) or {}
        pr = projects.get(s.get("project_id")) or {}
        out.append(
            {
                "slot_id": s["id"],
                "number": s.get("number"),
                "type": s.get("type") or "—",
                "level": s.get("level") or "—",
                "price": round((s.get("price") or 0) * 100),
                "status": s.get("status") or "—",
                "project_id": s.get("project_id"),
                "project": pr.get("code") or "—",
                "booking_id": s.get("booking_id") if b else None,
                "booking_number": b.get("booking_number") or "—",
                "customer_id": b.get("customer_id") or "-",
                "customer_label": b.get("customer_name") or "—",
                "customer_name": b.get("customer_name") or "—",
            }
        )
    return out


def parking_totals(t, rows):
    c = {}
    for r in rows:
        c[r["status"]] = c.get(r["status"], 0) + 1
    return {
        "slots": len(rows),
        "by_status": c,
        "free_value": sum(r["price"] for r in rows if r["status"] == "Available"),
    }


def parking_formula(t):
    c = t.get("by_status") or {}
    return (
        " + ".join(f"{v:,} {k.lower()}" for k, v in sorted(c.items()))
        + f" = {t.get('slots', 0):,} slots · available slots' price {inr(t.get('free_value', 0))}"
    )


def parking_illus(rows, t):
    c = t.get("by_status") or {}
    tone = {"Available": "sapphire", "Allotted": "graphite", "Attached": "steel"}
    return {
        "type": "split_bar",
        "title": "Slots by status",
        "count": True,
        "parts": [{"label": k, "value": v, "tone": tone.get(k, "steel")} for k, v in sorted(c.items())],
    }


async def stage_bills(user, ctx):
    """Per tower: live bookings' bills raised / received / due (Customer status rows) + the tower's last completed stage."""
    from services.cards import _stages

    rows = [r for r in await customer_status(user, ctx) if r["live"]]
    st = await _stages({r["tower_id"] for r in rows})
    agg = {}
    for r in rows:
        a = agg.setdefault(
            r["tower_id"],
            {k: r[k] for k in ("project_id", "project", "tower_id", "tower")}
            | {
                "bookings": 0,
                "agreement_value": 0,
                "bills_raised": 0,
                "received": 0,
                "instalment_dues": 0,
                "advance": 0,
                "waived": 0,
            },
        )
        a["bookings"] += 1
        a["agreement_value"] += r["agreement_value"]
        a["bills_raised"] += r["bills_raised"]
        a["received"] += r["account_received"] + r["cash_received"]
        a["instalment_dues"] += r["account_dues"] + r["cash_dues"]
        a["advance"] += r["instalment_advance"]
        a["waived"] += r["waived"]
    for tid, a in agg.items():
        stages = st.get(tid, [])
        done = [s for s in stages if s.get("status") == "Completed"]
        a["stages_done"] = f"{len(done)} of {len(stages)}"
        a["last_stage"] = (done[-1].get("name") or done[-1].get("stage_name")) if done else "—"
        a["last_done_on"] = (done[-1].get("completed_on") or None) if done else None
        a["pct_received"] = round(100 * a["received"] / a["bills_raised"], 1) if a["bills_raised"] else 0
    return list(agg.values())


def stage_formula(t):
    return (
        f"Bills raised {inr(t.get('bills_raised', 0))} − received {inr(t.get('received', 0))} − waived {inr(t.get('waived', 0))} "
        f"+ advance held {inr(t.get('advance', 0))} = instalment dues {inr(t.get('instalment_dues', 0))} (as in "
        "Customer status)"
    )


def stage_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Bills raised",
        "parts": [
            {"label": "Received", "value": t.get("received", 0), "tone": "sapphire"},
            {"label": "Instalment dues", "value": t.get("instalment_dues", 0), "tone": "coral"},
        ],
    }


async def velocity(user, ctx):
    """Per tower: units booked in the last 3 / 6 / 12 months, average per month over 6, unsold, months of stock left."""
    as_of = ctx["as_of"]
    back = {m: (as_of - timedelta(days=round(30.44 * m))).isoformat() for m in (3, 6, 12)}
    fl = await flats(user, ctx)
    q = {
        "company_id": user["company_id"],
        "status": {"$in": ["Active", "Completed"]},
        "booking_date": {"$lte": as_of.isoformat()},
        **report_scope_filter(user),
    }
    bks = await db.bookings.find(q, {"_id": 0, "block_id": 1, "booking_date": 1}).to_list(None)
    agg = {}
    for r in fl:
        a = agg.setdefault(
            r["tower_id"],
            {k: r[k] for k in ("project_id", "project", "tower_id", "tower")}
            | {"flats": 0, "unsold": 0, "unsold_value": 0, "m3": 0, "m6": 0, "m12": 0},
        )
        a["flats"] += 1
        if r["status"] in ("Available", "Hold"):
            a["unsold"] += 1
            a["unsold_value"] += r["price"]
    for b in bks:
        a = agg.get(b.get("block_id"))
        if a:
            for m in (3, 6, 12):
                a[f"m{m}"] += b["booking_date"] > back[m]
    for a in agg.values():
        a["per_month"] = round(a["m6"] / 6, 2)
        a["months_left"] = round(a["unsold"] / a["per_month"], 1) if a["per_month"] else None
    return list(agg.values())


def velocity_totals(t, rows):
    pm = round(t.get("m6", 0) / 6, 2)
    return {"per_month": pm, "months_left": round(t["unsold"] / pm, 1) if pm and t.get("unsold") else None}


def velocity_formula(t):
    left = (
        f" = {t['months_left']} months of stock left" if t.get("months_left") else " · no bookings in the last 6 months"
    )
    return (
        f"{t.get('m6', 0):,} bookings in the last 6 months ÷ 6 = {t.get('per_month', 0)} a month · {t.get('unsold', 0):,} "
        f"unsold ÷ {t.get('per_month', 0)}{left}"
    )


def velocity_illus(rows, t):
    return {
        "type": "bars",
        "title": "Bookings in the last 12 months by tower",
        "bars": [
            {"label": f"{r['project']} · {r['tower']}", "value": r["m12"]}
            for r in sorted(rows, key=lambda r: -r["m12"])
        ],
        "count": True,
    }
