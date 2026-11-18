"""PDF data + builders for receipts, demand letters, statements, cost sheets and allotment letters.
Layering (CR-4): this module imports no `routers.*`; routers `pdfs`, `payments`, `bookings`, `reports`, `docgen` call it."""

import asyncio

from db import db
from deps import ensure_project_access
from services import pdf as _pdf
from services.money import amount_in_words, pct_of, present_money
from utils import get_or_404


async def receipt_data(payment_id: str, user: dict) -> dict:
    p = await get_or_404(db.payments, payment_id, "Payment", {"company_id": user["company_id"]})
    ensure_project_access(user, p["project_id"])
    b = await db.bookings.find_one(
        {"id": p["booking_id"]},
        {
            "_id": 0,
            "booking_number": 1,
            "status": 1,
            "flat_snapshot": 1,
            "project_name": 1,
            "block_name": 1,
            "agreement_value_paise": 1,
            "cash_agreed_paise": 1,
            "account_agreed_paise": 1,
        },
    )
    customer = await db.customers.find_one(
        {"id": p["customer_id"]},
        {"_id": 0, "full_name": 1, "salutation": 1, "address_current": 1, "phone": 1, "customer_code": 1},
    )
    from services.pdf import company_for_pdf

    company = await company_for_pdf(user["company_id"])
    row = await db.ledger_entries.find_one(
        {
            "booking_id": p["booking_id"],
            "ref": p["receipt_number"],
            "type": {"$in": ["PAYMENT", "OTHER_CHARGE_PAYMENT"]},
        },
        {"_id": 0},
        sort=[("seq", -1)],
    )
    return present_money(
        {
            "payment": p,
            "booking": b,
            "customer": customer,
            "company": company,
            "amount_in_words": amount_in_words(p["amount_paise"]),
            "after": row,
            "watermark": {"Reversed": "REVERSED", "Bounced": "BOUNCED"}.get(p["status"])
            or ("CANCELLED" if b.get("status") == "Cancelled" else None),
            "cancelled": p["status"] == "Reversed",
            "subject_to_realisation": p["status"] == "Pending" or p.get("payment_mode_code") in ("CHEQUE", "DD"),
        }
    )


async def demand_letter_data(booking_id: str, demand_id: str, user: dict) -> dict:
    from services.money import amount_in_words

    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    d = await get_or_404(db.demands, demand_id, "Demand", {"booking_id": booking_id})
    from services.pdf import company_for_pdf

    company = await company_for_pdf(user["company_id"])
    bank = await db.bank_accounts.find_one(
        {"company_id": user["company_id"], "is_default": True},
        {"_id": 0, "bank_name": 1, "account_name": 1, "ifsc": 1, "branch": 1, "account_number_enc": 1},
    )
    if bank:
        from crypto import decrypt_field

        bank["account_number"] = decrypt_field(bank.pop("account_number_enc", None))
    customer = await db.customers.find_one(
        {"id": b["customer_id"]},
        {"_id": 0, "full_name": 1, "salutation": 1, "address_current": 1, "phone": 1, "customer_code": 1},
    )
    return present_money(
        {
            "company": company,
            "bank": bank,
            "customer": customer,
            "booking": {
                k: b[k]
                for k in (
                    "booking_number",
                    "flat_snapshot",
                    "project_name",
                    "block_name",
                    "agreement_value_paise",
                    "cash_agreed_paise",
                    "account_agreed_paise",
                    "summary",
                )
            },
            "demand": d,
            "amount_in_words": amount_in_words(d["total_demand_paise"]),
            "cash_in_words": amount_in_words(d["cash_demand_paise"]),
            "account_in_words": amount_in_words(d["account_demand_paise"]),
        }
    )


def _addr(a):
    a = a or {}
    return ", ".join(filter(None, [a.get("line1"), a.get("line2"), a.get("city"), a.get("state"), a.get("pincode")]))


async def _record_verification(code: str, doc_type: str, entity_id: str, number: str, date: str):
    await db.doc_verifications.update_one(
        {"code": code},
        {"$set": {"code": code, "doc_type": doc_type, "entity_id": entity_id, "number": number, "date": date}},
        upsert=True,
    )


