"""Customer-facing PDFs for the ERP (receipt, demand letter, statement, allotment). Portal routes call the same builders → identical bytes."""

from fastapi import APIRouter, Depends

from deps import require
from services import pdf as _pdf
from services.pdf_builders import (
    build_allotment_pdf,
    build_cost_sheet_pdf,
    build_demand_pdf,
    build_receipt_pdf,
    build_statement_pdf,
)

router = APIRouter(tags=["pdf"])


@router.get("/payments/{payment_id}/receipt.pdf")
async def receipt_pdf(payment_id: str, download: int = 0, user: dict = Depends(require("finance.receipt.download"))):
    content, name = await build_receipt_pdf(payment_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/demands/{demand_id}/letter.pdf")
async def demand_letter_pdf(
    booking_id: str, demand_id: str, download: int = 0, user: dict = Depends(require("finance.demand.export"))
):
    content, name = await build_demand_pdf(booking_id, demand_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/statement.pdf")
async def statement_pdf(booking_id: str, download: int = 0, user: dict = Depends(require("finance.ledger.export"))):
    content, name = await build_statement_pdf(booking_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/cost-sheet.pdf")
async def cost_sheet_pdf(booking_id: str, download: int = 0, user: dict = Depends(require("sales.booking.export"))):
    content, name = await build_cost_sheet_pdf(booking_id, user)
    return _pdf.pdf_response(content, name, bool(download))


@router.get("/bookings/{booking_id}/allotment.pdf")
async def allotment_pdf(booking_id: str, download: int = 0, user: dict = Depends(require("sales.booking.export"))):
    content, name = await build_allotment_pdf(booking_id, user)
    return _pdf.pdf_response(content, name, bool(download))
