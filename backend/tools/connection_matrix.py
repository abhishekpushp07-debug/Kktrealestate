"""Connection matrix (F-42, REQ-67…73): every action × every surface, before/after through the APIs the screens call.

For each action: build its own subject (fresh booking in a matrix-owned tower), snapshot all surfaces, perform the action
through the screen's API, re-read every surface and assert the expected change. Direct reads are checked immediately;
read models (Home, trends, project/tower summaries) and after-commit work (documents register, "Where this entry went")
get the 5 s freshness budget (REQ-70). Anything not listed for an action must be unchanged.

Run against the private test copy only (pytest gate `tests/test_connection_matrix.py`), or:
    python tools/connection_matrix.py --base http://localhost:<test-port> --out memory/qa/phase2/connection_matrix.md
"""

import argparse
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests

FRESH_S = 5.0
READ_MODELS = {
    "home_widgets",
    "home_command",
    "home_trends",
    "status_counters",
    "documents",
    "journey",
    "notifications",
}


class Api:
    def __init__(self, base: str, headers: dict):
        self.base, self.h = base.rstrip("/") + "/api", headers

    def call(self, method, path, body=None, ok=(200, 201), **params):
        h = {**self.h, "Idempotency-Key": str(uuid.uuid4())}
        r = requests.request(method, self.base + path, headers=h, json=body, params=params or None, timeout=90)
        assert r.status_code in ok, (method, path, r.status_code, r.text[:400])
        return r

    def get(self, path, **params):
        return self.call("GET", path, **params).json()

    def post(self, path, body=None, **params):
        return self.call("POST", path, body or {}, **params).json()


def _today(api):
    return (
        api.get("/health").get("business_day")
        or datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
    )


# ---------------------------------------------------------------- surfaces (REQ-69): name -> metrics dict
def s_booking(api, c):
    b = api.get(f"/bookings/{c['bid']}")
    s = b["summary"]
    return {
        "status": b["status"],
        "flat": b["flat_id"],
        "agreement": b["agreement_value_paise"],
        "bill": s["total_bill_raised_paise"],
        "received": s["total_received_paise"],
        "outstanding": s["outstanding_paise"],
        "advance": s["advance_paise"],
        "pending_cheques": s["pending_cheques_paise"],
        "plan": (b.get("payment_plan_snapshot") or {}).get("id"),
    }


def s_c360(api, c):
    cu = api.get(f"/customers/{c['cid']}")
    e = next((x for x in cu["bookings"] if x["id"] == c["bid"]), None) or {}
    s = e.get("summary") or {}
    return {
        "bookings": len(cu["bookings"]),
        "status": e.get("status"),
        "bill": s.get("total_bill_raised_paise"),
        "received": s.get("total_received_paise"),
    }


def _card_money(k):
    return {
        "billed": (k or {}).get("billed_paise"),
        "received": (k or {}).get("received_paise"),
        "due": (k or {}).get("due_paise", ((k or {}).get("balance") or {}).get("due_paise")),
        "advance": (k or {}).get("advance_paise", ((k or {}).get("balance") or {}).get("advance_paise")),
    }


def s_customer_card(api, c):  # 3L customer list card (services/cards.py)
    if not c.get("cid"):
        return _card_money(None)
    cu = api.get(f"/customers/{c['cid']}")
    items = api.get("/customers", search=cu["phone"], card_segment="all", page_size=5)["items"]
    return _card_money(next((x.get("card") for x in items if x["id"] == c["cid"]), None))


def s_booking_card(api, c):  # 3L booking list card
    if not c.get("bid"):
        return _card_money(None)
    bn = api.get(f"/bookings/{c['bid']}")["booking_number"]
    items = api.get("/bookings", search=bn, page_size=5)["items"]
    return _card_money(next((x.get("card") for x in items if x["id"] == c["bid"]), None))


def s_project_card(api, c):  # 3L project list card
    pr = api.get(f"/projects/{c['pid']}")
    items = api.get("/projects", search=pr["name"], page_size=10)["items"]
    k = next((x.get("card") for x in items if x["id"] == c["pid"]), None) or {}
    return {"collected": k.get("collected_paise"), "outstanding": k.get("outstanding_paise")}


def s_ledger(api, c):
    rows = api.get(f"/bookings/{c['bid']}/ledger")["rows"]
    return {
        "rows": len(rows),
        "udhar": sum(r.get("udhar_paise") or 0 for r in rows),
        "jama": sum(r.get("jama_paise") or 0 for r in rows),
    }


def _stmt(api, c):
    return api.get(f"/reports/statement/{c['bid']}")


def s_bills(api, c):
    ds = [d for d in _stmt(api, c)["demands"] if not d.get("voided") and d.get("status") != "Cancelled"]
    return {"count": len(ds), "raised": sum(d.get("total_demand_paise") or 0 for d in ds)}


def s_received(api, c):
    ps = api.get("/payments", booking_id=c["bid"], page_size=200)["items"]
    return {
        "count": len(ps),
        "cleared": sum(p["amount_paise"] for p in ps if p["status"] == "Cleared"),
        "pending": sum(p["amount_paise"] for p in ps if p["status"] == "Pending"),
        "bounced": sum(1 for p in ps if p["status"] == "Bounced"),
        "reversed": sum(1 for p in ps if p["status"] == "Reversed"),
    }


def s_cheques(api, c):
    r = api.get("/payments/cheques-in-hand")
    return {"count": r["total"], "amount": r["amount_paise"]}


def s_roznamcha(api, c):
    r = api.get("/roznamcha", date=c["today"])
    return {  # P2-1: the cash-out rows the screen lists, not only the API totals
        "receipts": r["total_receipts_paise"],
        "pending": r["pending_paise"],
        "refunds": r["refunds_paise"],
        "cash_out": r["cash_paid_out_paise"],
        "closing": r["closing_cash_paise"],
        "refund_rows": len(r["refunds"]),
        "refund_rows_out": sum(x["paid_out_paise"] for x in r["refunds"]),
        "day_balances": r["opening_cash_paise"]
        + r["cash_received_paise"]
        + r["cash_withdrawals_paise"]
        - r["cash_paid_out_paise"]
        - r["closing_cash_paise"],  # opening + in − out − closing: always 0
    }


def s_demand_register(api, c):
    k = api.get("/demands/kpis")
    reg = api.get("/demands/register", project_id=c["pid"])["totals"]
    return {
        "raised_today": k["raised_today_paise"],
        "raised_today_n": k["raised_today_count"],
        "overdue": k["overdue_paise"],
        "rows": reg["count"],
        "total": reg["total_paise"],
        "balance": reg["balance_paise"],
    }


HOME_WIDGETS = (
    "money_today",
    "due_vs_received",
    "ageing",
    "call_today",
    "inflow_30",
    "next_milestone",
    "inventory",
    "flat_status",
    "construction",
    "pipeline",
    "attention",
)


def s_home_command(api, c):
    """Phase 2D Home Command Center (project-filtered): per widget, Σ its numbers (w:) and Σ the lists they drill to (l:)."""
    from tests.test_home_bundle import _numbers, _pick

    b = api.get("/home/bundle", period="month", project_id=c["pid"])
    out = {}
    for wid in HOME_WIDGETS:
        w = b["widgets"].get(wid) or {}
        nums = _numbers(w.get("data") or {}, [])
        out[f"w:{wid}"] = sum(
            (
                n.get("count")
                if n["drill"]["pick"].endswith(("count", "total")) and "count" in n
                else n.get("amount_paise")
            )
            or 0
            for n in nums
        )
        out[f"l:{wid}"] = sum(
            _pick(api.get(n["drill"]["api"][0], **n["drill"]["api"][1]), n["drill"]["pick"]) or 0 for n in nums
        )
    return out


def s_home(api, c):
    h, w = api.get("/dashboard/home"), api.get("/dashboard/widgets")
    t = h["totals"]
    return {
        "available": t["available"],
        "bookings": t["bookings"],
        "agreement": t["agreement_paise"],
        "paid": t["paid_paise"],
        "outstanding": t["outstanding_paise"],
        "advance": t["advance_paise"],
        "pending_cheques": t["pending_cheques_paise"],
        "refunds_paid": t["refunds_paid_paise"],
        "today_collections": w["collections_today"]["amount_paise"],
        "leads_open": h["counts"]["leads_open"],
    }


def s_trends(api, c):
    t = api.get("/trends", scope="project", id=c["pid"])

    def last(k):
        v = t.get(k) or [0]
        v = v[-1]
        return v.get("paise", v.get("value")) if isinstance(v, dict) else v

    return {"collections": last("collections"), "demands": last("demands"), "bookings": last("bookings")}


def s_collections(api, c):
    t = api.get("/reports/collections-v2", from_date=c["today"], to_date=c["today"], project_id=c["pid"])["totals"]
    return {k: t.get(f"{k}_paise", t.get(k)) for k in ("count", "cash", "account", "other", "total", "pending")}


def s_outstanding(api, c):
    t = api.get("/reports/outstanding-v2", project_id=c["pid"])["totals"]
    return {k: t.get(f"{k}_paise") for k in ("outstanding", "advance", "bill_raised", "received")} | {
        "bookings": t.get("bookings")
    }


def s_pstatement(api, c):
    p = api.get("/reports/project-statement", project_id=c["pid"])
    row = next((x for x in p["tower_subtotals"] if x.get("block_id") == c["blid"]), {})
    return {"count": row.get("count"), "bill": row.get("bill_raised_paise"), "received": row.get("received_paise")}