async def build_receipt_pdf(payment_id: str, user: dict) -> tuple[bytes, str]:
    j = await receipt_data(payment_id, user)
    p, b, c, co = j["payment"], j["booking"] or {}, j["customer"] or {}, j["company"] or {}
    code = _pdf.verify_code("receipt", p["id"])
    await _record_verification(code, "receipt", p["id"], p["receipt_number"], p["payment_date"])
    d = _pdf.BrandedDoc(
        "Payment Receipt",
        co,
        number=p["receipt_number"],
        date=p["payment_date"],
        verify=code,
        subtitle=f"Booking {b.get('booking_number', '')}",
    )
    if j.get("cancelled"):
        d.p("<font color='#B91C1C'><b>CANCELLED / REVERSED</b></font>")
    fs = b.get("flat_snapshot") or {}
    d.kv(
        [
            ("Received from", f"{c.get('salutation') or ''} {c.get('full_name', '')}".strip()),
            ("Customer code", c.get("customer_code")),
            ("Booking", b.get("booking_number")),
            ("Unit", f"{b.get('project_name', '')} · {b.get('block_name', '')} · {fs.get('flat_number', '')}"),
            ("Address", _addr(c.get("address_current"))),
            ("Phone", c.get("phone")),
        ]
    )
    d.h2("Payment details")
    inst = p.get("instrument") or {}
    d.table(
        ["Towards", "Mode", "Instrument", "Bank", "Status", "Amount"],
        [
            [
                ("Other charges: " + p["other_charge_name"])
                if p.get("other_charge_name")
                else f"Flat value ({p.get('payment_category')})",
                p.get("payment_mode_name"),
                " ".join(
                    filter(None, [inst.get("number"), _pdf.fmt_date(inst.get("date")) if inst.get("date") else None])
                )
                or "-",
                inst.get("bank_name") or p.get("bank_account_name") or "-",
                p["status"],
                _pdf.inr(p["amount_paise"]),
            ]
        ],
        widths=[1.6, 1, 1.2, 1.2, 0.8, 1.2],
        align_right=[5],
        totals=["Amount received", "", "", "", "", _pdf.inr(p["amount_paise"])],
    )
    if p.get("allocations"):
        d.h2("Applied to")
        d.table(
            ["Bill", "Due date", "Share", "Applied"],
            [
                [
                    a.get("demand_number") and f"{a['demand_number']} · {a['name']}" or a["name"],
                    _pdf.fmt_date(a["due_date"]) if a.get("due_date") else "—",
                    "Charges" if a["kind"] == "OTHER_CHARGE" else a.get("category") or "",
                    _pdf.inr(a["amount_paise"]),
                ]
                for a in p["allocations"]
            ],
            totals=["Total applied", "", "", _pdf.inr(sum(a["amount_paise"] for a in p["allocations"]))],
        )
    d.spacer(1.5)
    d.p(f"<b>Amount in words:</b> {j['amount_in_words']}")
    if j.get("after"):
        a = j["after"]
        d.h2("Account position after this receipt")
        d.table(
            ["Cash paid (cum)", "Account paid (cum)", "Cash due", "Account due", "Total due", "Charges due"],
            [
                [
                    _pdf.inr(a["cash_paid_cum_paise"]),
                    _pdf.inr(a["account_paid_cum_paise"]),
                    _pdf.inr(a["cash_due_paise"]),
                    _pdf.inr(a["account_due_paise"]),
                    _pdf.inr(a["total_due_paise"]),
                    _pdf.inr(a.get("other_charges_due_paise", 0)),
                ]
            ],
            align_right=list(range(6)),
        )
    if j.get("subject_to_realisation"):
        d.small("Cheque / DD receipts are subject to realisation.")
    d.small(f"Received by {p.get('received_by_name') or '-'}. Remarks: {p.get('remarks') or '-'}")
    d.signature(co.get("authorised_signatory_name") or "")
    return await asyncio.to_thread(d.build), f"receipt-{p['receipt_number'].replace('/', '-')}.pdf"


