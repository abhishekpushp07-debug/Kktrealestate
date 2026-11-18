"""Iteration 12: Collections (receipt date) → carried "received in period" (ledger / clearance day) bridge is exact."""

from services.definitions import receipts_bridge

FY = ("2026-04-01", "2027-03-31")


def _r(num, amt, paid_on, bid="b1", status="Cleared", rev_at=None):
    return {
        "receipt_number": num,
        "amount_paise": amt,
        "payment_date": paid_on,
        "booking_id": bid,
        "status": status,
        "reversal": {"at": rev_at} if rev_at else None,
    }


def test_cheque_dated_30_mar_cleared_2_apr_counts_in_the_new_year_by_clearance():
    receipts = [_r("R1", 500_000_00, "2026-03-30"), _r("R2", 100_000_00, "2026-05-10")]
    ledger_day = {"R1": "2026-04-02", "R2": "2026-05-10"}
    b = receipts_bridge(receipts, ledger_day, {"b1"}, *FY, 0)
    assert b["by_receipt_date_paise"] == 100_000_00  # Collections (receipt basis) shows only R2
    assert b["dated_before_cleared_in_paise"] == 500_000_00
    assert b["dated_in_cleared_after_paise"] == 0
    assert b["by_clearance_paise"] == 600_000_00  # = ledger jama in the FY


def test_same_cheque_in_the_old_year_is_dated_in_cleared_after():
    b = receipts_bridge(
        [_r("R1", 500_000_00, "2026-03-30")], {"R1": "2026-04-02"}, {"b1"}, "2025-04-01", "2026-03-31", 0
    )
    assert (b["by_receipt_date_paise"], b["dated_in_cleared_after_paise"], b["by_clearance_paise"]) == (
        500_000_00,
        500_000_00,
        0,
    )


def test_not_live_booking_reversal_and_refund_terms():
    receipts = [
        _r("R1", 200_00, "2026-06-01", bid="dead"),  # cancelled booking: in Collections, not in the live ledger
        _r("R2", 300_00, "2026-06-02", status="Reversed", rev_at="2026-06-05T06:00:00+00:00"),
    ]
    b = receipts_bridge(receipts, {"R2": "2026-06-02"}, {"b1"}, *FY, -50_00)
    assert b["by_receipt_date_paise"] == 200_00  # R2 in and out on its reversal day
    assert b["not_live_paise"] == 200_00
    assert b["refunds_paise"] == -50_00
    assert b["by_clearance_paise"] == -50_00