def s_cancellations(api, c):
    r = api.get("/reports/cancellations", project_id=c["pid"])
    t = r["totals"]
    return {"rows": r["total_rows"], "forfeit": t.get("forfeiture_paise"), "refund": t.get("refund_paise")}


def s_holds(api, c):
    r = api.get("/reports/hold-register")
    x = r["totals_extra"]
    return {
        "active": x["active"],
        "held_total": x["held_total"],
        "released": x["released_manually"],
        "expired": x["expired_released"],
        "on_hold": r["tie_out"]["flats_on_hold"],
    }


def s_funnel(api, c):
    return {f["stage"]: f["count"] for f in api.get("/reports/sales-leads")["funnel"]}


def s_status(api, c):
    out = {}
    for k in ("fid", "fid2"):
        if c.get(k):
            f = api.get(f"/flats/{c[k]}")
            out[f"{k}_status"] = f["status"]
            out[f"{k}_price"] = f.get("price")
    bs = api.get(f"/blocks/{c['blid']}/summary")
    ps = api.get(f"/projects/{c['pid']}/summary")
    out |= {
        "tower_bookings": bs.get("bookings"),
        "tower_paid": bs.get("paid_paise"),
        "project_bookings": ps.get("bookings"),
    }
    out["project_paid"] = ps.get("paid_paise")
    return out


def s_inventory(api, c):
    t = api.get("/reports/inventory", project_id=c["pid"])["totals"]
    return {k: t.get(k) for k in ("available", "hold", "booked", "blocked")} | {
        "available_value": t.get("available_value_paise"),
        "sold_value": t.get("sold_value_paise"),
    }


def s_pdfs(api, c):
    st = _stmt(api, c)
    r = api.call("GET", f"/bookings/{c['bid']}/statement.pdf")
    out = {"statement_pdf": r.headers.get("content-type", "").startswith("application/pdf") and len(r.content) > 1000}
    out["statement_rows"] = len(st["ledger"])
    pays = sorted(st["payments"], key=lambda p: p.get("created_at") or "")
    if pays:
        rr = api.call("GET", f"/payments/{pays[-1]['id']}/receipt.pdf", ok=(200, 404, 409))
        out["last_receipt_pdf"] = f"{pays[-1].get('receipt_number')}:{rr.status_code}"
    dms = sorted(
        [d for d in st["demands"] if not d.get("voided") and d.get("status") != "Cancelled"],
        key=lambda d: d.get("created_at") or "",
    )
    if dms:
        rd = api.call("GET", f"/bookings/{c['bid']}/demands/{dms[-1]['id']}/letter.pdf", ok=(200, 404, 409))
        out["last_demand_pdf"] = f"{dms[-1].get('demand_number')}:{rd.status_code}"
    return out


def s_documents(api, c):
    r = api.get("/docgen/register", booking_id=c["bid"], page_size=100)
    return {"docs": r.get("total", len(r.get("items", [])))}


def s_journey(api, c):
    items = api.get(f"/journey/entity/booking/{c['bid']}")["items"]
    last = next((x for x in items if not x["action"].startswith("document.")), None)  # PDFs land after commit
    out = {"entries": len(items)}
    if last:
        j = api.get(f"/journey/{last['id']}")
        out["last"] = last["action"]
        out["last_has_values"] = (j.get("with_before_after") or 0) > 0
    return out


def _now_iso():
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()


def s_notifications(api, c):
    # "newest" ignores seed alerts stamped later today (demo seeds stamp "today" at 10:30 IST)
    r = api.get("/notifications", limit=100)
    now = _now_iso()
    return {
        "unread": r["unread"],
        "newest": max(
            (n.get("created_at") or "" for n in r["items"] if (n.get("created_at") or "") <= now), default=None
        ),
    }


def _new_alerts(c, since):
    """Alerts created for this user after `since` (the action's own notifications)."""
    until = _now_iso()  # demo seeds stamp "today" alerts at 10:30 IST, in the future before that hour
    items = c["_api"].get("/notifications", limit=100)["items"]
    return sum(1 for n in items if (since or "") < (n.get("created_at") or "") <= until)


ALERTS = {
    "unread": ("Δunread = alerts this action created", lambda b, a, c: (a or 0) - (b or 0) == c["_new"]),
    "newest": ("moves iff the action created alerts", lambda b, a, c: (a != b) == (c["_new"] > 0)),
}
ALERTS_RETRACT = {  # undo creates none and may withdraw the undone bills' alerts
    "unread": ("Δunread ≤ 0, no new alerts", lambda b, a, c: (a or 0) <= (b or 0) and c["_new"] == 0),
    "newest": ("no new alerts", lambda b, a, c: c["_new"] == 0),
}


SURFACES = {
    "booking_page": s_booking,
    "customer_360": s_c360,
    "ledger": s_ledger,
    "bills_raised": s_bills,
    "received": s_received,
    "cheque_register": s_cheques,
    "roznamcha": s_roznamcha,
    "demand_register": s_demand_register,
    "home_widgets": s_home,
    "home_command": s_home_command,
    "home_trends": s_trends,
    "collections": s_collections,
    "outstanding": s_outstanding,
    "project_statement": s_pstatement,
    "cancellations": s_cancellations,
    "hold_register": s_holds,
    "lead_funnel": s_funnel,
    "status_counters": s_status,
    "inventory_value": s_inventory,
    "pdfs": s_pdfs,
    "documents": s_documents,
    "journey": s_journey,
    "notifications": s_notifications,
    "customer_card": s_customer_card,
    "booking_card": s_booking_card,
    "project_card": s_project_card,
}


def snapshot(api, c):
    return {k: f(api, c) for k, f in SURFACES.items()}


# ---------------------------------------------------------------- expectation helpers
def d(x):
    return (
        f"Δ {x}" if not callable(x) else "Δ expected",
        lambda b, a, c: (a or 0) - (b or 0) == (x(c) if callable(x) else x),
    )


def to(v):
    return (f"= {v}" if not callable(v) else "= expected", lambda b, a, c: a == (v(c) if callable(v) else v))


def tie(surface, metric, k=1, plus=None):
    """Δ equals k × Δ of another surface's metric (+ an amount from the action's own record)."""
    lbl = f"Δ = {'' if k == 1 else ('−' if k == -1 else f'{k}×')}Δ {surface}.{metric}" + (" + record" if plus else "")
    return (lbl, lambda b, a, c: (a or 0) - (b or 0) == k * c["_D"](surface, metric) + (plus(c) if plus else 0))


# money law on the booking page: Δ(outstanding − advance) = Δ bill raised − Δ received
LAW = (
    "Δoutstanding − Δadvance = Δbill − Δreceived",
    lambda b, a, c: (
        c["_D"]("booking_page", "outstanding") - c["_D"]("booking_page", "advance")
        == c["_D"]("booking_page", "bill") - c["_D"]("booking_page", "received")
    ),
)
CHANGED = ("changed", lambda b, a, c: a != b)
GROWS = ("grows", lambda b, a, c: (a or 0) > (b or 0))
ANY = ("any (informational)", lambda b, a, c: True)


# ---------------------------------------------------------------- subjects
class World:
    def __init__(self, api):
        from tests.flat_claims import own_flats

        self.api = api
        self.flats = own_flats(api.base, api.h, 30, rate=4200)
        self.used = 0
        self.today = _today(api)
        self.modes = {m["code"]: m for m in api.get("/master/payment-modes")["items"]}
        self.bank = api.get("/master/bank-accounts")["items"][0]
        self.blid = self.flats[0]["block_id"]
        self.pid = self.flats[0]["project_id"]
        lump = next(p for p in api.get("/master/payment-plans", page_size=200)["items"] if p.get("code") == "LUMP100")
        api.post(  # second plan on the matrix tower, so "change plan" has a plan the tower allows
            "/payment-plan-assignments",
            {"payment_plan_id": lump["id"], "project_id": self.pid, "block_id": self.blid, "is_default": False},
        )

    def flat(self):
        f = self.flats[self.used]
        self.used += 1
        return f

    def customer(self):
        tag = uuid.uuid4().hex[:6]
        return self.api.post("/customers", {"full_name": f"Matrix {tag}", "phone": f"+9198{int(tag, 16) % 10**8:08d}"})

    def book(self, f=None, cust=None, cash_share=0.5, lead_id=None):
        f = f or self.flat()
        cust = cust or self.customer()
        price = f["price"]
        cash = round(price * cash_share, 2)
        body = {
            "flat_id": f["id"],
            "customer_id": cust["id"],
            "booking_date": self.today,
            "agreement_value": price,
            "cash_agreed": cash,
            "account_agreed": round(price - cash, 2),
            "remarks": "connection matrix",
        }
        if lead_id:
            body["lead_id"] = lead_id
        b = self.api.post("/bookings", body)
        return {"bid": b["id"], "cid": b["customer_id"], "fid": f["id"], "pid": self.pid, "blid": self.blid}

    def ctx(self, **kw):
        return {"today": self.today, "pid": self.pid, "blid": self.blid, **kw}

    def pay(self, c, rupees, mode="CASH", category="Cash", **extra):
        body = {
            "booking_id": c["bid"],
            "payment_category": category,
            "amount": rupees,
            "payment_date": self.today,
            "payment_mode_id": self.modes[mode]["id"],
            "remarks": "connection matrix",
        }
        if mode != "CASH":
            body["bank_account_id"] = self.bank["id"]
        body |= extra
        return self.api.post("/payments", body)

    def version(self, c):
        return self.api.get(f"/bookings/{c['bid']}")["version"]