async def build_demand_pdf(booking_id: str, demand_id: str, user: dict) -> tuple[bytes, str]:
    j = await demand_letter_data(booking_id, demand_id, user)
    dm, b, c, co, bank = j["demand"], j["booking"], j["customer"] or {}, j["company"] or {}, j.get("bank") or {}
    code = _pdf.verify_code("demand", dm["id"])
    await _record_verification(code, "demand", dm["id"], dm["demand_number"], dm["demand_date"])
    d = _pdf.BrandedDoc(
        "Demand Letter",
        co,
        number=dm["demand_number"],
        date=dm["demand_date"],
        verify=code,
        subtitle=f"Booking {b['booking_number']} · due {_pdf.fmt_date(dm['due_date'])}",
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
        (
            f"<b>Subject: Payment demand on completion of milestone “{dm['milestone_name']}” ({dm['cumulative_percent']}%) — Unit "
            f"{fs.get('flat_number')}, "
            f"{b.get('block_name')}, "
            f"{b.get('project_name')}</b>"
        )
    )
    d.spacer(2)
    d.p(
        (
            f"Dear Sir/Madam,<br/><br/>We are pleased to inform you that the construction milestone <b>{dm['milestone_name']}</b> has been "
            f"completed. As per "
            f"the payment "
            f"schedule of your "
            f"Booking No. "
            f"<b>{b['booking_number']}</b>, the "
            f"following "
            f"amount is "
            f"now due and "
            f"payable on "
            f"or before "
            f"<b>{_pdf.fmt_date(dm['due_date'])}</b>."
        )
    )
    d.h2("Demand")
    d.table(
        ["Component", "Amount", "In words"],
        [
            ["Cash component", _pdf.inr(dm["cash_demand_paise"]), j.get("cash_in_words", "")],
            ["Account component", _pdf.inr(dm["account_demand_paise"]), j.get("account_in_words", "")],
        ],
        widths=[1.2, 1, 3],
        align_right=[1],
    )
    d.totals(
        [
            ("Cash", _pdf.inr(dm["cash_demand_paise"])),
            ("Account", _pdf.inr(dm["account_demand_paise"])),
            ("Total due", _pdf.inr(dm["total_demand_paise"])),
        ]
    )
    d.p(f"<b>Amount in words:</b> {j['amount_in_words']}")
    if bank:
        d.h2("Bank details for account payments")
        d.kv(
            [
                ("Bank", bank.get("bank_name")),
                ("Account name", bank.get("account_name")),
                ("Account no.", bank.get("account_number")),
                ("IFSC", bank.get("ifsc")),
                ("Branch", bank.get("branch")),
            ]
        )
    d.spacer(2)
    d.p(
        (
            "Kindly arrange the payment within the due date to avoid interest on delayed payment as per the Agreement for Sale. Please ignore "
            "this letter "
            "if payment "
            "has already "
            "been made."
        ),
        _pdf.SMALL,
    )
    d.signature(co.get("authorised_signatory_name") or "")
    return await asyncio.to_thread(d.build), f"demand-{dm['demand_number'].replace('/', '-')}.pdf"


async def _booking_bundle(booking_id: str, user: dict):
    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    customer = await db.customers.find_one(
        {"id": b["customer_id"]},
        {
            "_id": 0,
            "full_name": 1,
            "salutation": 1,
            "address_current": 1,
            "phone": 1,
            "email": 1,
            "customer_code": 1,
            "co_applicants": 1,
        },
    )
    if customer:
        customer["co_applicants"] = [
            {"name": c.get("name"), "relation": c.get("relation")} for c in customer.pop("co_applicants", None) or []
        ]
    demands = (
        await db.demands.find({"booking_id": booking_id, "voided": False}, {"_id": 0})
        .sort("milestone_seq", 1)
        .to_list(None)
    )
    payments = await db.payments.find({"booking_id": booking_id}, {"_id": 0}).sort("payment_date", 1).to_list(None)
    ledger = await db.ledger_entries.find({"booking_id": booking_id}, {"_id": 0}).sort("seq", 1).to_list(None)
    company = await _pdf.company_for_pdf(user["company_id"])
    return b, customer, demands, payments, ledger, company


