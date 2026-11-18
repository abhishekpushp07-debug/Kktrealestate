"""Phase 3F F2 — the other Customers reports (REQ-279). Read-only; money figures come from the booking rows
(services.definitions via customers._booking_rows), the ledger, refunds and waivers — never re-derived here."""

from datetime import date

from db import db
from deps import report_scope_filter
from reports_v3.customers import BAND_KEYS, customer_status, dims
from services import clock
from services import definitions as D
from services.pdf import fmt_date, inr

_L = {
    "DEMAND": "Bill",
    "OTHER_CHARGE_DEMAND": "Other charge bill",
    "PAYMENT": "Receipt",
    "OTHER_CHARGE_PAYMENT": "Other charge receipt",
    "WAIVER": "Waiver (credit note)",
    "WAIVER_REVERSAL": "Waiver cancelled",
    "REVERSAL": "Receipt reversed",
    "REFUND": "Refund paid",
    "CANCELLATION": "Booking cancelled",
    "TRANSFER": "Flat transfer",
    "AGREEMENT_CHANGE": "Agreement revised",
}


def sinr(v: int) -> str:
    return f"−{inr(-v)}" if v < 0 else inr(v)


def _days(a: str | None, b: date) -> int | None:
    return (b - date.fromisoformat(a[:10])).days if a else None


# ---------- Overdue & ageing by customer ----------
async def ageing(user, ctx):
    return [r for r in await customer_status(user, ctx) if r["live"] and r["total_due"] > 0]


def ageing_formula(t):
    b = " + ".join(f"{k} {inr(t.get(v, 0))}" for k, v in BAND_KEYS.items())
    return f"{b} = dues {inr(t.get('total_due', 0))} (Cash + Account + other charges billed)"


def ageing_illus(rows, t):
    tones = ["muted", "sapphire", "graphite", "coral-soft", "coral"]
    return {
        "type": "split_bar",
        "title": "How old the dues are",
        "parts": [{"label": k, "value": t.get(v, 0), "tone": tones[i]} for i, (k, v) in enumerate(BAND_KEYS.items())],
    }


# ---------- Advance holders ----------
async def advance_holders(user, ctx):
    return [
        r | {"received_total": r["account_received"] + r["cash_received"]}
        for r in await customer_status(user, ctx)
        if r["live"] and r["advance_total"] > 0
    ]


def advance_formula(t):
    return (
        f"Received {inr(t.get('received_total', 0))} beyond bills raised → advance held {inr(t.get('advance_total', 0))}; "
        "it settles the next bills oldest-first"
    )


def advance_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Advance held against bills raised",
        "parts": [
            {"label": "Bills raised", "value": t.get("bills_raised", 0), "tone": "graphite"},
            {"label": "Advance held", "value": t.get("advance_total", 0), "tone": "mint"},
        ],
    }


# ---------- Collection call list ----------
async def call_list(user, ctx):
    rows = [r for r in await customer_status(user, ctx) if r["live"] and r["total_due"] > 0]
    # same follow-up source as the customer card's "follow-up today" pill: the customer's converted lead
    leads: dict = {}
    q = {
        "$or": [
            {"converted_customer_id": {"$in": list({r["customer_id"] for r in rows})}},
            {"id": {"$in": [r["lead_id"] for r in rows if r.get("lead_id")]}},
        ]
    }
    async for l in db.leads.find(
        q, {"_id": 0, "id": 1, "converted_customer_id": 1, "next_follow_up_at": 1, "follow_ups": {"$slice": -1}}
    ):
        leads[l["id"]] = l
        if l.get("converted_customer_id"):
            leads[l["converted_customer_id"]] = l
    out = []
    for r in rows:
        l = leads.get(r["customer_id"]) or leads.get(r.get("lead_id")) or {}
        last = (l.get("follow_ups") or [{}])[-1]
        out.append(
            r
            | {
                "next_follow_up": clock.day_of(l.get("next_follow_up_at")),
                "last_follow_up": clock.day_of(last.get("at")),
                "last_note": last.get("note"),
                "call_reason": "Overdue" if r["days_overdue"] else "Due soon",
            }
        )
    return out