# ---------------------------------------------------------------- actions (REQ-68): (setup → ctx, act(ctx), expectations)
MONEY_IN = {  # a cleared receipt of A paise into the booking
    "booking_page": {"received": d(lambda c: c["A"]), "outstanding": ANY, "advance": ANY},
    "customer_360": {"received": d(lambda c: c["A"])},
    "ledger": {"rows": d(1), "jama": d(lambda c: c["A"])},
    "received": {"count": d(1), "cleared": d(lambda c: c["A"])},
    "roznamcha": {"receipts": d(lambda c: c["A"])},
    "demand_register": {"balance": ANY, "overdue": ANY},
    "home_widgets": {
        "paid": d(lambda c: c["A"]),
        "outstanding": ANY,
        "advance": ANY,
        "today_collections": d(lambda c: c["A"]),
    },
    "home_trends": {"collections": d(lambda c: c["A"])},
    "collections": {"count": d(1), "total": d(lambda c: c["A"]), "cash": ANY, "account": ANY, "other": ANY},
    "outstanding": {"received": d(lambda c: c["A"]), "outstanding": ANY, "advance": ANY},
    "project_statement": {"received": d(lambda c: c["A"])},
    "status_counters": {"tower_paid": d(lambda c: c["A"]), "project_paid": d(lambda c: c["A"])},
    "pdfs": {
        "statement_rows": d(1),
        "last_receipt_pdf": ("new receipt, PDF 200", lambda b, a, c: a == f"{c['rno']}:200"),
    },
    "journey": {"entries": GROWS, "last": to("payment.post"), "last_has_values": to(True)},
    "notifications": {"unread": ANY},
}


def _paid(w, c):
    """Σ paid on the booking's live bills — the receipt's allocation is the change in this around the action."""
    ds = w.api.get(f"/reports/statement/{c['bid']}")["demands"]
    return sum(d.get("paid_paise") or 0 for d in ds if not d.get("voided") and d.get("status") != "Cancelled")


def _pay_action(mode, category, extra=None):
    def setup(w):
        c = w.book()
        c["mode"] = mode
        return c | w.ctx(**c)

    def act(w, c):
        p0 = _paid(w, c)
        p = w.pay(c, 2500, mode, category, **(extra(w) if extra else {}))
        c["A"], c["rno"], c["pay_id"] = 250000, p["receipt_number"], p["id"]
        c["alloc"] = _paid(w, c) - p0

    return setup, act


def _cheque_extra(w):
    return {"instrument": {"number": f"CQ{uuid.uuid4().hex[:6]}", "date": w.today, "bank_name": "Matrix Bank"}}


def _upi_extra(w):
    return {"instrument": {"number": f"UTR{uuid.uuid4().hex[:8]}"}}


CHEQUE_POSTED = {
    "booking_page": {"pending_cheques": d(lambda c: c["A"])},
    "ledger": ANY,
    "received": {"count": d(1), "pending": d(lambda c: c["A"])},
    "cheque_register": {"count": d(1), "amount": d(lambda c: c["A"])},
    "roznamcha": {"pending": d(lambda c: c["A"])},
    "home_widgets": {"pending_cheques": d(lambda c: c["A"])},
    "collections": {"pending": d(lambda c: c["A"])},
    "pdfs": {"statement_rows": ANY, "last_receipt_pdf": ANY},
    "journey": {"entries": GROWS, "last": to("payment.post"), "last_has_values": to(True)},
    "notifications": {"unread": ANY},
}


def _with_cheque(w):
    c = w.book()
    c |= w.ctx(**c)
    p = w.pay(c, 2500, "CHEQUE", "Account", **_cheque_extra(w))
    c["A"], c["rno"], c["pay_id"] = 250000, p["receipt_number"], p["id"]
    return c


def _cheque_clear(w, c):
    p0 = _paid(w, c)
    w.api.post(f"/payments/{c['pay_id']}/clear", {})
    c["alloc"] = _paid(w, c) - p0


def _cheque_bounce(w, c):
    w.api.post(f"/payments/{c['pay_id']}/bounce", {"reason": "matrix bounce"})


CLEARED = {
    **{k: v for k, v in MONEY_IN.items() if k not in ("ledger", "pdfs")},
    "booking_page": {
        "received": d(lambda c: c["A"]),
        "pending_cheques": d(lambda c: -c["A"]),
        "outstanding": ANY,
        "advance": ANY,
    },
    "received": {"cleared": d(lambda c: c["A"]), "pending": d(lambda c: -c["A"])},
    "cheque_register": {"count": d(-1), "amount": d(lambda c: -c["A"])},
    "roznamcha": {"receipts": d(lambda c: c["A"]), "pending": d(lambda c: -c["A"])},
    "home_widgets": {
        "paid": d(lambda c: c["A"]),
        "outstanding": ANY,
        "advance": ANY,
        "pending_cheques": d(lambda c: -c["A"]),
        "today_collections": d(lambda c: c["A"]),
    },
    "collections": {
        "count": d(1),
        "total": d(lambda c: c["A"]),
        "account": d(lambda c: c["A"]),
        "pending": d(lambda c: -c["A"]),
    },
    "ledger": {"rows": ANY, "jama": d(lambda c: c["A"])},
    "pdfs": {"statement_rows": ANY},
    "journey": {"entries": GROWS, "last": to("payment.clear"), "last_has_values": to(True)},
}
BOUNCED = {
    "booking_page": {"pending_cheques": d(lambda c: -c["A"]), "bill": ANY, "outstanding": ANY},
    "customer_360": {"bill": ANY},
    "ledger": ANY,
    "bills_raised": ANY,
    "received": {"pending": d(lambda c: -c["A"]), "bounced": d(1)},
    "cheque_register": {"count": d(-1), "amount": d(lambda c: -c["A"])},
    "roznamcha": {"pending": d(lambda c: -c["A"])},
    "demand_register": ANY,
    "home_widgets": {"pending_cheques": d(lambda c: -c["A"]), "outstanding": ANY},
    "home_trends": {"demands": ANY},
    "collections": {"pending": d(lambda c: -c["A"])},
    "outstanding": {"outstanding": ANY, "bill_raised": ANY},
    "project_statement": {"bill": ANY},
    "pdfs": ANY,
    "documents": ANY,
    "journey": {"entries": GROWS, "last": ANY, "last_has_values": ANY},
    "notifications": {"unread": ANY},
}


def _with_cash_receipt(w):
    c = w.book()
    c |= w.ctx(**c)
    p = w.pay(c, 2500)
    c["A"], c["pay_id"] = 250000, p["id"]
    return c


def _reverse(w, c):
    p0 = _paid(w, c)
    w.api.post(f"/payments/{c['pay_id']}/reverse", {"reason": "matrix reversal"})
    c["alloc"] = p0 - _paid(w, c)


REVERSED = {
    "booking_page": {"received": d(lambda c: -c["A"]), "outstanding": ANY, "advance": ANY},
    "customer_360": {"received": d(lambda c: -c["A"])},
    "ledger": {"rows": d(1), "jama": d(lambda c: -c["A"])},
    "received": {"cleared": d(lambda c: -c["A"]), "reversed": d(1)},
    "roznamcha": {"receipts": d(lambda c: -c["A"])},
    "demand_register": {"balance": ANY, "overdue": ANY},
    "home_widgets": {
        "paid": d(lambda c: -c["A"]),
        "outstanding": ANY,
        "advance": ANY,
        "today_collections": d(lambda c: -c["A"]),
    },
    "home_trends": {"collections": d(lambda c: -c["A"])},
    "collections": {"total": d(lambda c: -c["A"]), "cash": d(lambda c: -c["A"]), "count": ANY},
    "outstanding": {"received": d(lambda c: -c["A"]), "outstanding": ANY, "advance": ANY},
    "project_statement": {"received": d(lambda c: -c["A"])},
    "status_counters": {"tower_paid": d(lambda c: -c["A"]), "project_paid": d(lambda c: -c["A"])},
    "pdfs": {"statement_rows": d(1), "last_receipt_pdf": ANY},
    "journey": {"entries": GROWS, "last": to("payment.reverse"), "last_has_values": to(True)},
    "notifications": {"unread": ANY},
}


def _create_setup(w):
    f, cust = w.flat(), w.customer()
    return w.ctx(fid=f["id"], cid=cust["id"], bid=None, flat=f, cust=cust)


def _create(w, c):
    c |= w.book(c["flat"], c["cust"])
    c["price"] = round(c["flat"]["price"] * 100)


def _create_discounted(
    w, c
):  # REQ-235…241: 50,000 below list with a reason — money exactly as any booking at that price
    f, price = c["flat"], c["flat"]["price"] - 50000
    cash = round(price * 0.5, 2)
    body = {
        "flat_id": f["id"],
        "customer_id": c["cust"]["id"],
        "booking_date": w.today,
        "agreement_value": price,
        "cash_agreed": cash,
        "account_agreed": round(price - cash, 2),
        "discount_reason": "matrix discount",
    }
    b = w.api.post("/bookings", body)
    c |= {"bid": b["id"], "cid": b["customer_id"], "fid": f["id"], "pid": w.pid, "blid": w.blid}
    c["price"], c["list"] = round(price * 100), round(f["price"] * 100)


