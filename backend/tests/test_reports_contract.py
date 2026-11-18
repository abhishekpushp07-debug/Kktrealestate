"""K1: every report in the hub returns what Reports.jsx reads — the standard {rows, columns} table, or an adapter in
lib/reportsMeta.js ROW_ADAPTERS naming the API field that holds the rows."""

import pathlib
import re

import requests

from tests.conftest import BASE

META = (pathlib.Path(__file__).resolve().parents[2] / "frontend/src/lib/reportsMeta.js").read_text()
ADAPTER_BLOCK = META[META.index("export const ROW_ADAPTERS") : META.index("export const adaptReport")]
ADAPTERS = dict(re.findall(r'^  "?([a-z-]+)"?: \{\n    from: "([a-z_]+)"', ADAPTER_BLOCK, re.M))
FILTER_KEYS = set(re.findall(r'^  "?([a-z0-9-]+)"?: \[', META[META.index("export const FILTERS") :], re.M))


def test_upcoming_dues_has_an_adapter():
    assert ADAPTERS.get("upcoming-dues") == "items"


def test_every_report_returns_what_the_page_reads(admin_headers):
    reports = requests.get(f"{BASE}/api/reports", headers=admin_headers, timeout=30).json()["items"]
    assert len(reports) >= 25
    bad = []
    for r in reports:
        key = r["key"]
        d = requests.get(f"{BASE}/api/reports/{key}", headers=admin_headers, timeout=60).json()
        if key in ADAPTERS:
            if not isinstance(d.get(ADAPTERS[key]), list):
                bad.append(f"{key}: adapter reads `{ADAPTERS[key]}`, API keys {sorted(d)}")
        elif not (isinstance(d.get("rows"), list) and isinstance(d.get("columns"), list)):
            bad.append(f"{key}: no rows/columns and no ROW_ADAPTERS entry (API keys {sorted(d)})")
        if key not in FILTER_KEYS:
            bad.append(f"{key}: missing from FILTERS")
    assert not bad, bad


def test_upcoming_dues_days_selector_and_total(admin_headers):
    totals = {}
    for days in (30, 90, 365):
        d = requests.get(f"{BASE}/api/reports/upcoming-dues?days={days}", headers=admin_headers, timeout=60).json()
        assert d["horizon_days"] == days
        assert d["total_paise"] == sum(x["total_paise"] for x in d["items"])  # page shows Σ rows
        totals[days] = len(d["items"])
    assert totals[30] <= totals[90] <= totals[365]