async def build_statement_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, customer, demands, payments, ledger, company = await _booking_bundle(booking_id, user)
    s = b.get("summary") or {}
    as_of = _pdf.today_ist()
    code = _pdf.verify_code("statement", f"{b['id']}:{as_of}")
    await db.doc_verifications.update_one(
        {"code": code},
        {
            "$set": {
                "code": code,
                "doc_type": "statement",
                "entity_id": b["id"],
                "number": b["booking_number"],
                "date": as_of,
            }
        },
        upsert=True,
    )
    d = _pdf.BrandedDoc(
        "Customer Statement of Account",
        company,
        landscape_mode=True,
        number=b["booking_number"],
        date=as_of,
        verify=code,
        subtitle="Statement as of date shown",
    )
    fs = b.get("flat_snapshot") or {}
    d.kv(
        [
            ("Customer", f"{customer.get('salutation') or ''} {customer['full_name']}".strip()),
            ("Customer code", customer.get("customer_code")),
            ("Phone", customer.get("phone")),
            ("Address", _addr(customer.get("address_current"))),
            ("Booking no.", b["booking_number"]),
            ("Booking date", _pdf.fmt_date(b["booking_date"])),
            (
                "Unit",
                (
                    f"{b['project_name']} · {b['block_name']} · {fs.get('flat_number')} ({fs.get('flat_type_code')}, saleable area "
                    f"{fs.get('saleable_sqft') or fs.get('super_builtup_sqft')} sq ft)"
                ),
            ),
            ("Status", b["status"]),
        ],
        cols=2,
    )
    d.h2("Agreement")
    d.table(
        ["Agreement value", "Cash component", "Account component", "Revisions"],
        [
            [
                _pdf.inr(b["agreement_value_paise"]),
                _pdf.inr(b["cash_agreed_paise"]),
                _pdf.inr(b["account_agreed_paise"]),
                str(len(b.get("agreement_revisions") or [])),
            ]
        ],
        align_right=[0, 1, 2],
    )
    for r in b.get("agreement_revisions") or []:
        d.small(
            (
                f"Revision {_pdf.fmt_date(r.get('at') or r.get('revised_at'))}: "
                f"{_pdf.inr(r.get('old_agreement_value_paise') or r.get('before', {}).get('agreement_value_paise'))} → "
                f"{_pdf.inr(r.get('new_agreement_value_paise') or r.get('after', {}).get('agreement_value_paise'))} — "
                f"{r.get('reason', '')}"
            )
        )
    d.h2("Milestone schedule")
    d.table(
        ["#", "Milestone", "Cum %", "Cash demand", "Account demand", "Total", "Due date", "Paid", "Balance", "Status"],
        [
            [
                x.get("milestone_seq") or x.get("installment_seq") or "",
                x.get("milestone_name") or x.get("installment_name") or "",
                f"{x['cumulative_percent']}%"
                if x.get("percent") is not None or x.get("cumulative_percent") is not None
                else "—",
                _pdf.inr(x["cash_demand_paise"]),
                _pdf.inr(x["account_demand_paise"]),
                _pdf.inr(x["total_demand_paise"]),
                _pdf.fmt_date(x["due_date"]),
                _pdf.inr(x.get("paid_paise", 0)),
                _pdf.inr(x["total_demand_paise"] - x.get("paid_paise", 0)),
                x["status"],
            ]
            for x in demands
        ],
        widths=[0.4, 1.6, 0.6, 1, 1, 1, 0.9, 1, 1, 0.8],
        align_right=[3, 4, 5, 7, 8],
    )
    d.h2("Ledger (Bill raised / Received)")
    rows = [
        [
            _pdf.fmt_date(e["date"]),
            f"{e['type'].replace('_', ' ').title()} — {e.get('note') or ''}"
            + (f" [{e['tag']}]" if e.get("tag") else "")
            + (f" · {e['ref']}" if e.get("ref") else ""),
            _pdf.inr(e.get("udhar_paise", 0)) if e.get("udhar_paise") else "",
            _pdf.inr(e.get("jama_paise", 0)) if e.get("jama_paise") else "",
            " ".join(x for x in [(e.get("mode") if e.get("mode") != "Due" else None), e.get("instrument")] if x),
            _pdf.inr(e.get("balance_paise", 0)),
        ]
        for e in ledger
    ]
    tu, tj = sum(e.get("udhar_paise", 0) for e in ledger), sum(e.get("jama_paise", 0) for e in ledger)
    rows.append(["", "Totals", _pdf.inr(tu), _pdf.inr(tj), "", _pdf.inr(tu - tj)])
    d.table(
        ["Date", "Particulars", "Bill raised", "Received", "Mode / Instrument", "Balance"],
        rows,
        widths=[0.9, 3.2, 1.1, 1.1, 1.4, 1.1],
        align_right=[2, 3, 5],
    )
    d.totals(
        [
            ("Total bill raised", _pdf.inr(tu)),
            ("Total received", _pdf.inr(tj)),
            (
                "Balance (Received − Bill raised)",
                _pdf.inr(tj - tu) + (" Due" if tj < tu else " Advance" if tj > tu else " Settled"),
            ),
            ("Advance held", _pdf.inr(s.get("advance_paise", 0))),
        ]
    )
    if b.get("other_charges"):
        d.h2("Other charges")
        d.table(
            ["Charge", "Amount", "GST", "Total", "Billed", "Paid", "Due"],
            [
                [
                    c["name"],
                    _pdf.inr(c["amount_paise"]),
                    _pdf.inr(c.get("gst_paise", 0)),
                    _pdf.inr(c["total_paise"]),
                    _pdf.inr(c.get("demanded_paise", 0)),
                    _pdf.inr(c.get("paid_paise", 0)),
                    _pdf.inr(c.get("demanded_paise", 0) - c.get("paid_paise", 0)),
                ]
                for c in b["other_charges"]
            ],
            align_right=[1, 2, 3, 4, 5, 6],
        )
    pend = [p for p in payments if p["status"] == "Pending"]
    if pend:
        d.h2("Pending cheques / DDs")
        d.table(
            ["Receipt", "Instrument", "Date", "Bank", "Amount"],
            [
                [
                    p["receipt_number"],
                    (p.get("instrument") or {}).get("number"),
                    _pdf.fmt_date((p.get("instrument") or {}).get("date")),
                    (p.get("instrument") or {}).get("bank_name"),
                    _pdf.inr(p["amount_paise"]),
                ]
                for p in pend
            ],
            align_right=[4],
        )
    d.h2("Summary")
    d.table(
        ["Order raised", "Paid", "Cash due", "Account due", "Charges due", "Total due", "Pending cheques"],
        [
            [
                _pdf.inr(s.get("total_order_raised_paise")),
                _pdf.inr(s.get("paid_paise")),
                _pdf.inr(s.get("cash_due_paise")),
                _pdf.inr(s.get("account_due_paise")),
                _pdf.inr(s.get("other_charges_due_paise")),
                _pdf.inr(s.get("due_paise", 0) + s.get("other_charges_due_paise", 0)),
                _pdf.inr(s.get("pending_cheques_paise")),
            ]
        ],
        align_right=list(range(7)),
    )
    d.totals(
        [
            ("Total paid", _pdf.inr(s.get("paid_paise"))),
            ("Pending cheques", _pdf.inr(s.get("pending_cheques_paise"))),
            ("Total due", _pdf.inr(s.get("due_paise", 0) + s.get("other_charges_due_paise", 0))),
        ]
    )
    d.small(
        (
            f"Total due in words: {amount_in_words(s.get('due_paise', 0) + s.get('other_charges_due_paise', 0))}. This is a system generated "
            f"statement; "
            f"errors and "
            f"omissions "
            f"excepted."
        )
    )
    d.signature(company.get("authorised_signatory_name") or "")
    return d.build(), f"statement-{b['booking_number'].replace('/', '-')}.pdf"