BOOKED = {  # before = no booking yet (booking-scoped surfaces read as empty)
    "booking_page": {k: CHANGED for k in ("status", "flat", "agreement", "bill", "outstanding", "plan")}
    | {"received": to(0), "advance": to(0), "pending_cheques": to(0)},
    "customer_360": {"bookings": d(1), "status": to("Active"), "bill": CHANGED, "received": to(0)},
    "ledger": {"rows": GROWS, "udhar": GROWS, "jama": to(0)},
    "bills_raised": {"count": GROWS, "raised": GROWS},
    "received": ANY,
    "demand_register": {
        "raised_today": GROWS,
        "raised_today_n": GROWS,
        "rows": GROWS,
        "total": GROWS,
        "balance": GROWS,
    },
    "home_widgets": {"available": d(-1), "bookings": d(1), "agreement": d(lambda c: c["price"]), "outstanding": GROWS},
    "home_trends": {"bookings": d(1), "demands": GROWS},
    "outstanding": {"bookings": d(1), "bill_raised": GROWS, "outstanding": GROWS},
    "project_statement": {"count": d(1), "bill": GROWS},
    "status_counters": {"fid_status": to("Booked"), "tower_bookings": d(1), "project_bookings": d(1)},
    "inventory_value": {
        "available": d(-1),
        "booked": d(1),
        "available_value": d(lambda c: -c["price"]),
        "sold_value": d(lambda c: c["price"]),
    },
    "pdfs": {
        "statement_pdf": to(True),
        "statement_rows": GROWS,
        "last_demand_pdf": ("demand letter PDF 200", lambda b, a, c: str(a).endswith(":200")),
    },
    "documents": {"docs": GROWS},
    "journey": {"entries": GROWS, "last": to("booking.create"), "last_has_values": to(True)},
    "notifications": {"unread": ANY},
    "lead_funnel": ANY,
}


def _empty_booking_snapshot(snap):
    """Booking-scoped surfaces before the booking exists."""
    for k in ("booking_page", "ledger", "bills_raised", "received", "pdfs", "documents", "journey"):
        snap[k] = {}
    return snap


def _with_receipt(w):
    c = _with_cash_receipt(w)
    c["price"] = round(w.api.get(f"/bookings/{c['bid']}")["agreement_value_paise"])
    return c


def _cancel(deduction_rupees):
    def act(w, c):
        st = w.api.get(f"/reports/statement/{c['bid']}")["demands"]
        c["bill_balance"] = sum(
            (d.get("total_demand_paise") or 0) - (d.get("paid_paise") or 0)
            for d in st
            if d.get("status") != "Cancelled"
        )
        w.api.post(
            f"/bookings/{c['bid']}/cancel",
            {"reason": "matrix cancel", "deduction": deduction_rupees, "version": w.version(c)},
        )
        canc = w.api.get(f"/bookings/{c['bid']}")["cancellation"]  # owner maths (policy %, caps) decides the split
        c["forfeit"], c["refund"] = canc["forfeiture_paise"], canc["refund_paise"]
        assert c["forfeit"] + c["refund"] <= c["A"], canc

    return act


def _refund_setup(w):
    """A cancelled booking whose refund is approved-pending: received ₹1.5 L cash, policy deduction leaves a refund."""
    c = w.book()
    c |= w.ctx(**c)
    w.pay(c, 150000)
    w.api.post(f"/bookings/{c['bid']}/cancel", {"reason": "matrix refund", "deduction": 0, "version": w.version(c)})
    rf = next(r for r in w.api.get(f"/bookings/{c['bid']}/refunds")["items"] if r["status"] == "Pending")
    c["rf"], c["R"] = rf["id"], rf.get("amount_total_paise") or rf["amount_paise"]
    assert c["R"] > 0, rf
    return c


def _refund_pay(w, c):
    w.api.post(f"/refunds/{c['rf']}/pay", {"paid_date": w.today, "mode": "CASH", "reference": "matrix cash refund"})


def _refund_other_setup(w):
    """A cancelled booking whose only money in was an other-charge payment: the pending refund is all Other category."""
    c = w.book(cash_share=0)
    c |= w.ctx(**c)
    line = next(x for x in w.api.get(f"/bookings/{c['bid']}")["other_charges"] if (x.get("demanded_paise") or 0) > 0)
    w.pay(
        c,
        line["demanded_paise"] / 100,
        "NEFT_RTGS",
        None,
        against="OTHER_CHARGE",
        other_charge_line_id=line["line_id"],
        **_upi_extra(w),
    )
    w.api.post(
        f"/bookings/{c['bid']}/cancel", {"reason": "matrix other refund", "deduction": 0, "version": w.version(c)}
    )
    rf = next(r for r in w.api.get(f"/bookings/{c['bid']}/refunds")["items"] if r["status"] == "Pending")
    c["rf"], c["R"] = rf["id"], rf.get("amount_total_paise") or rf["amount_paise"]
    assert c["R"] > 0 and rf["split"]["Other"] == c["R"], rf
    return c


REFUND_PAID = {
    "roznamcha": {
        "refunds": d(lambda c: c["R"]),
        "cash_out": d(lambda c: c["R"]),
        "closing": d(lambda c: -c["R"]),
        "refund_rows": d(1),
        "refund_rows_out": d(lambda c: c["R"]),
    },
}


def _cancelled():
    return {
        "booking_page": {"status": to("Cancelled"), "bill": ANY, "outstanding": ANY, "advance": ANY, "received": ANY},
        "customer_360": {"status": to("Cancelled"), "bill": ANY, "received": ANY},
        "customer_card": ANY,
        "booking_card": ANY,
        "project_card": ANY,
        "ledger": ANY,
        "bills_raised": ANY,
        "received": ANY,
        "roznamcha": ANY,
        "demand_register": ANY,
        "home_widgets": {
            "available": d(1),
            "bookings": d(-1),
            "agreement": d(lambda c: -c["price"]),
            "paid": ANY,
            "outstanding": ANY,
            "advance": ANY,
            "refunds_paid": ANY,
            "today_collections": ANY,
        },
        "home_trends": ANY,
        "collections": ANY,
        "outstanding": ANY,
        "project_statement": ANY,
        "cancellations": {"rows": d(1), "forfeit": d(lambda c: c["forfeit"]), "refund": d(lambda c: c["refund"])},
        "lead_funnel": {"Converted": d(-1), "Lost": d(1)},  # owner rule: the booking's lead is marked Lost
        "status_counters": {"fid_status": to("Available"), "tower_bookings": d(-1), "project_bookings": d(-1)}
        | {"tower_paid": ANY, "project_paid": ANY},
        "inventory_value": {
            "available": d(1),
            "booked": d(-1),
            "available_value": GROWS,
            "sold_value": d(lambda c: -c["price"]),
        },
        "pdfs": ANY,
        "documents": ANY,
        "journey": {"entries": GROWS, "last": to("booking.cancel"), "last_has_values": to(True)},
        "notifications": ANY,
    }


def _transfer_setup(w):
    c = _with_cash_receipt(w)
    c["fid2"] = w.flat()["id"]
    return c


def _transfer(w, c):
    body = {"new_flat_id": c["fid2"], "reason": "matrix transfer", "price_handling": "revise_agreement"}
    w.api.post(f"/bookings/{c['bid']}/transfer", body | {"version": w.version(c)})


TRANSFERRED = {
    "booking_page": {
        "flat": to(lambda c: c["fid2"]),
        "bill": ANY,
        "outstanding": ANY,
        "advance": ANY,
        "agreement": ANY,
    },
    "customer_360": {"bill": ANY},
    "ledger": ANY,
    "bills_raised": ANY,
    "demand_register": ANY,
    "home_widgets": {"agreement": ANY, "outstanding": ANY, "advance": ANY},
    "home_trends": ANY,
    "outstanding": ANY,
    "project_statement": ANY,
    "status_counters": {"fid_status": to("Available"), "fid2_status": to("Booked")},
    "inventory_value": {"available_value": ANY, "sold_value": ANY},
    "pdfs": ANY,
    "documents": ANY,
    "journey": {"entries": GROWS, "last": to("booking.transfer"), "last_has_values": to(True)},
    "notifications": ANY,
}


def _revise(w, c):
    b = w.api.get(f"/bookings/{c['bid']}")
    body = {"cash_agreed": b["cash_agreed"], "account_agreed": b["account_agreed"] + 10000, "reason": "matrix revision"}
    w.api.post(f"/bookings/{c['bid']}/agreement-revisions", body)


REVISED = {
    "booking_page": {"agreement": d(1000000), "bill": ANY, "outstanding": ANY, "advance": ANY},
    "customer_360": {"bill": ANY},
    "ledger": ANY,
    "bills_raised": ANY,
    "demand_register": ANY,
    "home_widgets": {"agreement": d(1000000), "outstanding": ANY, "advance": ANY},
    "home_trends": ANY,
    "outstanding": ANY,
    "project_statement": ANY,
    "pdfs": ANY,
    "documents": ANY,
    "journey": {"entries": GROWS, "last": ANY, "last_has_values": to(True)},
    "notifications": ANY,
}


def _plan_setup(w):
    c = w.book()
    c |= w.ctx(**c)
    cur = w.api.get(f"/bookings/{c['bid']}")["payment_plan_id"]
    plans = w.api.get("/master/payment-plans", page_size=200)["items"]
    c["plan2"] = next(p["id"] for p in plans if p["id"] != cur and p.get("code") == "LUMP100")
    return c


def _change_plan(w, c):
    body = {"payment_plan_id": c["plan2"], "reason": "matrix plan change", "version": w.version(c)}
    w.api.post(f"/bookings/{c['bid']}/payment-plan", body)


