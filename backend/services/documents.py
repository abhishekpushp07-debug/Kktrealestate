"""Document generation core: types, build dispatch, registration/numbering, VOID stamping, auto-registration.
Layering (CR-4): no `routers.*` imports; `routers/docgen.py` exposes the HTTP surface and re-exports these names."""

import asyncio
import hashlib
import hmac
import io
import logging
import os

from pydantic import Field
from pypdf import PdfWriter

from db import db
from deps import ensure_project_access
from services import clock
from services import pdf as _pdf
from services.dues_engine import schedule
from services.pdf_builders import (
    build_allotment_pdf,
    build_cost_sheet_pdf,
    build_demand_pdf,
    build_receipt_pdf,
    build_statement_pdf,
)
from utils import ApiError, StrictModel, base_doc, now_iso, write_audit

TYPES = {
    "receipt": "Payment receipt",
    "demand": "Bill letter",
    "statement": "Statement of account",
    "allotment": "Allotment letter",
    "cost_sheet": "Cost sheet",
    "reminder": "Reminder letter",
    "schedule": "Payment schedule letter",
    "cancellation": "Cancellation / Refund letter",
}


class GenerateIn(StrictModel):
    type: str
    booking_id: str
    payment_id: str | None = None
    demand_ids: list[str] | None = None
    period_from: str | None = None
    period_to: str | None = None
    refund_id: str | None = None
    note: str | None = Field(default=None, max_length=300)
    preview: bool = False


def _addr(a):
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


async def _ctx(booking_id: str, user: dict):
    b = await db.bookings.find_one({"id": booking_id, "company_id": user["company_id"]}, {"_id": 0})
    if not b:
        raise ApiError(404, "Booking not found", "NOT_FOUND")
    ensure_project_access(user, b["project_id"])
    c, co = await asyncio.gather(
        db.customers.find_one({"id": b["customer_id"]}, {"_id": 0}),
        _pdf.company_for_pdf(user["company_id"], {"_id": 0}),
    )
    return b, c or {}, co or {}


async def build_reminder_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, c, co = await _ctx(booking_id, user)
    today = clock.today_iso()
    dems = (
        await db.demands.find(
            {
                "booking_id": booking_id,
                "voided": {"$ne": True},
                "status": {"$in": ["Open", "Partially Paid"]},
                "due_date": {"$lt": today},
            },
            {"_id": 0},
        )
        .sort("due_date", 1)
        .to_list(None)
    )
    policy = co.get("interest_policy") or {}
    d = _pdf.BrandedDoc(
        "Payment Reminder",
        co,
        number=f"RM-{b['booking_number']}",
        date=today,
        subtitle=f"Booking {b['booking_number']}",
    )
    fs = b.get("flat_snapshot") or {}
    d.p(
        (
            f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}<br/>Phone: "
            f"{c.get('phone') or '-'}"
        )
    )
    d.spacer(3)
    d.p(
        f"<b>Subject: Reminder — overdue payment(s) for Unit {fs.get('flat_number')}, {b.get('block_name')}, {b.get('project_name')}</b>"
    )
    d.spacer(2)
    if not dems:
        d.p("Our records show no overdue bill on this booking as of today. Please treat this letter as informational.")
    else:
        d.p(
            (
                f"Dear Sir/Madam,<br/><br/>Our records show the following bill(s) on Booking No. <b>{b['booking_number']}</b> remain unpaid "
                f"beyond their "
                f"due date. "
                f"Kindly arrange "
                f"payment at the "
                f"earliest."
            )
        )
        rows, tot = [], 0
        for x in dems:
            bal = x["total_demand_paise"] - (x.get("paid_paise") or 0)
            tot += bal
            days = (
                __import__("datetime").date.fromisoformat(today)
                - __import__("datetime").date.fromisoformat(x["due_date"])
            ).days
            rows.append(
                [
                    x["demand_number"],
                    x.get("installment_name") or x.get("milestone_name") or "-",
                    _pdf.fmt_date(x["due_date"]),
                    str(days),
                    _pdf.inr(x["total_demand_paise"]),
                    _pdf.inr(bal),
                ]
            )
        d.h2("Overdue demands")
        d.table(
            ["Bill", "Instalment", "Due on", "Days", "Billed", "Balance"],
            rows,
            widths=[1.2, 1.6, 1, 0.6, 1.1, 1.1],
            align_right=[3, 4, 5],
            totals=["Total overdue", "", "", "", "", _pdf.inr(tot)],
        )
        if policy.get("rate_percent_pa"):
            d.small(
                f"Interest on delayed payment as per Agreement for Sale: {policy['rate_percent_pa']}% p.a. from the due date until realisation."
            )
    d.signature(
        co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory"
    )
    return await asyncio.to_thread(d.build), f"reminder-{b['booking_number'].replace('/', '-')}.pdf"


