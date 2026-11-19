"""Phase 3I — Collections' default view comes from server-side totals + one page of receipts (reports_v3/fast.py).
It must answer exactly what the row-by-row path answers: a column choice (same columns) forces the full path."""

import requests

from tests.conftest import BASE

API = f"{BASE}/api/reports/v3/collections"
COLS = "date,group,customer_name,booking_number,tag,cash_paise,account_paise,other_paise,reversal_paise,total_paise"


def _get(h, **params):
    r = requests.get(API, headers=h, params=params, timeout=180)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_fast_default_view_equals_full_path(admin_headers):
    for extra in ({}, {"page": 2}, {"period_from": "2025-04-01", "period_to": "2026-03-31"}):
        fast = _get(admin_headers, page_size=25, **extra)
        full = _get(admin_headers, page_size=25, cols=COLS, **extra)
        assert [c["key"] for c in fast["cols"]] == [c["key"] for c in full["cols"]]
        for k in ("count", "totals", "options", "sentence", "formula", "lines", "illustration", "rows"):
            assert fast[k] == full[k], (extra, k)