PLAN_CHANGED = {
    "booking_page": {"plan": to(lambda c: c["plan2"]), "bill": ANY, "outstanding": ANY, "advance": ANY},
    "customer_360": {"bill": ANY},
    "ledger": ANY,
    "bills_raised": ANY,
    "demand_register": ANY,
    "home_widgets": {"outstanding": ANY, "advance": ANY},
    "home_trends": ANY,
    "outstanding": ANY,
    "project_statement": ANY,
    "pdfs": ANY,
    "documents": ANY,
    "journey": {"entries": GROWS, "last": ANY, "last_has_values": ANY},
    "notifications": ANY,
}


def _hold_body(w, fid, seconds):
    reason = w.api.get("/master/hold-reasons")["items"][0]["id"]
    until = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
    return {"flat_ids": [fid], "action": "hold", "reason_id": reason, "expires_at": until, "note": "matrix hold"}


def _flat_setup(w):
    f = w.flat()
    return w.ctx(bid=None, fid=f["id"], price=round(f["price"] * 100), flat=f)


def _hold(w, c):
    w.api.post("/inventory/bulk", _hold_body(w, c["fid"], 86400))


def _held_setup(seconds):
    def setup(w):
        c = _flat_setup(w)
        w.api.post("/inventory/bulk", _hold_body(w, c["fid"], seconds))
        return c

    return setup


def _release(w, c):
    w.api.post("/inventory/bulk", {"flat_ids": [c["fid"]], "action": "release", "note": "matrix release"})


def _expire(w, c):
    time.sleep(4)  # the hold's own expiry time (set 3 s ahead in setup) must pass — not a surface wait
    w.api.post("/inventory/holds/expire-sweep")


def _held(sign, released=0, expired=0):
    return {
        "home_widgets": {"available": d(-sign)},
        "hold_register": {"active": d(sign), "on_hold": d(sign), "held_total": d(max(sign, 0))}
        | {"released": d(released), "expired": d(expired)},
        "status_counters": {"fid_status": to("Hold" if sign > 0 else "Available")},
        "inventory_value": {
            "available": d(-sign),
            "hold": d(sign),
            "available_value": d(lambda c: -sign * c["price"]),
        },
        "notifications": ANY,
    }


def _price(w, c):
    f = w.api.get(f"/flats/{c['fid']}")
    sheet = {"saleable_sqft": 1000, "pricing_mode": "rate", "rate_per_sqft": 4300, "version": f["version"]}
    w.api.call("PATCH", f"/flats/{c['fid']}/pricing", sheet)


PRICED = {
    "status_counters": {"fid_price": d(100000)},
    "inventory_value": {"available_value": d(10000000)},
}


def _lead_setup(w):
    tag = uuid.uuid4().hex[:6]
    lead = w.api.post(
        "/leads", {"name": f"Matrix lead {tag}", "phone": f"+9197{int(tag, 16) % 10**8:08d}", "project_id": w.pid}
    )
    f = w.flat()
    return w.ctx(bid=None, fid=f["id"], flat=f, lead=lead, price=round(f["price"] * 100))


def _lead_to_booking(w, c):
    lead = c["lead"]
    day = (datetime.fromisoformat(w.today) + timedelta(days=1)).date().isoformat()
    avail = w.api.get("/site-visits/availability", project_id=w.pid, date_from=day, date_to=day)["days"][0]["slots"]
    slot = next(s for s in avail if s["available_count"] > 0)["start"]
    w.api.post("/site-visits", {"project_id": w.pid, "date": day, "slot_start": slot, "lead_id": lead["id"]})
    cust = w.api.post(f"/leads/{lead['id']}/convert", {})
    cust = cust.get("customer") or cust
    c |= w.book(c["flat"], cust, lead_id=lead["id"])


LEAD_BOOKED = {
    **BOOKED,
    "lead_funnel": {"Converted": d(1), "New": ANY, "Site Visit Scheduled": ANY},
    "customer_360": {"bookings": d(1), "status": to("Active"), "bill": CHANGED, "received": to(0)},
    "home_widgets": {**BOOKED["home_widgets"], "leads_open": ANY},
}


def _master_setup(w):
    c = _with_cash_receipt(w)
    ct = next(x for x in w.api.get("/master/charge-types", page_size=100)["items"] if x["code"] == "CLUB")
    c["ct"] = ct
    return c


def _master_change(w, c):
    ct = c["ct"]
    keep = (
        "name",
        "code",
        "default_amount",
        "is_taxable",
        "calc_type",
        "default_value",
        "default_demand_timing",
        "sort_order",
    )
    body = {k: ct[k] for k in keep if k in ct} | {
        "default_gst_percent": 12 if ct.get("default_gst_percent") != 12 else 5
    }
    old_lines = _club_lines(w.api.get(f"/bookings/{c['bid']}"), ct["id"])
    w.api.call("PATCH", f"/master/charge-types/{ct['id']}", body | {"version": ct.get("version")})
    c["restore"] = lambda: w.api.call(
        "PATCH",
        f"/master/charge-types/{ct['id']}",
        {k: ct[k] for k in keep if k in ct}
        | {
            "default_gst_percent": ct.get("default_gst_percent"),
            "version": w.api.get(f"/master/charge-types/{ct['id']}")["version"],
        },
    )

    # REQ-137: a new entry is offered the new value; the older booking keeps its snapshot
    f = w.flats[w.used]
    pv = w.api.post("/bookings/breakdown-preview", {"flat_id": f["id"], "agreement_value": f["price"]})
    head = next(h for h in pv["heads"] if h["id"] == ct["id"])
    assert head["default_gst_percent"] == body["default_gst_percent"], head
    # (a project that sets its own GST for this head keeps it — project setup wins over the master default)
    assert _club_lines(w.api.get(f"/bookings/{c['bid']}"), ct["id"]) == old_lines


def _club_lines(b, ct_id):
    return [
        (x["line_id"], x["gst_percent"], x["total_paise"])
        for x in b.get("other_charges") or []
        if x.get("charge_type_id") == ct_id
    ]


MASTER_CHANGED = {"notifications": ANY}  # existing bookings, bills and every report unchanged — new entries only


def _stage_setup(w):
    c = w.book()
    c |= w.ctx(**c)
    b = w.api.get(f"/bookings/{c['bid']}")
    triggers = [
        i["trigger_stage_id"] for i in b["payment_plan_snapshot"]["installments"] if i["trigger_type"] == "ON_STAGE"
    ]
    stages = w.api.get(f"/blocks/{c['blid']}/construction")["stages"]
    open_ = [s for s in stages if s.get("status") != "Completed" and s["stage_id"] in triggers]
    assert open_, "matrix tower has no open plan stage"
    c["stage"] = open_[0]["stage_id"]
    return c


def _stage_complete(w, c):
    """The confirm-dialog preview must equal what posting raises: per booking and for the tower."""
    pv = w.api.get(f"/blocks/{c['blid']}/stages/{c['stage']}/preview")
    row = next(r for r in pv["bookings"] if r["booking_id"] == c["bid"])
    bill = lambda: w.api.get(f"/bookings/{c['bid']}")["summary"]["total_bill_raised_paise"]  # noqa: E731
    b0, t0 = bill(), s_pstatement(w.api, c)["bill"]
    w.api.post(f"/blocks/{c['blid']}/construction/stage", {"stage_id": c["stage"], "completed_on": w.today})
    assert bill() - b0 == row["total_paise"], ("booking preview != posted", row, b0)
    assert s_pstatement(w.api, c)["bill"] - t0 == pv["total_paise"], ("tower preview != posted", pv["total_paise"])
    # REQ-205/206: each GST part billed with the stage is its own line, due on the stage bill's due date → Not due today
    from datetime import date as _d
    from datetime import timedelta as _td

    from services.definitions import band_of

    bk = w.api.get(f"/bookings/{c['bid']}")
    dues = {x.get("trigger_stage_id"): x.get("due_date") for x in bk.get("demands") or []}
    parts = [
        h
        for ln in bk.get("other_charges") or []
        for h in ln.get("demand_history") or []
        if h.get("stage_id") == c["stage"]
    ]
    for h in parts:
        assert h.get("due_on") == dues.get(c["stage"]), ("GST part due_on != stage bill due", h, dues.get(c["stage"]))
        today = _d.fromisoformat(w.today)
        assert band_of(h["due_on"], today) == "Not due", ("new GST part not Not due", h)
        assert band_of(h["due_on"], _d.fromisoformat(h["due_on"]) + _td(days=1)) == "0-30", (
            "clock past due != 0-30",
            h,
        )


def _stage_undo_setup(w):
    c = _stage_setup(w)
    _stage_complete(w, c)
    return c


def _stage_undo(w, c):
    w.api.post(f"/blocks/{c['blid']}/construction/undo", {"reason": "matrix undo"})


def _stage_spec(sign):
    grow = GROWS if sign > 0 else ("shrinks", lambda b, a, c: (a or 0) < (b or 0))
    return {
        "booking_page": {"bill": grow, "outstanding": grow, "advance": ANY},
        "customer_360": {"bill": grow},
        "ledger": {"rows": GROWS if sign > 0 else ANY, "udhar": grow},
        "bills_raised": {"count": d(sign), "raised": grow},
        "demand_register": {"rows": ANY, "total": grow, "balance": grow, "raised_today": ANY, "raised_today_n": ANY},
        "home_widgets": {"outstanding": grow, "advance": ANY},
        "home_trends": {"demands": ANY},
        "outstanding": {"outstanding": grow, "bill_raised": grow, "advance": ANY},
        "project_statement": {"bill": grow},
        "pdfs": {"statement_rows": ANY, "last_demand_pdf": ANY},
        "documents": ANY,
        "journey": ANY,
        "notifications": ANY,
    }


