"""REQ-243…256 waiver routes: request (pending, no money) → approve (Jama credit + CN number) / reject (reason, notify)
→ cancel approved (owner only, exact reverse rows, number kept). Plus credit-note PDF and the Waiver Register."""

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from db import db
from deps import ensure_project_access, report_scope_filter, require
from services import clock
from services import pdf as _pdf
from services import waivers as W
from services.ledger import rebuild
from services.money import present_money, to_paise
from services.notify import notify_roles, notify_users
from utils import ApiError, StrictModel, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(prefix="/waivers", tags=["waivers"])
reports_router = APIRouter(prefix="/reports", tags=["reports"])


class TargetIn(StrictModel):
    kind: str = Field(pattern="^(share|line)$")
    share: str | None = Field(default=None, pattern="^(Cash|Account)$")
    line_id: str | None = None


class WaiverIn(StrictModel):
    booking_id: str
    target: TargetIn
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=200)
    note: str | None = Field(default=None, max_length=500)


class ReasonIn(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


def _is_owner(user: dict) -> bool:
    return user.get("role_name") == "Super Admin"


def _label(b: dict, t: dict) -> str:
    if t["kind"] == "share":
        return f"{t['share']} share"
    line = next((x for x in b.get("other_charges") or [] if x["line_id"] == t["line_id"]), None)
    return line["name"] if line else "Other charge"


async def _company(user: dict) -> dict:
    return await db.companies.find_one({"id": user["company_id"]}, {"_id": 0}) or {}


async def _approve(w: dict, b: dict, user: dict, request: Request, self_approved: bool = False) -> dict:
    target = w["target"]
    open_now = W.open_of(b, target)
    if w["amount_paise"] > open_now:
        raise ApiError(
            409,
            f"Only ₹{open_now / 100:,.2f} is open on the {w['target_label']} today — reject and request again",
            "WAIVER_OVER_OPEN",
        )
    entries, gst_note = W.entries_for(b, target, w["amount_paise"])
    before = {d["id"]: d.get("paid_paise") or 0 async for d in db.demands.find({"booking_id": b["id"]}, {"_id": 0})}
    company = await _company(user)
    ts = now_iso()
    upd = {
        "status": "Approved",
        "approved_at": ts,
        "approved_on": clock.today().isoformat(),
        "approved_by": user["id"],
        "approved_by_name": user["name"],
        "self_approved": self_approved,
        "cn_number": await W.credit_note_number(company),
        "entries": entries,
        "gst_note": gst_note,
    }
    res = await db.waivers.update_one(
        {"id": w["id"], "status": "Pending"},
        {
            "$set": upd,
            "$push": {
                "history": {"at": ts, "by": user["name"], "action": "self-approved" if self_approved else "approved"}
            },
        },
    )
    if not res.modified_count:  # 3G: decided by someone else meanwhile — nothing else is written
        cur = await db.waivers.find_one({"id": w["id"]}, {"_id": 0, "status": 1})
        raise ApiError(
            409,
            "Already approved" if (cur or {}).get("status") == "Approved" else f"Waiver is {(cur or {}).get('status')}",
            "WAIVER_STATE",
        )
    await rebuild(b["id"])
    settles = await W.settled_bills(b["id"], before) if target["kind"] == "share" else []
    w = {**w, **upd, "settles": settles}
    s34 = W.section34(b, w, company)
    await db.waivers.update_one({"id": w["id"]}, {"$set": {"settles": settles, "section34": s34}})
    await write_audit(
        user,
        "waiver.self_approve" if self_approved else "waiver.approve",
        "booking",
        b["id"],
        after={
            "waiver_number": w["waiver_number"],
            "cn_number": upd["cn_number"],
            "amount_paise": w["amount_paise"],
            "entries": entries,
            "settles": settles,
        },
        ip=client_ip(request),
    )
    if not self_approved:
        await notify_users(
            user["company_id"],
            [w["requested_by"]],
            f"Waiver {w['waiver_number']} approved",
            f"{upd['cn_number']} · ₹{w['amount_paise'] / 100:,.0f} on {b['booking_number']}",
            "waiver",
            "booking",
            b["id"],
            f"/bookings/{b['id']}?tab=bills",
        )
    return await db.waivers.find_one({"id": w["id"]}, {"_id": 0})


@router.post("", status_code=201)
async def request_waiver(body: WaiverIn, request: Request, user: dict = Depends(require("finance.waiver.request"))):
    b = await get_or_404(db.bookings, body.booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    t = body.target.model_dump()
    if (t["kind"] == "share") != bool(t.get("share")) or (t["kind"] == "line") != bool(t.get("line_id")):
        raise ApiError(422, "Pick the Cash share, the Account share or one charge line", "VALIDATION_ERROR")
    t["label"] = _label(b, t)
    amt, open_now = to_paise(body.amount), W.open_of(b, t)
    if amt > open_now:
        raise ApiError(422, f"Only ₹{open_now / 100:,.2f} is open on the {t['label']}", "VALIDATION_ERROR")
    w = W.new_request(b, t, amt, body.reason.strip(), body.note, user, await W.next_waiver_number(await _company(user)))
    await db.waivers.insert_one(w)
    w.pop("_id", None)
    await write_audit(
        user,
        "waiver.request",
        "booking",
        b["id"],
        after={k: w[k] for k in ("waiver_number", "amount_paise", "target", "reason")},
        ip=client_ip(request),
    )
    if _is_owner(user):  # REQ-251: the owner's own request is approved at once and audited as self-approved
        return present_money(await _approve(w, b, user, request, self_approved=True))
    await notify_roles(
        user["company_id"],
        ["Super Admin"],
        f"Waiver to approve · {w['waiver_number']}",
        f"₹{amt / 100:,.0f} on {b['booking_number']} ({t['label']}) · {w['reason']}",
        "waiver",
        "booking",
        b["id"],
        "/reports/waiver-register?status=Pending",
        exclude={user["id"]},
    )
    return present_money(w)


@router.get("")
async def list_waivers(
    booking_id: str | None = None, status: str | None = None, user: dict = Depends(require("finance.waiver.view"))
):
    q = {"company_id": user["company_id"], **report_scope_filter(user)}
    if booking_id:
        q["booking_id"] = booking_id
    if status:
        q["status"] = status
    items = await db.waivers.find(q, {"_id": 0, "history": 0}).sort("requested_at", -1).to_list(500)
    return present_money({"items": items, "total": len(items)})


@router.post("/{waiver_id}/approve")
async def approve_waiver(waiver_id: str, request: Request, user: dict = Depends(require("finance.waiver.approve"))):
    from services.booking_lock import booking_lock

    w = await get_or_404(db.waivers, waiver_id, "Waiver", {"company_id": user["company_id"]})
    async with booking_lock(w["booking_id"]):  # 3G: a second approver waits, then reads "Already approved"
        return await _approve_locked(waiver_id, request, user)


async def _approve_locked(waiver_id: str, request: Request, user: dict):
    w = await get_or_404(db.waivers, waiver_id, "Waiver", {"company_id": user["company_id"]})
    if w["status"] == "Approved":
        raise ApiError(409, "Already approved", "WAIVER_STATE")
    if w["status"] != "Pending":
        raise ApiError(409, f"Waiver is {w['status']}", "WAIVER_STATE")
    if w["requested_by"] == user["id"] and not _is_owner(user):
        raise ApiError(403, "You cannot approve your own waiver request", "SELF_APPROVAL")
    b = await db.bookings.find_one({"id": w["booking_id"]}, {"_id": 0})
    if b["status"] != "Active":
        raise ApiError(409, f"Booking is {b['status']}", "BOOKING_NOT_ACTIVE")
    return present_money(await _approve(w, b, user, request, self_approved=w["requested_by"] == user["id"]))


@router.post("/{waiver_id}/reject")
async def reject_waiver(
    waiver_id: str, body: ReasonIn, request: Request, user: dict = Depends(require("finance.waiver.approve"))
):
    w = await get_or_404(db.waivers, waiver_id, "Waiver", {"company_id": user["company_id"]})
    if w["status"] != "Pending":
        raise ApiError(409, f"Waiver is {w['status']}", "WAIVER_STATE")
    ts = now_iso()
    res = await db.waivers.update_one(
        {"id": waiver_id, "status": "Pending"},  # 3G: never overwrite an approval that landed meanwhile
        {
            "$set": {
                "status": "Rejected",
                "rejected_at": ts,
                "rejected_by_name": user["name"],
                "reject_reason": body.reason,
            },
            "$push": {"history": {"at": ts, "by": user["name"], "action": "rejected", "reason": body.reason}},
        },
    )
    if not res.modified_count:
        cur = await db.waivers.find_one({"id": waiver_id}, {"_id": 0, "status": 1})
        raise ApiError(409, f"Waiver is {(cur or {}).get('status')}", "WAIVER_STATE")
    await write_audit(
        user,
        "waiver.reject",
        "booking",
        w["booking_id"],
        after={"waiver_number": w["waiver_number"], "reason": body.reason},
        ip=client_ip(request),
    )
    await notify_users(
        user["company_id"],
        [w["requested_by"]],
        f"Waiver {w['waiver_number']} rejected",
        body.reason,
        "waiver",
        "booking",
        w["booking_id"],
        f"/bookings/{w['booking_id']}?tab=bills",
    )
    return present_money(await db.waivers.find_one({"id": waiver_id}, {"_id": 0}))


@router.post("/{waiver_id}/cancel")
async def cancel_waiver(
    waiver_id: str, body: ReasonIn, request: Request, user: dict = Depends(require("finance.waiver.cancel"))
):
    """REQ-252: owner only; posts exact reversing rows on today's date; WV / CN numbers are kept, marked Cancelled."""
    if not _is_owner(user):
        raise ApiError(403, "Only the owner can cancel an approved waiver", "FORBIDDEN")
    w = await get_or_404(db.waivers, waiver_id, "Waiver", {"company_id": user["company_id"]})
    if w["status"] != "Approved":
        raise ApiError(409, f"Waiver is {w['status']}", "WAIVER_STATE")
    ts = now_iso()
    res = await db.waivers.update_one(
        {"id": waiver_id, "status": "Approved"},
        {
            "$set": {
                "status": "Cancelled",
                "cancelled_at": ts,
                "cancelled_by_name": user["name"],
                "cancel_reason": body.reason,
            },
            "$push": {"history": {"at": ts, "by": user["name"], "action": "cancelled", "reason": body.reason}},
        },
    )
    if not res.modified_count:
        raise ApiError(409, "Already cancelled", "WAIVER_STATE")
    await rebuild(w["booking_id"])
    await write_audit(
        user,
        "waiver.cancel",
        "booking",
        w["booking_id"],
        after={"waiver_number": w["waiver_number"], "cn_number": w["cn_number"], "reason": body.reason},
        ip=client_ip(request),
    )
    return present_money(await db.waivers.find_one({"id": waiver_id}, {"_id": 0}))


def _r(p: int) -> str:
    return f"₹{p / 100:,.2f}"


@router.get("/{waiver_id}/credit-note.pdf")
async def credit_note_pdf(waiver_id: str, user: dict = Depends(require("finance.waiver.view"))):
    w = await get_or_404(db.waivers, waiver_id, "Waiver", {"company_id": user["company_id"]})
    if not w.get("cn_number"):
        raise ApiError(409, "A credit note exists only for an approved waiver", "WAIVER_STATE")
    b = await db.bookings.find_one({"id": w["booking_id"]}, {"_id": 0})
    d = _pdf.BrandedDoc(
        "Credit Note", await _company(user), number=w["cn_number"], date=_pdf.fmt_date(w["approved_on"])
    )
    if w["status"] == "Cancelled":
        d.h2(f"CANCELLED on {_pdf.fmt_date(clock.day_of(w['cancelled_at']))} · {w.get('cancel_reason')}")
    d.kv(
        [
            ("Customer", b.get("customer_name") or ""),
            ("Booking", b["booking_number"]),
            ("Unit", f"{(b.get('flat_snapshot') or {}).get('flat_number', '')}"),
            ("Waiver request", w["waiver_number"]),
            ("Against", w["target_label"]),
            ("Reason", w["reason"]),
            ("Approved by", w.get("approved_by_name") or ""),
            ("GST", (w.get("section34") or {}).get("text", "")),
        ]
    )
    rows = [[s["demand_number"], _pdf.fmt_date(s["bill_day"]), _r(s["amount_paise"])] for s in w.get("settles") or []]
    if rows:
        d.table(["Bill settled", "Bill date", "Amount"], rows)
    d.totals(
        [
            ("Waiver credit", _r(w["amount_paise"])),
            *([("GST", w["gst_note"]["text"])] if w.get("gst_note") else []),
            ("Total credit", _r(sum(e["amount_paise"] for e in w.get("entries") or []))),
        ]
    )
    d.small("A credit note reduces what is owed; it is not a receipt of money.")
    return Response(
        d.build(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{w["cn_number"].replace("/", "-")}.pdf"'},
    )


@reports_router.get("/waiver-register")
async def waiver_register(
    request: Request,
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    project_id: str | None = None,
    format: str | None = None,
    user: dict = Depends(require("reports.waiver_register.view")),
):
    from routers.reports import _dates, respond
    from routers.reports_i import etag_respond

    f, t = _dates(from_date, to_date)
    q = {"company_id": user["company_id"], **report_scope_filter(user), "requested_on": {"$gte": f, "$lte": t}}
    if status:
        q["status"] = status
    if project_id:
        q["project_id"] = project_id
    rows = []
    async for w in db.waivers.find(q, {"_id": 0}).sort("requested_at", 1):
        rows.append(
            {
                "waiver_number": w["waiver_number"],
                "_link": f"/bookings/{w['booking_id']}?tab=bills",
                "requested_on": w["requested_on"],
                "booking_number": w["booking_number"],
                "customer": w.get("customer_name"),
                "against": w["target_label"],
                "amount_paise": w["amount_paise"],
                "gst_paise": (w.get("gst_note") or {}).get("gst_paise", 0)
                if w["target"].get("share") == "Account"
                else 0,
                "status": w["status"] + (" (self-approved)" if w.get("self_approved") else ""),
                "cn_number": w.get("cn_number") or "—",
                "reason": w["reason"],
                "by": w["requested_by_name"],
                "decided_by": w.get("approved_by_name") or w.get("rejected_by_name") or "—",
            }
        )
    by = lambda s: sum(r["amount_paise"] for r in rows if r["status"].startswith(s))  # noqa: E731
    totals = {
        "amount_paise": sum(r["amount_paise"] for r in rows),
        "approved_paise": by("Approved"),
        "pending_paise": by("Pending"),
        "pending": sum(1 for r in rows if r["status"] == "Pending"),
        "rejected": sum(1 for r in rows if r["status"] == "Rejected"),
        "cancelled_paise": by("Cancelled"),
        "gst_paise": sum(r["gst_paise"] for r in rows if r["status"].startswith("Approved")),
    }
    cols = [
        ("waiver_number", "Waiver", "str"),
        ("requested_on", "Requested", "date"),
        ("booking_number", "Booking", "str"),
        ("customer", "Customer", "str", 1.2),
        ("against", "Against", "str"),
        ("amount_paise", "Amount", "money"),
        ("gst_paise", "GST credit", "money"),
        ("status", "Status", "str"),
        ("cn_number", "Credit note", "str"),
        ("reason", "Reason", "str", 1.4),
        ("by", "Requested by", "str"),
        ("decided_by", "Decided by", "str"),
    ]
    payload = {
        "purpose": "Every waiver request with its state. Approved = credit note that lowers what is due; pending, rejected "
        "and cancelled move no money.",
        "formula": "approved − cancelled = waived",
        "from_date": f,
        "to_date": t,
        "filters_text": f"{_pdf.fmt_date(f)} – {_pdf.fmt_date(t)}" + (f" · {status}" if status else ""),
    }
    return etag_respond(
        request,
        await respond(
            request, format, payload, "Waiver Register", await _company(user), cols, rows, totals, "waiver-register"
        ),
    )
