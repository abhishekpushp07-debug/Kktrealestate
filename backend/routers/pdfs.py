"""PDF variants of receipt and demand letter (reuse the JSON builders)."""
from fastapi import APIRouter, Depends, Response

from deps import require
from routers.bookings import demand_letter
from routers.payments import receipt
from services.pdf import SMALL, BrandedDoc, fmt_date, inr

router = APIRouter(tags=["pdf"])


def _addr(a):
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


@router.get("/payments/{payment_id}/receipt.pdf")
async def receipt_pdf(payment_id: str, user: dict = Depends(require("receipt.print"))):
    j = await receipt(payment_id, user)
    p, b, c, co = j["payment"], j["booking"] or {}, j["customer"] or {}, j["company"] or {}
    d = BrandedDoc("Payment Receipt", co, subtitle=f"Receipt {p['receipt_number']} · {fmt_date(p['payment_date'])}")
    if j.get("cancelled"):
        d.p("<font color='#B91C1C'><b>CANCELLED / REVERSED</b></font>")
    fs = b.get("flat_snapshot") or {}
    d.kv([("Receipt no.", p["receipt_number"]), ("Date", fmt_date(p["payment_date"])), ("Received from", f"{c.get('salutation') or ''} {c.get('full_name', '')}".strip()), ("Customer code", c.get("customer_code")),
          ("Booking", b.get("booking_number")), ("Unit", f"{b.get('project_name', '')} · {b.get('block_name', '')} · {fs.get('flat_number', '')}"), ("Address", _addr(c.get("address_current"))), ("Phone", c.get("phone"))])
    d.h2("Payment details")
    inst = p.get("instrument") or {}
    d.table(["Towards", "Mode", "Instrument", "Bank", "Status", "Amount"], [[("Other charges: " + p["other_charge_name"]) if p.get("other_charge_name") else f"Flat value ({p.get('payment_category')})", p.get("payment_mode_name"), " ".join(filter(None, [inst.get("number"), fmt_date(inst.get("date")) if inst.get("date") else None])) or "-", inst.get("bank_name") or p.get("bank_account_name") or "-", p["status"], inr(p["amount_paise"])]], widths=[1.6, 1, 1.2, 1.2, 0.8, 1.2], align_right=[5])
    d.spacer(2)
    d.p(f"<b>Amount in words:</b> {j['amount_in_words']}")
    if j.get("after"):
        a = j["after"]
        d.h2("Account position after this receipt")
        d.table(["Cash paid (cum)", "Account paid (cum)", "Cash due", "Account due", "Total due", "Charges due"], [[inr(a["cash_paid_cum_paise"]), inr(a["account_paid_cum_paise"]), inr(a["cash_due_paise"]), inr(a["account_due_paise"]), inr(a["total_due_paise"]), inr(a.get("other_charges_due_paise", 0))]], align_right=list(range(6)))
    if j.get("subject_to_realisation"):
        d.small("Cheque / DD receipts are subject to realisation.")
    d.small(f"Received by {p.get('received_by_name') or '-'}. Remarks: {p.get('remarks') or '-'}")
    d.signature(co.get("authorised_signatory_name") or "")
    return Response(content=d.build(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="receipt-{p["receipt_number"].replace("/", "-")}.pdf"'})


@router.get("/bookings/{booking_id}/demands/{demand_id}/letter.pdf")
async def demand_letter_pdf(booking_id: str, demand_id: str, user: dict = Depends(require("booking.read"))):
    j = await demand_letter(booking_id, demand_id, user)
    dm, b, c, co, bank = j["demand"], j["booking"], j["customer"] or {}, j["company"] or {}, j.get("bank") or {}
    d = BrandedDoc("Demand Letter", co, subtitle=f"{dm['demand_number']} · {fmt_date(dm['demand_date'])}")
    fs = b.get("flat_snapshot") or {}
    d.p(f"To,<br/><b>{c.get('salutation') or ''} {c.get('full_name', '')}</b><br/>{_addr(c.get('address_current'))}<br/>Phone: {c.get('phone') or '-'}")
    d.spacer(3)
    d.p(f"<b>Subject: Payment demand on completion of milestone “{dm['milestone_name']}” ({dm['cumulative_percent']}%) — Unit {fs.get('flat_number')}, {b.get('block_name')}, {b.get('project_name')}</b>")
    d.spacer(2)
    d.p(f"Dear Sir/Madam,<br/><br/>We are pleased to inform you that the construction milestone <b>{dm['milestone_name']}</b> has been completed. As per the payment schedule of your Booking No. <b>{b['booking_number']}</b>, the following amount is now due and payable on or before <b>{fmt_date(dm['due_date'])}</b>.")
    d.h2("Demand")
    d.table(["Component", "Amount", "In words"], [["Cash component", inr(dm["cash_demand_paise"]), j.get("cash_in_words", "")], ["Account component", inr(dm["account_demand_paise"]), j.get("account_in_words", "")]], widths=[1.2, 1, 3], align_right=[1], totals=["Total due", inr(dm["total_demand_paise"]), j["amount_in_words"]])
    if bank:
        d.h2("Bank details for account payments")
        d.kv([("Bank", bank.get("bank_name")), ("Account name", bank.get("account_name")), ("Account no.", bank.get("account_number")), ("IFSC", bank.get("ifsc")), ("Branch", bank.get("branch"))])
    d.spacer(2)
    d.p("Kindly arrange the payment within the due date to avoid interest on delayed payment as per the Agreement for Sale. Please ignore this letter if payment has already been made.", SMALL)
    d.signature(co.get("authorised_signatory_name") or "")
    return Response(content=d.build(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="demand-{dm["demand_number"]}.pdf"'})