async def _allotment_data(booking_id: str, user: dict, pdf: bool = False):
    b, customer, demands, payments, ledger, company = await _booking_bundle(booking_id, user)
    sched = []
    prev = 0
    for m in b.get("milestone_template_snapshot") or []:
        inc = m["cumulative_percent"] - prev
        prev = m["cumulative_percent"]
        sched.append(
            {
                "seq": m["seq"],
                "name": m["name"],
                "cumulative_percent": m["cumulative_percent"],
                "incremental_percent": inc,
                "cash_paise": pct_of(b["cash_agreed_paise"], inc),
                "account_paise": pct_of(b["account_agreed_paise"], inc),
                "total_paise": pct_of(b["agreement_value_paise"], inc),
            }
        )
    terms = company.get("allotment_terms") or (
        "1. The allotment is provisional and subject to execution of the Agreement for Sale under RERA.\n2. "
        "Payments are construction-linked and due within the demand due period from the date of each demand "
        "letter.\n3. Delayed "
        "payments attract "
        "interest "
        "as per the "
        "Agreement for "
        "Sale.\n4. "
        "Other charges "
        "(maintenance "
        "deposit, "
        "registration, "
        "taxes) are "
        "payable at "
        "possession as "
        "applicable.\n5. All "
        "disputes "
        "are subject "
        "to Patna "
        "jurisdiction."
    )
    if not pdf:
        return present_money(
            {"booking": b, "customer": customer, "schedule": sched, "terms": terms, "company": company}
        )
    return b, customer, sched, terms, company