def call_formula(t):
    return (
        f"Dues {inr(t.get('total_due', 0))} of which overdue {inr(t.get('overdue_amount', 0))}; call the oldest first"
    )


def call_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "What these calls are about",
        "parts": [
            {"label": "Overdue", "value": t.get("overdue_amount", 0), "tone": "coral"},
            {"label": "Due, not late", "value": t.get("total_due", 0) - t.get("overdue_amount", 0), "tone": "sapphire"},
        ],
    }


# ---------- KYC, agreement & documents pending ----------
async def paper_pending(user, ctx):
    rows = [r for r in await customer_status(user, ctx) if r["live"]]
    cust = {
        c["id"]: c
        async for c in db.customers.find(
            {"id": {"$in": list({r["customer_id"] for r in rows})}}, {"_id": 0, "id": 1, "kyc_status": 1}
        )
    }
    types = await db.document_types.find(
        {"applies_to": {"$in": ["customer", "booking"]}, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "applies_to": 1},
    ).to_list(100)
    have: dict = {}
    async for d in db.documents.find(
        {"company_id": user["company_id"], "deleted_at": None}, {"_id": 0, "entity_id": 1, "document_type_id": 1}
    ):
        have.setdefault(d.get("entity_id"), set()).add(d.get("document_type_id"))
    out = []
    for r in rows:
        kyc = (cust.get(r["customer_id"]) or {}).get("kyc_status") or "Pending"
        missing = [
            t["name"]
            for t in types
            if t["id"] not in have.get(r["customer_id"] if t["applies_to"] == "customer" else r["booking_id"], set())
        ]
        signed = r.get("plan_accepted_on")
        pend = [
            x for x, on in (("kyc", kyc != "Verified"), ("agreement", not signed), ("documents", bool(missing))) if on
        ]
        out.append(
            r
            | {
                "kyc_status": kyc,
                "agreement": f"Signed {fmt_date(signed)}"
                if signed
                else f"Pending · {_days(r['booking_date'], ctx['as_of'])} days",
                "days_since_booking": _days(r["booking_date"], ctx["as_of"]),
                "docs_missing": ", ".join(missing) or "—",
                "docs_missing_n": len(missing),
                "pending_what": pend,
                "pending_n": len(pend),
                "pending_any": bool(pend),
            }
        )
    return out


def paper_formula(t):
    return (
        f"{t.get('pending_n', 0)} things pending across these bookings · {t.get('docs_missing_n', 0)} documents missing"
    )


def paper_illus(rows, t):
    c = {"KYC": 0, "Agreement": 0, "Documents": 0}
    for r in rows:
        for x in r["pending_what"]:
            c[x.capitalize() if x != "kyc" else "KYC"] += 1
    return {"type": "counts", "title": "Bookings with something pending", "counts": c}


