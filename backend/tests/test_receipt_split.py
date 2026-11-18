"""Phase 1 F-3: Cash / Account / Other split is computed from each receipt's allocation parts (one shared function)."""

import json
import os
from datetime import date

import pytest
import requests
from pymongo import MongoClient

from services.definitions import SPLIT_KEYS, receipt_parts, received_on
from tests.conftest import PURGE_SCAN_FILE


def test_receipt_parts_explodes_allocations_and_keeps_whole_receipts():
    split = {
        "amount_paise": 300,
        "against": "FLAT_VALUE",
        "payment_category": "Cash",
        "allocations": [
            {"kind": "DEMAND", "category": "Cash", "amount_paise": 100},
            {"kind": "OTHER_CHARGE", "category": "Account", "line_id": "l1", "amount_paise": 150},
            {"kind": "ADVANCE", "category": "Cash", "amount_paise": 50},
        ],
    }
    assert receipt_parts(split) == {"Cash": 150, "Account": 0, "Other": 150}
    assert receipt_parts({"amount_paise": 70, "against": "FLAT_VALUE", "payment_category": "Account"})["Account"] == 70
    assert receipt_parts({"amount_paise": 70, "against": "OTHER_CHARGE", "payment_category": None})["Other"] == 70


@pytest.mark.load_sensitive
def test_home_month_split_equals_sum_of_allocation_parts(base_url, admin_headers):
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({})["id"]
    m0 = date.today().replace(day=1).isoformat()
    raw = dict.fromkeys(SPLIT_KEYS, 0)
    for p in db.payments.find({"company_id": cid, "status": "Cleared"}):
        if (received_on(p) or "") < m0:  # 3H REQ-319: received = cleared (cheque on its clearing day)
            continue
        for k, v in receipt_parts(p).items():
            raw[k] += v
    month = requests.get(f"{base_url}/api/dashboard", headers=admin_headers, timeout=60).json()["collections"]["month"]
    assert {k: month[f"{k}_paise"] for k in SPLIT_KEYS} == raw
    assert month["total_paise"] == sum(raw.values())


@pytest.mark.load_sensitive
def test_paid_parts_backfill_is_idempotent(base_url, admin_headers):
    url = f"{base_url}/api/admin/backfill-paid-parts"
    requests.post(url, headers=admin_headers, timeout=300).raise_for_status()
    second = requests.post(url, headers=admin_headers, timeout=300).json()
    assert second["changed"] == 0 and second["voided_filled"] == 0 and second["missing_after"] == 0, second
    assert not second["skipped"], second["skipped"]


@pytest.mark.load_sensitive  # company-wide purge scan: another worker's Own-* towers are test data
def test_hard_purge_refuses_real_data(base_url, admin_headers):
    sgh = next(
        p
        for p in requests.get(f"{base_url}/api/projects", headers=admin_headers, timeout=30).json()["items"]
        if p["code"] == "SGH"
    )
    blk = requests.get(
        f"{base_url}/api/blocks", params={"project_id": sgh["id"], "page_size": 200}, headers=admin_headers, timeout=30
    ).json()["items"]
    blk = next(b for b in blk if not b["name"].startswith("Own-"))  # a real story tower, never a worker's own
    r = requests.post(
        f"{base_url}/api/admin/hard-purge",
        json={"dry_run": True, "block_ids": [blk["id"]]},
        headers=admin_headers,
        timeout=60,
    )
    assert (
        r.status_code == 409
        and r.json()["detail"].startswith("Purge stopped:")
        and "is not test data" in r.json()["detail"]
    )
    with open(PURGE_SCAN_FILE) as fh:  # dry run taken by conftest on the untouched story snapshot (Q-4)
        dry = json.load(fh)
    assert dry["dry_run"] is True and not dry["counts"], dry["counts"]