def _breakdown_section(d, b: dict):
    """PS.3: agreement value → GST → additional charges (own GST each) → total final value."""
    pr = b.get("pricing") or {}
    charges = pr.get("charges") or [
        {
            "name": c["name"],
            "amount_paise": c["amount_paise"],
            "gst_percent": c.get("gst_percent", 0),
            "gst_paise": c.get("gst_paise", 0),
            "total_paise": c["total_paise"],
            "demand_at": c.get("demand_at"),
        }
        for c in b.get("other_charges") or []
    ]
    d.h2("Value breakdown")
    rows = [
        [
            "Agreement value",
            _pdf.inr(b["agreement_value_paise"]),
            f"{pr.get('agreement_gst_percent') or 0:g}%",
            _pdf.inr(pr.get("agreement_gst_paise", 0)),
            _pdf.inr(b["agreement_value_paise"] + pr.get("agreement_gst_paise", 0)),
            "per payment plan",
        ]
    ]
    rows += [
        [
            c["name"],
            _pdf.inr(c["amount_paise"]),
            f"{c.get('gst_percent') or 0:g}%",
            _pdf.inr(c.get("gst_paise", 0)),
            _pdf.inr(c["total_paise"]),
            (c.get("demand_at") or "").replace("_", " "),
        ]
        for c in charges
    ]
    total = pr.get("total_final_value_paise") or (b["agreement_value_paise"] + sum(c["total_paise"] for c in charges))
    d.table(
        ["Particulars", "Amount", "GST %", "GST", "Total", "Payable"],
        rows,
        widths=[2.4, 1.2, 0.6, 1.0, 1.2, 1.1],
        align_right=[1, 3, 4],
        totals=[
            "Total final value",
            "",
            "",
            _pdf.inr(pr.get("gst_total_paise", sum(c.get("gst_paise", 0) for c in charges))),
            _pdf.inr(total),
            "",
        ],
    )