# ---------- Payment behaviour (per customer) ----------
async def behaviour(user, ctx):
    """On time = the bill was fully settled (oldest-first, receipts + waivers) on or before its due date
    (definitions.bill_settle_days); days late averages the late bills, open late bills counting to the as-of day."""
    as_of: date = ctx["as_of"]
    rows = [r for r in await customer_status(user, ctx) if r["live"]]
    ids = [r["booking_id"] for r in rows]
    settle = await D.bill_settle_days(ids, as_of)
    q = {"company_id": user["company_id"], "booking_id": {"$in": ids}}
    bounced = {
        x["_id"]: x["n"]
        async for x in db.payments.aggregate(
            [
                {"$match": q | {"status": "Bounced", "bounced_at": {"$lte": clock.day_end_utc(as_of)}}},
                {"$group": {"_id": "$booking_id", "n": {"$sum": 1}}},
            ]
        )
    }
    waived = {
        x["_id"]: x["n"]
        async for x in db.waivers.aggregate(
            [{"$match": q | {"status": "Approved"}}, {"$group": {"_id": "$booking_id", "n": {"$sum": 1}}}]
        )
    }
    per: dict = {}
    for r in rows:
        c = per.setdefault(
            r["customer_id"],
            {
                k: r[k]
                for k in (
                    "customer_id",
                    "customer_name",
                    "customer_label",
                    "phone",
                    "sales_person",
                    "sales_id",
                    "project",
                    "project_id",
                )
            }
            | {
                "flats": [],
                "bills_due": 0,
                "on_time": 0,
                "late_days": 0,
                "late_n": 0,
                "bounces": 0,
                "waivers": 0,
                "received": 0,
            },
        )
        c["flats"].append(r["flat"])
        for late in settle.get(r["booking_id"], []):
            c["bills_due"] += 1
            if late <= 0:
                c["on_time"] += 1
            else:
                c["late_n"] += 1
                c["late_days"] += late
        c["bounces"] += bounced.get(r["booking_id"], 0)
        c["waivers"] += waived.get(r["booking_id"], 0)
        c["received"] += r["account_received"] + r["cash_received"]
    out = []
    for c in per.values():
        pct = round(100 * c["on_time"] / c["bills_due"]) if c["bills_due"] else None
        out.append(
            c
            | {
                "flats": ", ".join(c["flats"]),
                "on_time_pct": pct,
                "avg_days_late": round(c["late_days"] / c["late_n"]) if c["late_n"] else 0,
                "behaviour": "Nothing due yet"
                if pct is None
                else "Prompt"
                if pct >= 90
                else "Mostly on time"
                if pct >= 60
                else "Often late",
            }
        )
    return out


def behaviour_derived(t, rows=None):
    return {
        "on_time_pct": round(100 * t.get("on_time", 0) / t["bills_due"]) if t.get("bills_due") else None,
        "avg_days_late": round(t.get("late_days", 0) / t["late_n"]) if t.get("late_n") else 0,
    }


def statement_derived(t, rows=None):
    return {"balance": t.get("bill", 0) - t.get("received", 0) - t.get("waived", 0)}


def behaviour_formula(t):
    pct = round(100 * t.get("on_time", 0) / t["bills_due"]) if t.get("bills_due") else 0
    return (
        f"{t.get('on_time', 0)} of {t.get('bills_due', 0)} bills settled by their due date = {pct}% on time · {t.get('bounces', 0)} "
        f"bounced cheques · {t.get('waivers', 0)} waivers"
    )


def behaviour_illus(rows, t):
    c = {}
    for r in rows:
        c[r["behaviour"]] = c.get(r["behaviour"], 0) + 1
    return {"type": "counts", "title": "Customers by how they pay", "counts": c}


# ---------- Customer directory ----------
async def directory(user, ctx):
    rows = await customer_status(user, ctx)
    by: dict = {}
    for r in rows:
        by.setdefault(r["customer_id"], []).append(r)
    q = {"company_id": user["company_id"], "deleted_at": None, "id": {"$in": list(by)}}
    if not report_scope_filter(user):
        q.pop("id")
    proj = {
        "_id": 0,
        "id": 1,
        "full_name": 1,
        "customer_code": 1,
        "phone": 1,
        "email": 1,
        "co_applicants": 1,
        "address_current": 1,
    }
    proj |= {"source": 1, "assigned_sales_user_id": 1, "kyc_status": 1, "lifecycle_stage": 1, "is_active": 1}
    users = {u["id"]: u.get("name") async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1})}
    out = []
    async for c in db.customers.find(q, proj):
        bks = by.get(c["id"], [])
        co = [x.get("name") or x.get("full_name") for x in c.get("co_applicants") or [] if x]
        r0 = bks[0] if bks else {}
        out.append(
            {
                "customer_id": c["id"],
                "customer_name": c.get("full_name"),
                "customer_label": c.get("full_name"),
                "customer_code": c.get("customer_code"),
                "phone": c.get("phone"),
                "email": c.get("email"),
                "co_applicants": ", ".join(filter(None, co)) or "—",
                "city": (c.get("address_current") or {}).get("city") or "—",
                "source": c.get("source") or "—",
                "sales_person": users.get(c.get("assigned_sales_user_id")) or r0.get("sales_person") or "Unassigned",
                "sales_id": c.get("assigned_sales_user_id") or r0.get("sales_id") or "-",
                "kyc_status": c.get("kyc_status") or "Pending",
                "stage": c.get("lifecycle_stage") or "—",
                "flats": ", ".join(r["flat_code"] for r in bks) or "—",
                "bookings": len([r for r in bks if r["live"]]),
                "project_id": r0.get("project_id") or "-",
                "project": r0.get("project") or "No booking",
            }
        )
    return out


