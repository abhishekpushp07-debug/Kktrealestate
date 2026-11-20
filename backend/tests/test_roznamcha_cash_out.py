"""P2-1 P1: Roznamcha is the physical cash day book — a cash refund paid today is a row and part of "Cash paid out",
and opening + in − out = closing holds on the data the screen renders."""

from tests.conftest import BASE
from tools.connection_matrix import Api, World, _refund_pay, _refund_setup


def _day(api, d):
    return api.get("/roznamcha", date=d)


def test_cash_refund_shows_as_row_and_in_cash_paid_out(admin_headers):
    api = Api(BASE, admin_headers)
    w = World(api)
    c = _refund_setup(w)
    before = _day(api, w.today)
    _refund_pay(w, c)
    after = _day(api, w.today)
    rf = next(r for r in api.get(f"/bookings/{c['bid']}/refunds")["items"] if r["id"] == c["rf"])
    row = next(r for r in after["refunds"] if r["id"] == c["rf"])
    assert row["refund_number"] == rf["refund_number"] and row["mode"] == "CASH" and row["paid_out_paise"] == c["R"]
    assert after["cash_paid_out_paise"] - before["cash_paid_out_paise"] == c["R"]
    # closing moves by exactly the day's in − out (other xdist workers may post cash on the same day; the refund is in "out")
    delta = lambda k: after[k] - before[k]  # noqa: E731
    assert delta("closing_cash_paise") == delta("cash_received_paise") + delta("cash_withdrawals_paise") - c["R"]
    for b in (before, after):
        assert (
            b["opening_cash_paise"] + b["cash_received_paise"] + b["cash_withdrawals_paise"] - b["cash_paid_out_paise"]
            == b["closing_cash_paise"]
        )


def test_roznamcha_page_renders_refund_rows_and_paid_out_tile():
    src = open(__file__.replace("backend/tests/test_roznamcha_cash_out.py", "frontend/src/pages/Roznamcha.jsx")).read()
    for needle in (
        'testId="rozn-paid-out"',
        "d.refunds.map",
        "rozn-refund-",
        'data-testid="rozn-formula"',
        "d.cash_paid_out",
    ):
        assert needle in src, needle