def _waiver_setup(w):
    c = w.book()
    c |= w.ctx(**c)
    w.api.post(
        "/demands/manual", {"booking_id": c["bid"], "name": "Matrix bill", "account_amount": 20000, "due_date": w.today}
    )
    return c


def _waive(w, c):  # owner request = approved at once (self-approved); Account share, 10,000 + its GST credit
    r = w.api.post(
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "share", "share": "Account"},
            "amount": 10000,
            "reason": "matrix waiver",
        },
    )
    c["T"] = sum(e["amount_paise"] for e in r["entries"])


def _acc_api(w):
    from tools._env import TEST_PASSWORD

    r = requests.post(
        w.api.base + "/auth/login", json={"email": "accounts@kkt.in", "password": TEST_PASSWORD}, timeout=30
    )
    return Api(w.api.base[: -len("/api")], {"Authorization": f"Bearer {r.json()['access_token']}"})


def _waiver_body(c, amount=10000):
    return {
        "booking_id": c["bid"],
        "target": {"kind": "share", "share": "Account"},
        "amount": amount,
        "reason": "matrix waiver",
    }


def _waive_pending(w, c):  # REQ-246: a pending request moves no money anywhere
    _acc_api(w).post("/waivers", _waiver_body(c))


def _waive_reject(w, c):
    r = _acc_api(w).post("/waivers", _waiver_body(c))
    w.api.post(f"/waivers/{r['id']}/reject", {"reason": "matrix reject"})


def _waive_cancel(w, c):  # REQ-252: approve then cancel = exact reversing rows; money back where it was
    r = w.api.post("/waivers", _waiver_body(c))
    c["E"] = 2 * len(r["entries"])  # each credit row (share + its GST line) gets one exact reversing row
    w.api.post(f"/waivers/{r['id']}/cancel", {"reason": "matrix cancel"})


NO_MONEY = {"journey": {"entries": ANY, "last": ANY, "last_has_values": ANY}, "notifications": ANY}
WAIVER_CANCELLED = {
    "ledger": {"rows": d(lambda c: c["E"]), "jama": d(0)},
    "pdfs": {"statement_rows": d(lambda c: c["E"])},
    "journey": {"entries": GROWS, "last": ANY, "last_has_values": ANY},
    "notifications": ANY,
}


WAIVED = {  # REQ-253: a waiver is Jama credit, never money received — no receipt surface moves
    "booking_page": {"outstanding": d(lambda c: -c["T"]), "advance": ANY},
    "ledger": {"rows": GROWS, "jama": d(lambda c: c["T"])},
    "demand_register": {"balance": ANY, "overdue": ANY},
    "home_widgets": {"outstanding": d(lambda c: -c["T"]), "advance": ANY},
    "outstanding": {"outstanding": d(lambda c: -c["T"]), "advance": ANY},
    "pdfs": {"statement_rows": GROWS},
    "journey": {"entries": GROWS, "last": ANY, "last_has_values": ANY},
    "notifications": ANY,
}


ACTIONS = {
    "create booking": (_create_setup, _create, BOOKED),
    "payment Cash": (*_pay_action("CASH", "Cash"), MONEY_IN),
    "payment Cheque": (*_pay_action("CHEQUE", "Account", _cheque_extra), CHEQUE_POSTED),
    "payment NEFT/RTGS": (*_pay_action("NEFT_RTGS", "Account", _upi_extra), MONEY_IN),
    "payment UPI": (*_pay_action("UPI", "Account", _upi_extra), MONEY_IN),
    "cheque clear": (_with_cheque, _cheque_clear, CLEARED),
    "cheque bounce": (_with_cheque, _cheque_bounce, BOUNCED),
    "receipt reversal": (_with_cash_receipt, _reverse, REVERSED),
    "stage complete → bills": (_stage_setup, _stage_complete, _stage_spec(1)),
    "stage undo": (_stage_undo_setup, _stage_undo, _stage_spec(-1)),
    "cancel → refund": (_with_receipt, _cancel(0), _cancelled()),
    "cancel → forfeit": (_with_receipt, _cancel(2500), _cancelled()),
    "refund paid (cash)": (_refund_setup, _refund_pay, REFUND_PAID),
    "refund of an Other-category payment": (_refund_other_setup, _refund_pay, REFUND_PAID),
    "transfer": (_transfer_setup, _transfer, TRANSFERRED),
    "agreement revision": (_with_cash_receipt, _revise, REVISED),
    "change plan": (_plan_setup, _change_plan, PLAN_CHANGED),
    "hold": (_flat_setup, _hold, _held(1)),
    "release": (_held_setup(86400), _release, _held(-1, released=1)),
    "hold expiry": (_held_setup(3), _expire, _held(-1, expired=1)),
    "unsold flat price change": (_flat_setup, _price, PRICED),
    "lead → visit → booking": (_lead_setup, _lead_to_booking, LEAD_BOOKED),
    "master change (charge head GST %)": (_master_setup, _master_change, MASTER_CHANGED),
    "booking with discount": (_create_setup, _create_discounted, BOOKED),
    "waiver approved (Account share)": (_waiver_setup, _waive, WAIVED),
    "waiver requested (pending)": (_waiver_setup, _waive_pending, NO_MONEY),
    "waiver rejected": (_waiver_setup, _waive_reject, NO_MONEY),
    "waiver approved then cancelled": (_waiver_setup, _waive_cancel, WAIVER_CANCELLED),
}


# ---------------------------------------------------------------- A1: precise relations replace "any" cells
def before_neg(surface, metric):
    """Δ = −(the subject's value before the action) — e.g. a cancelled booking leaves the report entirely."""
    return (f"Δ = −{surface}.{metric} before", lambda b, a, c: (a or 0) - (b or 0) == -c["_B"](surface, metric))


BK = {  # the booking page vs its own record, every booking money action
    "outstanding": LAW,
    "advance": ("Δadvance = Δreceived − Δbill + Δoutstanding (record)", LAW[1]),
}
SUBJECT = {  # every other surface moves exactly as the subject booking did (only it changed)
    "customer_360": {"bill": tie("booking_page", "bill"), "received": tie("booking_page", "received")},
    "ledger": {
        "udhar": tie("booking_page", "bill"),
        "jama": tie("booking_page", "received"),
        "rows": tie("pdfs", "statement_rows"),
    },
    "bills_raised": {},
    "demand_register": {
        "total": tie("bills_raised", "raised"),
        "rows": tie("bills_raised", "count"),
        "raised_today": tie("bills_raised", "raised"),
        "raised_today_n": tie("bills_raised", "count"),
    },
    "home_widgets": {
        "outstanding": tie("booking_page", "outstanding"),
        "advance": tie("booking_page", "advance"),
        "paid": tie("booking_page", "received"),
        "pending_cheques": tie("booking_page", "pending_cheques"),
    },
    "home_trends": {"demands": tie("bills_raised", "raised"), "collections": tie("collections", "total")},
    "outstanding": {
        "outstanding": tie("booking_page", "outstanding"),
        "advance": tie("booking_page", "advance"),
        "bill_raised": tie("booking_page", "bill"),
        "received": tie("booking_page", "received"),
    },
    "project_statement": {"bill": tie("booking_page", "bill"), "received": tie("booking_page", "received")},
    "status_counters": {"tower_paid": tie("booking_page", "received"), "project_paid": tie("booking_page", "received")},
    "pdfs": {"statement_rows": tie("ledger", "rows")},
    "customer_card": {
        "billed": tie("ledger", "udhar"),
        "received": tie("ledger", "jama"),
        "due": tie("booking_page", "outstanding"),
        "advance": tie("booking_page", "advance"),
    },
    "booking_card": {
        "billed": tie("ledger", "udhar"),
        "received": tie("ledger", "jama"),
        "due": tie("booking_page", "outstanding"),
        "advance": tie("booking_page", "advance"),
    },
    "project_card": {"collected": tie("ledger", "jama"), "outstanding": tie("booking_page", "outstanding")},
}


def ex_gst(surface, metric):
    """Bills before GST (register, trends) × the subject booking's own GST factor = bills with GST (statement)."""

    def ok(b, a, c):
        base, gross = c["_D"]("bills_raised", "raised"), c["_D"]("booking_page", "bill")
        want = c["_D"](surface, metric)
        return base != 0 and abs(((a or 0) - (b or 0)) * gross - want * base) <= abs(base) * 100

    return (f"Δ × (booking bill ÷ bill before GST) = Δ {surface}.{metric}", ok)