def directory_formula(t):
    return f"{t.get('bookings', 0)} live bookings across these customers"


def directory_illus(rows, t):
    c = {}
    for r in rows:
        c[r["source"]] = c.get(r["source"], 0) + 1
    return {
        "type": "counts",
        "title": "Where these customers came from",
        "counts": dict(sorted(c.items(), key=lambda x: -x[1])[:8]),
    }


# ---------- Customer statement ----------
async def statement_options(user):
    q = {"company_id": user["company_id"], **report_scope_filter(user)}
    seen = {}
    async for b in db.bookings.find(q, {"_id": 0, "customer_id": 1, "customer_name": 1, "customer_code": 1}):
        seen[b["customer_id"]] = {
            "value": b["customer_id"],
            "label": f"{b.get('customer_name')} · {b.get('customer_code')}",
        }
    return {"customer": sorted(seen.values(), key=lambda o: o["label"])}


async def statement(user, ctx):
    """Every ledger line (bills, receipts, waivers, refunds) of the chosen customers' bookings up to the as-of day,
    with a running balance per booking = Σ bill − Σ received/waived (the ledger's own running balance)."""
    ids = ctx["params"].get("customer") or []
    if not ids:
        return []
    q = {"company_id": user["company_id"], "customer_id": {"$in": ids}, **report_scope_filter(user)}
    bks = {
        b["id"]: b
        async for b in db.bookings.find(
            q,
            {
                "_id": 0,
                "id": 1,
                "customer_id": 1,
                "customer_name": 1,
                "project_code": 1,
                "block_name": 1,
                "flat_snapshot.flat_number": 1,
                "booking_number": 1,
            },
        )
    }
    out = []
    cur = db.ledger_entries.find(
        {"booking_id": {"$in": list(bks)}, "date": {"$lte": ctx["as_of"].isoformat()}},
        {
            "_id": 0,
            "booking_id": 1,
            "date": 1,
            "seq": 1,
            "type": 1,
            "ref": 1,
            "note": 1,
            "udhar_paise": 1,
            "jama_paise": 1,
            "balance_paise": 1,
            "mode": 1,
        },
    ).sort([("booking_id", 1), ("seq", 1)])
    async for e in cur:
        b = bks[e["booking_id"]]
        waiver = e["type"] in ("WAIVER", "WAIVER_REVERSAL")
        out.append(
            {
                "booking_id": b["id"],
                "customer_id": b["customer_id"],
                "customer_name": b["customer_name"],
                "booking_number": b.get("booking_number"),
                "flat_code": f"{b.get('project_code')} · {b.get('block_name')} · {(b.get('flat_snapshot') or {}).get('flat_number')}",
                "date": e["date"],
                "seq": e["seq"],
                "particulars": _L.get(e["type"], e["type"].title()) + (f" · {e['note']}" if e.get("note") else ""),
                "kind": _L.get(e["type"], e["type"]),
                "ref": e.get("ref") or "—",
                "mode": e.get("mode") or "—",
                "bill": e.get("udhar_paise") or 0,
                "received": 0 if waiver else e.get("jama_paise") or 0,
                "waived": e.get("jama_paise") or 0 if waiver else 0,
                "balance": e.get("balance_paise") or 0,
            }
        )
    return out


def statement_formula(t):
    return (
        f"Bills {inr(t.get('bill', 0))} − received {inr(t.get('received', 0))} − waived {inr(t.get('waived', 0))} "
        f"= balance {sinr(t.get('bill', 0) - t.get('received', 0) - t.get('waived', 0))}"
    )


def statement_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Bills against what came in",
        "parts": [
            {"label": "Received", "value": t.get("received", 0), "tone": "sapphire"},
            {"label": "Waived", "value": t.get("waived", 0), "tone": "muted"},
            {
                "label": "Balance",
                "value": max(t.get("bill", 0) - t.get("received", 0) - t.get("waived", 0), 0),
                "tone": "coral",
            },
        ],
    }