async def build_schedule_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, c, co = await _ctx(booking_id, user)
    block = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0}) or {}
    dems = await db.demands.find({"booking_id": booking_id}, {"_id": 0}).to_list(None)
    rows = schedule(b, block, dems)
    d = _pdf.BrandedDoc(
        "Payment Schedule",
        co,
        number=b["booking_number"],
        date=clock.today_iso(),
        subtitle=(b.get("payment_plan_snapshot") or {}).get("name") or "Payment plan",
    )
    d.kv(
        [
            ("Customer", c.get("full_name")),
            (
                "Unit",
                f"{b.get('project_name', '')} · {b.get('block_name', '')} · {(b.get('flat_snapshot') or {}).get('flat_number', '')}",
            ),
            ("Agreement value", _pdf.inr(b.get("agreement_value_paise") or 0)),
            ("Plan", (b.get("payment_plan_snapshot") or {}).get("name")),
        ]
    )
    d.h2("Installments")
    d.table(
        ["#", "Installment", "Trigger", "%", "Amount", "Expected", "Status"],
        [
            [
                str(r["seq"]),
                r["name"],
                r.get("trigger_label") or "-",
                f"{r['percent']}%",
                _pdf.inr(r.get("total_paise") or 0),
                _pdf.fmt_date(r["expected_date"]) if r.get("expected_date") else "-",
                r["status"],
            ]
            for r in rows
        ],
        widths=[0.4, 1.6, 1.6, 0.6, 1.2, 1, 1],
        align_right=[3, 4],
    )
    d.signature(
        co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory"
    )
    return await asyncio.to_thread(d.build), f"schedule-{b['booking_number'].replace('/', '-')}.pdf"


async def build_cancellation_pdf(booking_id: str, refund_id: str | None, user: dict) -> tuple[bytes, str]:
    b, c, co = await _ctx(booking_id, user)
    q = {"booking_id": booking_id, **({"id": refund_id} if refund_id else {})}
    r = await db.refunds.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    if not r:
        raise ApiError(404, "No refund record for this booking — process the cancellation first", "NOT_FOUND")
    d = _pdf.BrandedDoc(
        "Cancellation & Refund",
        co,
        number=r.get("refund_number") or b["booking_number"],
        date=clock.day_of(r.get("created_at")) or clock.today_iso(),
        subtitle=f"Booking {b['booking_number']}",
    )
    d.p(f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}")
    d.spacer(2)
    d.p(
        (
            f"This is to confirm that Booking No. <b>{b['booking_number']}</b> for Unit {(b.get('flat_snapshot') or {}).get('flat_number')} stands "
            f"cancelled{(' on ' + _pdf.fmt_date(clock.day_of(b['cancelled_at']))) if b.get('cancelled_at') else ''}. "
            f"The refund "
            f"position is "
            f"as under."
        )
    )
    d.h2("Refund")
    d.totals(
        [
            ("Amount received", _pdf.inr(r.get("paid_total_paise") or 0)),
            ("Cancellation charges", _pdf.inr(r.get("deduction_paise") or 0)),
            ("Refund payable", _pdf.inr(r.get("amount_paise") or 0)),
        ]
    )
    d.kv(
        [
            ("Status", r.get("status")),
            ("Mode", r.get("mode") or "-"),
            ("Reference", r.get("reference") or "-"),
            ("Reason", b.get("cancel_reason") or r.get("reason") or "-"),
        ]
    )
    d.signature(
        co.get("authorised_signatory_name") or "", co.get("authorised_signatory_designation") or "Authorised Signatory"
    )
    return await asyncio.to_thread(d.build), f"cancellation-{b['booking_number'].replace('/', '-')}.pdf"