async def build_cost_sheet_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    """PS.3 document `cost_sheet`: full price breakdown for the customer."""
    b, customer, sched, terms, company = await _allotment_data(booking_id, user, pdf=True)
    code = _pdf.verify_code("cost_sheet", b["id"])
    await db.doc_verifications.update_one(
        {"code": code},
        {
            "$set": {
                "code": code,
                "doc_type": "cost_sheet",
                "entity_id": b["id"],
                "number": b["booking_number"],
                "date": b["booking_date"],
            }
        },
        upsert=True,
    )
    d = _pdf.BrandedDoc(
        "Cost Sheet", company, number=b["booking_number"], date=b["booking_date"], verify=code, subtitle="Price summary"
    )
    fs = b.get("flat_snapshot") or {}
    pr = b.get("pricing") or {}
    d.p(
        (
            f"<b>{customer.get('salutation') or ''} {customer['full_name']}</b> · Unit <b>{fs.get('flat_number')}</b>, {b['block_name']}, "
            f"{b['project_name']} · "
            f"{fs.get('flat_type_code') or ''} · "
            f"Saleable area "
            f"<b>{fs.get('saleable_sqft') or fs.get('super_builtup_sqft') or '-'} "
            f"sq ft</b>"
        )
        + (f" · Rate ₹{b['rate_per_sqft']:g}/sq ft" if b.get("rate_per_sqft") else "")
    )
    _breakdown_section(d, b)
    d.totals(
        [
            ("Agreement value", _pdf.inr(b["agreement_value_paise"])),
            (
                f"GST on agreement ({pr.get('agreement_gst_percent') or 0:g}%)",
                _pdf.inr(pr.get("agreement_gst_paise", 0)),
            ),
            ("Additional charges", _pdf.inr(pr.get("additional_charges_total_paise", 0))),
            ("GST on charges", _pdf.inr(pr.get("gst_total_paise", 0) - pr.get("agreement_gst_paise", 0))),
            ("Total final value", _pdf.inr(pr.get("total_final_value_paise", b["agreement_value_paise"]))),
        ]
    )
    d.h2("Payment schedule (agreement value, construction-linked)")
    d.table(
        ["#", "Milestone", "Cum %", "Stage %", "Cash", "Account", "Total"],
        [
            [
                x["seq"],
                x["name"],
                f"{x['cumulative_percent']}%",
                f"{x['incremental_percent']}%",
                _pdf.inr(x["cash_paise"]),
                _pdf.inr(x["account_paise"]),
                _pdf.inr(x["total_paise"]),
            ]
            for x in sched
        ],
        widths=[0.4, 2, 0.7, 0.7, 1.2, 1.2, 1.2],
        align_right=[4, 5, 6],
    )
    d.p(
        (
            "GST on the agreement value is demanded proportionally with each stage; additional charges are demanded at the timing shown (on "
            "booking / on "
            "possession "
            "/ stage / "
            "manual), "
            "each with "
            "its own GST."
        ),
        _pdf.SMALL,
    )
    d.signature(company.get("authorised_signatory_name") or "")
    return d.build(), f"cost-sheet-{b['booking_number'].replace('/', '-')}.pdf"


