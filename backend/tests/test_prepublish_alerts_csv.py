"""Pre-publish: alert acknowledge (audited, Super Admin) + self-clear after next OK run; CSV money cells as plain numbers."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pymongo import MongoClient  # noqa: E402

from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def test_csv_money_cells_are_plain_numbers():
    from utils import to_csv
    out = to_csv([{"amount": 116197548.0, "due": 1234.5, "pct": 12.345, "name": "x"}])
    row = out.splitlines()[1]
    assert row == "116197548,1234.50,12.35,x", row
    assert ".0" not in row.split(",")[0]


def test_job_failed_alert_self_clears_after_ok_run_and_can_be_acknowledged(admin_headers):
    now = datetime.now(timezone.utc)
    job = f"TEST_JOB_{uuid.uuid4().hex[:6]}"
    mongo.job_runs.insert_one({"id": uuid.uuid4().hex, "job": job, "status": "ABANDONED", "started_at": (now - timedelta(hours=2)).isoformat(), "finished_at": (now - timedelta(hours=1)).isoformat(), "items": 0, "failed_items": 0, "errors": []})
    r = requests.post(f"{BASE}/api/admin/alerts/job_failed/ack", json={"note": "one-off: process restart during backup"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    fp = r.json()["ack"]["fingerprint"]
    assert job in fp, fp  # the failed job is what the rule looked at
    assert mongo.audit_logs.find_one({"action": "alert.acknowledge", "entity_id": "job_failed"})
    assert requests.post(f"{BASE}/api/admin/alerts/nope/ack", json={}, headers=admin_headers).status_code == 404
    # the next OK run of that job clears the condition itself (fingerprint no longer contains the job)
    mongo.job_runs.insert_one({"id": uuid.uuid4().hex, "job": job, "status": "OK", "started_at": now.isoformat(), "finished_at": now.isoformat(), "items": 1, "failed_items": 0, "errors": []})
    fp2 = requests.post(f"{BASE}/api/admin/alerts/job_failed/ack", json={}, headers=admin_headers).json()["ack"]["fingerprint"]
    assert job not in fp2, fp2
    mongo.job_runs.delete_many({"job": job})
