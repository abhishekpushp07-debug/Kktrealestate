import asyncio
"""Customer-facing PDFs for the ERP (receipt, demand letter, statement, allotment). Portal routes call the same builders → identical bytes."""
from fastapi import APIRouter, Depends

from db import db
from deps import require
from routers.bookings import demand_letter
from routers.payments import receipt
from services import pdf as _pdf

router = APIRouter(tags=["pdf"])


def _addr(a):
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


async def _record_verification(code: str, doc_type: str, entity_id: str, number: str, date: str):
    await db.doc_verifications.update_one({"code": code}, {"$set": {"code": code, "doc_type": doc_type, "entity_id": entity_id, "number": number, "date": date}}, upsert=True)


async def build_receipt_pdf(payment_id: str, user: dict) -> tuple[bytes, str]:
    j = await receipt(payment_id, user)
    p, b, c, co = j["payment"], j["booking"] or {}, j["customer"] or {}, j["company"] or {}
    code = _pdf.verify_code("receipt", p["id"])
    await _record_verification(code, "receipt", p["id"], p["receipt_number"], p["payment_date"])
    d = _pdf.BrandedDoc("Payment Receipt", co, number=p["receipt_number"], date=p["payment_date"], verify=code, subtitle=f"Booking {b.get('booking_number', '')}")
    if j.get("cancelled"):
        d.p("<font color='#B91C1C'><b>CANCELLED / REVERSED</b></font>")
    fs = b.get("flat_snapshot") or {}
    d.kv([("Received from", f"{c.get('salutation') or ''} {c.get('full_name', '')}".strip()), ("Customer code", c.get("customer_code")),
          ("Booking", b.get("booking_number")), ("Unit", f"{b.get('project_name', '')} · {b.get('block_name', '')} · {fs.get('flat_number', '')}"), ("Address", _addr(c.get("address_current"))), ("Phone", c.get("phone"))])
    d.h2("Payment details")
    inst = p.get("instrument") or {}
    d.table(["Towards", "Mode", "Instrument", "Bank", "Status", "Amount"], [[("Other charges: " + p["other_charge_name"]) if p.get("other_charge_name") else f"Flat value ({p.get('payment_category')})", p.get("payment_mode_name"), " ".join(filter(None, [inst.get("number"), _pdf.fmt_date(inst.get("date")) if inst.get("date") else None])) or "-", inst.get("bank_name") or p.get("bank_account_name") or "-", p["status"], _pdf.inr(p["amount_paise"])]], widths=[1.6, 1, 1.2, 1.2, 0.8, 1.2], align_right=[5],
            totals=["Amount received", "", "", "", "", _pdf.inr(p["amount_paise"])])
    d.spacer(1.5)
    d.p(f"<b>Amount in words:</b> {j['amount_in_words']}")
    if j.get("after"):
        a = j["after"]
        d.h2("Account position after this receipt")
        d.table(["Cash paid (cum)", "Account paid (cum)", "Cash due", "Account due", "Total due", "Charges due"], [[_pdf.inr(a["cash_paid_cum_paise"]), _pdf.inr(a["account_paid_cum_paise"]), _pdf.inr(a["cash_due_paise"]), _pdf.inr(a["account_due_paise"]), _pdf.inr(a["total_due_paise"]), _pdf.inr(a.get("other_charges_due_paise", 0))]], align_right=list(range(6)))
    if j.get("subject_to_realisation"):
        d.small("Cheque / DD receipts are subject to realisation.")
    d.small(f"Received by {p.get('received_by_name') or '-'}. Remarks: {p.get('remarks') or '-'}")
    d.signature(co.get("authorised_signatory_name") or "")
    return await asyncio.to_thread(d.build), f"receipt-{p['receipt_number'].replace('/', '-')}.pdf"


async def build_demand_pdf(booking_id: str, demand_id: str, user: dict) -> tuple[bytes, str]:
    j = await demand_letter(booking_id, demand_id, user)
    dm, b, c, co, bank = j["demand"], j["booking"], j["customer"] or {}, j["company"] or {}, j.get("bank") or {}
    code = _pdf.verify_code("demand", dm["id"])
    await _record_verification(code, "demand", dm["id"], dm["demand_number"], dm["demand_date"])
    d = _pdf.BrandedDoc("Demand Letter", co, number=dm["demand_number"], date=dm["demand_date"], verify=code, subtitle=f"Booking {b['booking_number']} · due {_pdf.fmt_date(dm['due_date'])}")
    fs = b.get("flat_snapshot") or {}
    d.p(f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}<br/>Phone: {c.get('phone') or '-'}")
    d.spacer(3)
    d.p(f"<b>Subject: Payment demand on completion of milestone “{dm['milestone_name']}” ({dm['cumulative_percent']}%) — Unit {fs.get('flat_number')}, {b.get('block_name')}, {b.get('project_name')}</b>")
    d.spacer(2)
    d.p(f"Dear Sir/Madam,<br/><br/>We are pleased to inform you that the construction milestone <b>{dm['milestone_name']}</b> has been completed. As per the payment schedule of your Booking No. <b>{b['booking_number']}</b>, the following amount is now due and payable on or before <b>{_pdf.fmt_date(dm['due_date'])}</b>.")
    d.h2("Demand")
    d.table(["Component", "Amount", "In words"], [["Cash component", _pdf.inr(dm["cash_demand_paise"]), j.get("cash_in_words", "")], ["Account component", _pdf.inr(dm["account_demand_paise"]), j.get("account_in_words", "")]], widths=[1.2, 1, 3], align_right=[1])
    d.totals([("Cash", _pdf.inr(dm["cash_demand_paise"])), ("Account", _pdf.inr(dm["account_demand_paise"])), ("Total due", _pdf.inr(dm["total_demand_paise"]))])
    d.p(f"<b>Amount in words:</b> {j['amount_in_words']}")
    if bank:
        d.h2("Bank details for account payments")
        d.kv([("Bank", bank.get("bank_name")), ("Account name", bank.get("account_name")), ("Account no.", bank.get("account_number")), ("IFSC", bank.get("ifsc")), ("Branch", bank.get("branch"))])
    d.spacer(2)
    d.p("Kindly arrange the payment within the due date to avoid interest on delayed payment as per the Agreement for Sale. Please ignore this letter if payment has already been made.", _pdf.SMALL)
    d.signature(co.get("authorised_signatory_name") or "")
    return await asyncio.to_thread(d.build), f"demand-{dm['demand_number'].replace('/', '-')}.pdf"


@router.get("/payments/{payment_id}/receipt.pdf")
async def receipt_pdf(payment_id: str, download: int = 0, user: dict = Depends(require("finance.receipt.download"))):
    content, name = await build_receipt_pdf(payment_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/demands/{demand_id}/letter.pdf")
async def demand_letter_pdf(booking_id: str, demand_id: str, download: int = 0, user: dict = Depends(require("finance.demand.export"))):
    content, name = await build_demand_pdf(booking_id, demand_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/statement.pdf")
async def statement_pdf(booking_id: str, download: int = 0, user: dict = Depends(require("finance.ledger.export"))):
    from routers.reports import build_statement_pdf
    content, name = await build_statement_pdf(booking_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/allotment.pdf")
async def allotment_pdf(booking_id: str, download: int = 0, user: dict = Depends(require("sales.booking.export"))):
    from routers.reports import build_allotment_pdf
    content, name = await build_allotment_pdf(booking_id, user)
    return _pdf.pdf_response(content, name, bool(download))