async def build_allotment_pdf(booking_id: str, user: dict) -> tuple[bytes, str]:
    b, customer, sched, terms, company = await _allotment_data(booking_id, user, pdf=True)
    code = _pdf.verify_code("allotment", b["id"])
    await db.doc_verifications.update_one(
        {"code": code},
        {
            "$set": {
                "code": code,
                "doc_type": "allotment",
                "entity_id": b["id"],
                "number": b["booking_number"],
                "date": b["booking_date"],
            }
        },
        upsert=True,
    )
    d = _pdf.BrandedDoc(
        "Allotment Letter & Payment Schedule",
        company,
        number=b["booking_number"],
        date=b["booking_date"],
        verify=code,
        subtitle="Provisional allotment",
    )
    fs = b.get("flat_snapshot") or {}
    d.p(
        (
            f"To,<br/><b>{customer.get('salutation') or ''} {customer['full_name']}</b><br/>{_addr(customer.get('address_current'))}<br/>Phone: "
            f"{customer.get('phone') or '-'}"
        )
    )
    if customer.get("co_applicants"):
        d.p(
            "Co-applicant(s): "
            + ", ".join(
                "<b>%s</b>%s" % (c["name"], " (%s)" % c["relation"] if c.get("relation") else "")
                for c in customer["co_applicants"]
            )
        )
    d.spacer(3)
    d.p(
        f"<b>Subject: Provisional allotment of Unit {fs.get('flat_number')} in {b['block_name']}, {b['project_name']}</b>"
    )
    d.spacer(2)
    d.p(
        (
            f"Dear {customer.get('salutation') or ''} {customer['full_name'].split()[0]},<br/><br/>We are pleased to confirm the provisional "
            f"allotment of the "
            f"above unit "
            f"({fs.get('flat_type_code')}, "
            f"saleable area "
            f"{fs.get('saleable_sqft') or fs.get('super_builtup_sqft')} sq "
            f"ft) in your "
            f"favour against "
            f"Booking No. "
            f"<b>{b['booking_number']}</b> dated "
            f"{_pdf.fmt_date(b['booking_date'])}, for an "
            f"agreement "
            f"value of "
            f"<b>{_pdf.inr(b['agreement_value_paise'])}</b> "
            f"({amount_in_words(b['agreement_value_paise'])})"
        )
        + (
            f", total final value including GST and additional charges <b>{_pdf.inr((b.get('pricing') or {}).get('total_final_value_paise'))}</b>."
            if (b.get("pricing") or {}).get("total_final_value_paise")
            else "."
        )
    )
    d.h2("Payment schedule (construction-linked)")
    d.table(
        ["#", "Milestone", "Cum %", "Stage %", "Cash", "Account", "Total"],
        [
            [
                x["seq"],
                x["name"],
                f"{x['cumulative_percent']}%",
                f"{x['incremental_percent']}%",
                _pdf.inr(x["cash_paise"]),
                _pdf.inr(x["account_paise"]),
                _pdf.inr(x["total_paise"]),
            ]
            for x in sched
        ],
        widths=[0.4, 2, 0.7, 0.7, 1.2, 1.2, 1.2],
        align_right=[4, 5, 6],
        totals=[
            "",
            "Total",
            "",
            "",
            _pdf.inr(b["cash_agreed_paise"]),
            _pdf.inr(b["account_agreed_paise"]),
            _pdf.inr(b["agreement_value_paise"]),
        ],
    )
    _breakdown_section(d, b)
    d.totals(
        [
            ("Cash component", _pdf.inr(b["cash_agreed_paise"])),
            ("Account component", _pdf.inr(b["account_agreed_paise"])),
            ("Agreement value", _pdf.inr(b["agreement_value_paise"])),
        ]
    )
    led = await db.ledger_entries.find({"booking_id": b["id"]}, {"_id": 0}).sort("seq", 1).to_list(None)
    if led:
        tu, tj = sum(e.get("udhar_paise", 0) for e in led), sum(e.get("jama_paise", 0) for e in led)
        d.h2("Account position as on date (Bill raised / Received)")
        d.table(
            ["Date", "Particulars", "Bill raised", "Received", "Mode / Instrument", "Balance"],
            [
                [
                    _pdf.fmt_date(e["date"]),
                    f"{e['type'].replace('_', ' ').title()} — {e.get('note') or ''}",
                    _pdf.inr(e["udhar_paise"]) if e.get("udhar_paise") else "",
                    _pdf.inr(e["jama_paise"]) if e.get("jama_paise") else "",
                    " ".join(
                        x for x in [(e.get("mode") if e.get("mode") != "Due" else None), e.get("instrument")] if x
                    ),
                    _pdf.inr(e.get("balance_paise", 0)),
                ]
                for e in led
            ]
            + [["", "Totals", _pdf.inr(tu), _pdf.inr(tj), "", _pdf.inr(tu - tj)]],
            widths=[0.9, 3.2, 1.1, 1.1, 1.4, 1.1],
            align_right=[2, 3, 5],
        )
        d.totals(
            [
                ("Total bill raised", _pdf.inr(tu)),
                ("Total received", _pdf.inr(tj)),
                (
                    "Balance (Received − Bill raised)",
                    _pdf.inr(tj - tu) + (" Due" if tj < tu else " Advance" if tj > tu else " Settled"),
                ),
                ("Advance held", _pdf.inr((b.get("summary") or {}).get("advance_paise", 0))),
            ]
        )
    d.h2("Terms & conditions")
    for line in terms.split("\n"):
        d.p(line, _pdf.SMALL)
    d.signature(company.get("authorised_signatory_name") or "")
    return d.build(), f"allotment-{b['booking_number'].replace('/', '-')}.pdf"