async def _build(body: GenerateIn, user: dict) -> tuple[bytes, str, str, str | None]:
    """→ (bytes, filename, number, entity_id)"""
    if body.type == "receipt":
        if not body.payment_id:
            raise ApiError(422, "Pick a receipt", "VALIDATION_ERROR")
        p = await db.payments.find_one(
            {"id": body.payment_id, "booking_id": body.booking_id}, {"_id": 0, "receipt_number": 1}
        )
        if not p:
            raise ApiError(404, "Receipt not found on this booking", "NOT_FOUND")
        data, name = await build_receipt_pdf(body.payment_id, user)
        return data, name, p["receipt_number"], body.payment_id
    if body.type == "demand":
        if not body.demand_ids:
            raise ApiError(422, "Pick at least one bill", "VALIDATION_ERROR")
        parts, nums = [], []
        for did in body.demand_ids:
            dm = await db.demands.find_one({"id": did, "booking_id": body.booking_id}, {"_id": 0, "demand_number": 1})
            if not dm:
                raise ApiError(404, "Bill not found on this booking", "NOT_FOUND")
            data, _ = await build_demand_pdf(body.booking_id, did, user)
            parts.append(data)
            nums.append(dm["demand_number"])
        return (
            (parts[0] if len(parts) == 1 else _merge(parts)),
            f"demand-{nums[0].replace('/', '-')}{'-plus' if len(parts) > 1 else ''}.pdf",
            ", ".join(nums),
            body.demand_ids[0],
        )
    if body.type == "statement":
        data, name = await build_statement_pdf(body.booking_id, user)
        return data, name, f"SOA · {body.period_from or 'start'} → {body.period_to or 'today'}", None
    if body.type == "allotment":
        data, name = await build_allotment_pdf(body.booking_id, user)
        return data, name, "Allotment", None
    if body.type == "cost_sheet":
        data, name = await build_cost_sheet_pdf(body.booking_id, user)
        return data, name, "Cost sheet", None
    if body.type == "reminder":
        data, name = await build_reminder_pdf(body.booking_id, user)
        return data, name, "Reminder", None
    if body.type == "schedule":
        data, name = await build_schedule_pdf(body.booking_id, user)
        return data, name, "Schedule", None
    if body.type == "cancellation":
        data, name = await build_cancellation_pdf(body.booking_id, body.refund_id, user)
        return data, name, "Cancellation", body.refund_id
    raise ApiError(422, f"Unknown document type {body.type}", "VALIDATION_ERROR")


def _merge(parts: list[bytes]) -> bytes:
    w = PdfWriter()
    for p in parts:
        w.append(io.BytesIO(p))
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


async def generate_internal(body: GenerateIn, user: dict, ip: str = "", extra: dict | None = None) -> dict:
    """Shared by the API and the reminder job (system actor): build → register → audit."""
    b, c, co = await _ctx(body.booking_id, user)
    data, name, number, entity_id = await _build(body, user)
    doc = {
        **(extra or {}),
        **base_doc(user, user["company_id"]),
        "type": body.type,
        "type_name": TYPES[body.type],
        "number": number,
        "filename": name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "pages": None,
        "booking_id": b["id"],
        "booking_number": b["booking_number"],
        "customer_id": b["customer_id"],
        "customer_name": c.get("full_name"),
        "customer_code": c.get("customer_code"),
        "project_id": b["project_id"],
        "project_name": b.get("project_name"),
        "block_id": b.get("block_id"),
        "block_name": b.get("block_name"),
        "params": {k: v for k, v in body.model_dump().items() if k not in ("preview",) and v not in (None, [], False)},
        "generated_by": user["id"],
        "generated_by_name": user["name"],
        "generated_at": now_iso(),
        "sent": None,
        "note": body.note,
    }
    await db.generated_documents.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(
        user if user.get("id") != "system" else None,
        "document.generated",
        "generated_document",
        doc["id"],
        after={
            "type": body.type,
            "number": number,
            "booking_number": b["booking_number"],
            "customer_name": c.get("full_name"),
            "bytes": len(data),
        },
        ip=ip,
        company_id=user["company_id"],
    )
    await write_audit(
        user,
        "document.generated",
        "booking",
        b["id"],
        after={"type": body.type, "number": number, "document_id": doc["id"]},
        ip=ip,
        company_id=user["company_id"],
    )
    return doc


def _void_mark(d: dict, data: bytes) -> bytes:
    if not d.get("voided"):
        return data
    return _pdf.watermark(
        data,
        "VOID",
        f"Voided on {_pdf.fmt_date(clock.day_of(d.get('voided_at')) or '')} by {d.get('voided_by_name', '')} — {d.get('void_reason', '')}",
    )


def _sign(doc_id: str, exp: int, nonce: str) -> str:
    return hmac.new(os.environ["JWT_SECRET"].encode(), f"{doc_id}.{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()[
        :32
    ]


async def auto_register(
    booking_id: str, types: list[str], actor: dict, demand_ids: list[str] | None = None
) -> list[dict]:
    """S3.2: documents the story expects to exist without a click (allotment/cost sheet/schedule on booking, demand
    letter per bill). Best-effort, never blocks the business action.
    """
    out = []
    for t in types:
        try:
            out.append(
                await generate_internal(
                    GenerateIn(type=t, booking_id=booking_id, demand_ids=demand_ids if t == "demand" else None),
                    actor,
                    extra={"auto": True},
                )
            )
        except Exception as e:  # noqa: BLE001
            logging.getLogger("docgen").warning("auto document %s for %s failed: %s", t, booking_id, e)
    return out