TOWER = {  # stage complete / undo touch every booking in the tower → the aggregates must agree with each other
    "demand_register": {
        "total": ex_gst("project_statement", "bill"),
        "raised_today": ex_gst("project_statement", "bill"),
        "rows": tie("demand_register", "raised_today_n"),
        "raised_today_n": tie("demand_register", "rows"),
        "balance": ex_gst("project_statement", "bill"),
    },
    "home_widgets": {"outstanding": tie("outstanding", "outstanding"), "advance": tie("outstanding", "advance")},
    "home_trends": {"demands": ex_gst("project_statement", "bill")},
    "outstanding": {
        "outstanding": tie("project_statement", "bill"),
        "bill_raised": tie("project_statement", "bill"),
        "advance": ("unchanged", lambda b, a, c: a == b),
    },
}
CANCELLED = {  # the booking leaves every live total: Δ = −its value before
    "home_widgets": {
        "outstanding": before_neg("booking_page", "outstanding"),
        "paid": before_neg("booking_page", "received"),
    }
    | {"advance": before_neg("booking_page", "advance"), "refunds_paid": ("unchanged", lambda b, a, c: a == b)},
    "outstanding": {
        "outstanding": before_neg("booking_page", "outstanding"),
        "advance": before_neg("booking_page", "advance"),
        "bill_raised": before_neg("booking_page", "bill"),
        "received": before_neg("booking_page", "received"),
    },
    "project_statement": {
        "bill": before_neg("booking_page", "bill"),
        "received": before_neg("booking_page", "received"),
    },
    "status_counters": {
        "tower_paid": before_neg("booking_page", "received"),
        "project_paid": before_neg("booking_page", "received"),
    },
    "demand_register": {"total": before_neg("bills_raised", "raised"), "rows": before_neg("bills_raised", "count")}
    | {"raised_today": before_neg("bills_raised", "raised"), "raised_today_n": before_neg("bills_raised", "count")}
    | {"balance": ("Δ = −open balance of its bills", lambda b, a, c: (a or 0) - (b or 0) == -c["bill_balance"])},
    "home_trends": {"demands": before_neg("bills_raised", "raised")},
    "bills_raised": {"count": before_neg("bills_raised", "count"), "raised": before_neg("bills_raised", "raised")},
    "booking_page": {"bill": tie("ledger", "udhar"), "received": ("unchanged", lambda b, a, c: a == b)}
    | {"outstanding": to(0), "advance": to(0)},
    "customer_360": {"bill": tie("booking_page", "bill"), "received": tie("booking_page", "received")},
    "ledger": {"udhar": tie("booking_page", "bill"), "rows": tie("pdfs", "statement_rows")},
    "inventory_value": {"available_value": d(lambda c: c["price"])},
    "documents": {"docs": d(1)},
    "pdfs": {"statement_rows": tie("ledger", "rows"), "last_demand_pdf": to(None)},
}
CANCELLED["outstanding"] |= {"bookings": d(-1)}
CANCELLED["project_statement"] |= {"count": d(-1)}
PRECISE = {
    "waiver approved (Account share)": {  # REQ-253: Jama credit lowers what is due; received money does not move
        "booking_page": {"outstanding": d(lambda c: -c["T"]), "received": d(0), "advance": d(0)},
        "outstanding": {"outstanding": d(lambda c: -c["T"]), "received": d(0), "advance": d(0)},
        "customer_card": {"received": d(0), "due": d(lambda c: -c["T"])},
        "booking_card": {"received": d(0), "due": d(lambda c: -c["T"])},
        "customer_360": {"received": d(0)},
        "project_card": {"collected": d(0), "outstanding": d(lambda c: -c["T"])},
        "home_widgets": {"paid": d(0), "outstanding": d(lambda c: -c["T"])},
        "status_counters": {"tower_paid": d(0), "project_paid": d(0)},
        "project_statement": {"received": d(0)},
    },
    "payment Cash": {
        "booking_page": {"outstanding": d(lambda c: -c["alloc"]), "advance": d(lambda c: c["A"] - c["alloc"])}
    }
    | {"collections": {"cash": d(lambda c: c["A"])}},
    "payment NEFT/RTGS": {
        "booking_page": {"outstanding": d(lambda c: -c["alloc"]), "advance": d(lambda c: c["A"] - c["alloc"])}
    }
    | {"collections": {"account": d(lambda c: c["A"])}},
    "payment UPI": {
        "booking_page": {"outstanding": d(lambda c: -c["alloc"]), "advance": d(lambda c: c["A"] - c["alloc"])}
    }
    | {"collections": {"account": d(lambda c: c["A"])}},
    "payment Cheque": {"pdfs": {"last_receipt_pdf": ("new receipt, PDF 200", lambda b, a, c: a == f"{c['rno']}:200")}},
    "cheque clear": {
        "booking_page": {"outstanding": d(lambda c: -c["alloc"]), "advance": d(lambda c: c["A"] - c["alloc"])}
    },
    "receipt reversal": {
        "booking_page": {"outstanding": d(lambda c: c["alloc"]), "advance": d(lambda c: c["alloc"] - c["A"])}
    }
    | {"collections": {"count": d(1)}},
    "cancel → refund": CANCELLED,
    "cancel → forfeit": CANCELLED,
    "stage complete → bills": TOWER
    | {"documents": {"docs": d(1)}, "journey": {"entries": tie("ledger", "rows"), "last": to("demand.create")}},
    "stage undo": TOWER | {"notifications": ALERTS_RETRACT},
    "create booking": {
        "lead_funnel": {"Converted": d(1)},
        "received": {k: to(0) for k in ("bounced", "cleared", "count", "pending", "reversed")},
    },
    "lead → visit → booking": {"received": {k: to(0) for k in ("bounced", "cleared", "count", "pending", "reversed")}},
    "booking with discount": {  # same as create booking; inventory value moves at the flat's list price
        "lead_funnel": {"Converted": d(1)},
        "received": {k: to(0) for k in ("bounced", "cleared", "count", "pending", "reversed")},
        "inventory_value": {"available_value": d(lambda c: -c["list"]), "sold_value": d(lambda c: c["list"])},
    },
    "agreement revision": {
        "bills_raised": {"raised": tie("demand_register", "total")},
        "demand_register": {"balance": tie("bills_raised", "raised")},
    },
    "change plan": {
        "bills_raised": {"raised": tie("demand_register", "total"), "count": tie("demand_register", "rows")},
        "demand_register": {"balance": tie("bills_raised", "raised")},
        "pdfs": {
            "last_demand_pdf": ("a new demand letter, PDF 200", lambda b, a, c: a != b and str(a).endswith(":200"))
        },
        "documents": {"docs": d(1)},
    },
}
SAME = ("unchanged", lambda b, a, c: a == b)
NEW_PDF = ("a different live PDF, 200", lambda b, a, c: a != b and str(a).endswith(":200"))
LIVE_PDF = ("a live bill's PDF, 200", lambda b, a, c: str(a).endswith(":200"))


def _more(name, layer):
    cur = PRECISE.setdefault(name, {})
    for surf, metrics in layer.items():
        cur[surf] = {**cur.get(surf, {}), **metrics}


for _n, _cat in (("payment Cash", "cash"), ("payment NEFT/RTGS", "account"), ("payment UPI", "account")):
    _more(_n, {"demand_register": {"balance": d(lambda c: -c["alloc"]), "overdue": SAME}})
    _more(_n, {"collections": {k: SAME for k in ("cash", "account", "other") if k != _cat}})
_more("cheque clear", {"demand_register": {"balance": d(lambda c: -c["alloc"]), "overdue": SAME}})
_more("receipt reversal", {"demand_register": {"balance": d(lambda c: c["alloc"]), "overdue": SAME}})
_more("receipt reversal", {"pdfs": {"last_receipt_pdf": SAME}})
_more("payment Cash", {"roznamcha": {"closing": d(lambda c: c["A"])}})
# a cancelled booking's page keeps only what was retained: paying the refund R takes R off its bill and received
for _n in ("refund paid (cash)", "refund of an Other-category payment"):
    _more(
        _n,
        {
            "booking_page": {"bill": d(lambda c: -c["R"]), "received": d(lambda c: -c["R"])},
            "home_widgets": {"paid": SAME, "refunds_paid": d(lambda c: c["R"])},
            "outstanding": {"bill_raised": SAME, "received": SAME},
            "project_statement": {"bill": SAME, "received": SAME},
            "status_counters": {"project_paid": SAME, "tower_paid": SAME},
        },
    )
_more("receipt reversal", {"roznamcha": {"closing": d(lambda c: -c["A"]), "cash_out": d(lambda c: c["A"])}})
_more("cheque bounce", {"booking_page": {"bill": tie("ledger", "udhar")}, "journey": {"last": to("payment.bounce")}})
_more("cheque bounce", {"journey": {"last_has_values": SAME}})
for _n in ("stage complete → bills", "stage undo"):
    _more(_n, {"booking_page": {"advance": LAW}, "pdfs": {"statement_rows": tie("ledger", "rows")}})
_CARD_TIES = {
    "billed": tie("ledger", "udhar"),
    "received": tie("ledger", "jama"),
    "due": tie("booking_page", "outstanding"),
    "advance": tie("booking_page", "advance"),
}
_DROPS = ("drops off the live cards", lambda b, a, c: a is None)
for _n in ("stage complete → bills", "stage undo"):
    _more(
        _n,
        {
            "customer_card": dict(_CARD_TIES),
            "booking_card": dict(_CARD_TIES),
            "project_card": {"collected": SAME, "outstanding": tie("outstanding", "outstanding")},
        },
    )
for _n in ("cancel → refund", "cancel → forfeit"):
    _more(
        _n,
        {
            "customer_card": {m: _DROPS for m in _CARD_TIES},
            "booking_card": dict(_CARD_TIES),
            "project_card": {
                "collected": d(lambda c: -c["_B"]("customer_card", "received")),
                "outstanding": tie("outstanding", "outstanding"),
            },
        },
    )
for _n in ("refund paid (cash)", "refund of an Other-category payment"):
    _more(_n, {"customer_card": {m: SAME for m in _CARD_TIES}, "project_card": {"collected": SAME}})
_more("stage complete → bills", {"pdfs": {"last_demand_pdf": NEW_PDF}})
_more("stage undo", {"ledger": {"rows": tie("pdfs", "statement_rows")}, "pdfs": {"last_demand_pdf": LIVE_PDF}})
for _n in ("cancel → refund", "cancel → forfeit"):
    _more(_n, {"home_widgets": {"today_collections": SAME}})