# ---------- Cancelled & transferred customers ----------
async def cancelled(user, ctx):
    as_of = ctx["as_of"].isoformat()
    q = {"company_id": user["company_id"], **report_scope_filter(user)}
    proj = {
        "_id": 0,
        "id": 1,
        "customer_id": 1,
        "customer_name": 1,
        "customer_phone": 1,
        "booking_number": 1,
        "booking_date": 1,
        "status": 1,
    }
    proj |= {
        "project_id": 1,
        "project_code": 1,
        "block_id": 1,
        "block_name": 1,
        "flat_id": 1,
        "flat_snapshot.flat_number": 1,
    }
    proj |= {
        "sales_user_id": 1,
        "payment_plan_snapshot.id": 1,
        "payment_plan_snapshot.name": 1,
        "cancellation": 1,
        "transfers": 1,
    }
    bks = await db.bookings.find(
        q | {"$or": [{"status": "Cancelled"}, {"transfers.0": {"$exists": True}}]}, proj
    ).to_list(None)
    paid: dict = {}
    async for r in db.refunds.find(
        {"booking_id": {"$in": [b["id"] for b in bks]}, "status": "Paid", "paid_date": {"$lte": as_of}},
        {"_id": 0, "booking_id": 1, "amount_total_paise": 1, "amount_paise": 1},
    ):
        paid[r["booking_id"]] = paid.get(r["booking_id"], 0) + (r.get("amount_paise") or 0)
    users = {u["id"]: u.get("name") async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1})}
    flats = {
        f["id"]: f
        for f in await db.flats.find(
            {"company_id": user["company_id"]}, {"_id": 0, "id": 1, "floor": 1, "flat_number": 1}
        ).to_list(None)
    }
    floors = {k: v.get("floor") for k, v in flats.items()}
    out = []
    for b in bks:
        base = dims(b, floors, users)
        c = b.get("cancellation") or {}
        day = clock.day_of(c.get("at"))
        if b["status"] == "Cancelled" and day and day <= as_of:
            refund = c.get("refund_paise") or 0
            out.append(
                base
                | {
                    "kind": "Cancelled",
                    "event_date": day,
                    "reason": c.get("reason") or "—",
                    "received": c.get("received_paise") or 0,
                    "forfeit": c.get("forfeiture_paise") or c.get("deduction_paise") or 0,
                    "refund_payable": refund,
                    "refund_paid": min(paid.get(b["id"], 0), refund),
                    "refund_pending": max(refund - paid.get(b["id"], 0), 0),
                    "new_flat": "—",
                }
            )
        for t in b.get("transfers") or []:
            tday = clock.day_of(t.get("at"))
            if not tday or tday > as_of:
                continue
            frm = (flats.get(t.get("from_flat_id")) or {}).get("flat_number") or t.get("from_flat") or "—"
            to = (flats.get(t.get("to_flat_id")) or {}).get("flat_number") or t.get("to_flat") or "—"
            out.append(
                base
                | {
                    "kind": "Transferred",
                    "event_date": tday,
                    "reason": t.get("reason") or "—",
                    "received": 0,
                    "forfeit": 0,
                }
                | {"refund_payable": 0, "refund_paid": 0, "refund_pending": 0, "new_flat": f"{frm} → {to}"}
            )
    return out


def cancelled_formula(t):
    return (
        f"Received {inr(t.get('received', 0))} − forfeited {inr(t.get('forfeit', 0))} = refund payable "
        f"{inr(t.get('refund_payable', 0))} (paid {inr(t.get('refund_paid', 0))} + pending {inr(t.get('refund_pending', 0))})"
    )


def cancelled_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Where the cancelled money went",
        "parts": [
            {"label": "Refund paid", "value": t.get("refund_paid", 0), "tone": "sapphire"},
            {"label": "Refund pending", "value": t.get("refund_pending", 0), "tone": "steel"},
            {"label": "Forfeited", "value": t.get("forfeit", 0), "tone": "graphite"},
        ],
    }