_more(
    "transfer",
    {
        "booking_page": {"bill": SAME, "agreement": SAME},
        "home_widgets": {"agreement": tie("booking_page", "agreement")},
        "inventory_value": {"available_value": tie("inventory_value", "sold_value", -1)},
    },
)
_more("transfer", {"inventory_value": {"sold_value": tie("inventory_value", "available_value", -1)}})
_more("agreement revision", {"booking_page": {"bill": tie("ledger", "udhar")}})
_more("agreement revision", {"journey": {"last": to("booking.agreement_revision")}})
_more("change plan", {"booking_page": {"bill": tie("ledger", "udhar")}})
_more("change plan", {"journey": {"last": to("booking.plan_change"), "last_has_values": SAME}})
_more("lead → visit → booking", {"home_widgets": {"leads_open": d(-1)}})
_more("lead → visit → booking", {"lead_funnel": {"New": d(-1), "Site Visit Scheduled": SAME}})


NOT_SUBJECT = {"hold", "release", "hold expiry", "unsold flat price change", "master change (charge head GST %)"}
TOWER_WIDE = {"stage complete → bills", "stage undo"}


def tighten(name, spec):
    """Replace every "any" with a precise relation; returns (spec, remaining-any list)."""
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in spec.items()}
    out["notifications"] = dict(ALERTS)
    # Phase 2D: every Home widget moves exactly as the lists its numbers drill to
    out["home_command"] = {
        f"{s}:{w}": tie("home_command", f"{'l' if s == 'w' else 'w'}:{w}") for w in HOME_WIDGETS for s in "wl"
    }
    subject = name not in NOT_SUBJECT and name not in TOWER_WIDE and not name.startswith("cancel")
    layers = ([(SUBJECT, False), ({"booking_page": BK}, False)] if subject else []) + [(PRECISE.get(name, {}), True)]
    for layer, force in layers:
        for surf, metrics in layer.items():
            cur = {} if out.get(surf) is ANY or out.get(surf) is None else out[surf]
            for m, rel in metrics.items():
                if force or m not in cur or cur[m] is ANY:
                    cur[m] = rel
            out[surf] = cur
    left = []
    for surf, metrics in list(out.items()):
        if metrics is ANY:
            out[surf] = {}  # whole-surface "any" → strict: every metric unchanged unless listed
        else:
            left += [f"{surf}.{m}" for m, rel in metrics.items() if rel is ANY]
    return out, left


# ---------------------------------------------------------------- runner
def _check(action, spec, before, after, c):
    c["_D"] = lambda s_, m_: (after.get(s_, {}).get(m_) or 0) - (before.get(s_, {}).get(m_) or 0)
    c["_B"] = lambda s_, m_: before.get(s_, {}).get(m_) or 0
    c["_new"] = _new_alerts(c, before.get("notifications", {}).get("newest"))
    cells = []
    for s in SURFACES:
        exp = spec.get(s, {})
        b, a = before.get(s, {}), after.get(s, {})
        if exp is ANY:
            cells.append((action, s, "green", "any (informational)", b, a, []))
            continue
        bad = []
        for k in sorted(set(b) | set(a)):
            lbl, fn = exp.get(k, ("unchanged", lambda x, y, _c: x == y))
            try:
                ok = fn(b.get(k), a.get(k), c)
            except Exception as e:  # noqa: BLE001
                ok, lbl = False, f"{lbl} ({e})"
            if not ok:
                bad.append(f"{k}: expected {lbl}, before {b.get(k)!r} → after {a.get(k)!r}")
        touched = [k for k in exp if b.get(k) != a.get(k)]
        cells.append((action, s, "red" if bad else "green", ", ".join(touched) or "unchanged", b, a, bad))
    return cells


BOOKING_SCOPED = ("booking_page", "ledger", "bills_raised", "received", "pdfs", "documents", "journey")


def _read(api, c, k):
    """Booking-scoped surfaces read as empty while the subject has no booking (create booking's "before", flat actions)."""
    if (k in BOOKING_SCOPED and not c.get("bid")) or (k == "customer_360" and not c.get("cid")):
        return {}
    return SURFACES[k](api, c)


def _settled(api, c, cap_s=30.0):
    """Baseline = the setup's own effects fully landed (read models + after-commit work): two equal reads in a row."""
    t0, prev = time.monotonic(), None
    # the setup's queued after-commit work (e.g. 30 flat-price snapshots of the matrix tower) must land before the act:
    # otherwise the act's own auto letters wait behind it and miss the act's 5 s freshness window (REQ-70)
    api.post("/admin/ops/after-commit/drain")
    while True:
        cur = {k: _read(api, c, k) for k in SURFACES}
        if cur == prev or time.monotonic() - t0 > cap_s:
            return cur
        prev = cur
        time.sleep(3.5)  # debounce (2 s) + one flush (~1 s) + margin, so "equal twice" means settled


def run_action(api, w, name, setup, act, spec):
    c = setup(w)
    c.setdefault("bid", None)
    c["_api"] = api
    before = _settled(api, c)
    try:
        act(w, c)
        t0 = time.monotonic()
        after = {k: _read(api, c, k) for k in SURFACES if k not in READ_MODELS}

        import threading
        from concurrent.futures import ThreadPoolExecutor

        lock = threading.Lock()

        def poll(k):  # REQ-70: each read model polled on its own; only reads that start ≤ 5 s after the act count
            v = None
            while v is None or time.monotonic() - t0 <= FRESH_S:
                v = _read(api, c, k)
                with lock:  # _check stashes helpers on c; a surface's cells are judged at its own read time
                    mine = [x for x in _check(name, spec, before, after | {k: v}, c) if x[1] == k]
                if all(x[2] == "green" for x in mine):
                    break
                time.sleep(0.25)
            return k, mine

        with lock:
            direct = [x for x in _check(name, spec, before, after, c) if x[1] not in READ_MODELS]
        with ThreadPoolExecutor(max_workers=len(READ_MODELS)) as ex:
            polled = dict(ex.map(poll, READ_MODELS))
        by = {}
        for x in direct + [x for cs in polled.values() for x in cs]:
            by.setdefault(x[1], []).append(x)
        return [x for s_ in SURFACES for x in by.get(s_, [])]
    finally:
        if c.get("restore"):
            c["restore"]()


REMAINING_ANY: dict[str, list[str]] = {}


def run(base: str, headers: dict, only: list[str] | None = None):
    api = Api(base, headers)
    w = World(api)
    cells = []
    try:
        for name, (setup, act, spec) in ACTIONS.items():
            if only and name not in only:
                continue
            spec, left = tighten(name, spec)
            REMAINING_ANY[name] = left
            cells += run_action(api, w, name, setup, act, spec)
    finally:  # the matrix's own Own-* tower + its lineage: left behind, towers pile up in SGH and slow every surface
        # not inside pytest: a purge sweeps every Own-* tower, incl. the ones parallel tests are still using
        if not os.environ.get("PYTEST_CURRENT_TEST"):
            try:
                bid = w.flats[0]["block_id"]
                api.post("/admin/hard-purge", {"dry_run": False, "confirm": "HARD-PURGE", "block_ids": [bid]})
            except AssertionError as e:  # another test-named lineage blocks the purge: leave the tower
                print("matrix tower not purged:", str(e)[:160])
    return cells


def report(cells) -> str:
    actions = list(dict.fromkeys(c[0] for c in cells))
    reds = [c for c in cells if c[2] == "red"]
    out = [
        "# Connection matrix (F-42, REQ-67…73)",
        "",
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} on the private test copy · "
        f"{len(actions)} actions × {len(SURFACES)} surfaces = {len(cells)} cells · "
        f"**{len(cells) - len(reds)} green, {len(reds)} red**",
        "",
        "Direct reads checked immediately; read models / after-commit surfaces within 5 s. Unlisted metrics must be unchanged.",
        "",
        "| action | " + " | ".join(SURFACES) + " |",
        "|---|" + "---|" * len(SURFACES),
    ]
    for a in actions:
        row = {c[1]: c for c in cells if c[0] == a}
        out.append(f"| {a} | " + " | ".join(("🟢" if row[s][2] == "green" else "🔴") for s in SURFACES) + " |")
    left = [f"{a}: {', '.join(v)}" for a, v in REMAINING_ANY.items() if v]
    out += ["", f'Informational ("any") metrics remaining: {sum(len(v) for v in REMAINING_ANY.values())}', ""]
    out += [f"- {x}" for x in left]
    out += ["", "## Cells (before → after)", ""]
    for a in actions:
        out.append(f"### {a}")
        for c in (c for c in cells if c[0] == a):
            vals = {k: (c[4].get(k), c[5].get(k)) for k in sorted(set(c[4]) | set(c[5])) if c[4].get(k) != c[5].get(k)}
            ch = "; ".join(
                f"{k} {json.dumps(x[0], default=str)} → {json.dumps(x[1], default=str)}" for k, x in vals.items()
            )
            out.append(
                f"- {'🟢' if c[2] == 'green' else '🔴'} **{c[1]}** — {ch or 'unchanged'}"
                + (f" · FAIL: {'; '.join(c[6])}" if c[6] else "")
            )
        out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--out", default="/app/memory/qa/phase2/connection_matrix.md")
    ap.add_argument("--only", action="append")
    a = ap.parse_args()
    tok = requests.post(f"{a.base}/api/auth/login", json={"email": a.email, "password": a.password}, timeout=30).json()
    cells = run(a.base, {"Authorization": f"Bearer {tok['access_token']}"}, a.only)
    open(a.out, "w").write(report(cells))
    reds = [c for c in cells if c[2] == "red"]
    print(f"{len(cells)} cells, {len(reds)} red")
    for c in reds:
        print("RED", c[0], c[1], c[6])


if __name__ == "__main__":
    main()
