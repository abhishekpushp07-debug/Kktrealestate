"""Phase 3I — M-09 durable auto letters + M-06 archive of login records / read notifications (moved, never deleted)."""

import json
import os
import subprocess
import sys
import uuid
from datetime import date, timedelta

import pytest
import requests
from pymongo import MongoClient

from tests.conftest import BASE

API = f"{BASE}/api"


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_undone_letter_marker_is_replayed_once(mongo):
    bid, did = f"lq-{uuid.uuid4().hex[:8]}", f"lq-d-{uuid.uuid4().hex[:8]}"
    mongo.letter_queue.insert_one(
        {
            "booking_id": bid,
            "demand_ids": [did],
            "actor": {"id": "t"},
            "created_at": "2020-01-01T00:00:00+00:00",
            "done_at": None,
        }
    )
    # a fresh process (motor binds to one event loop), as the sweep of a restarted server would be
    script = f"""
import asyncio, json, sys
sys.path.insert(0, ".")
from services import letter_queue
calls = []
async def fake(bid, kinds, actor, demand_ids=None):
    calls.append([bid, list(demand_ids)])
async def go():
    await letter_queue.reconcile(fake, 60, 500)
    await letter_queue.reconcile(fake, 60, 500)
asyncio.run(go())
print(json.dumps([c for c in calls if c[0] == "{bid}"]))
"""
    out = subprocess.run(
        [sys.executable, "-c", script],
        cwd=os.path.join(os.path.dirname(__file__), ".."),
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ},
    )
    assert out.returncode == 0, out.stderr[-1500:]
    assert json.loads(out.stdout.strip().splitlines()[-1]) == [[bid, [did]]]
    row = mongo.letter_queue.find_one({"booking_id": bid})
    assert row["done_at"] and row["replayed"] is True


def test_old_login_records_and_read_notifications_move_to_archive(admin_headers, mongo):
    old_at = (date.today() - timedelta(days=30 * 30)).isoformat() + "T10:00:00+00:00"
    lid, nid, uid = (f"arch3i-{x}-{uuid.uuid4().hex[:6]}" for x in ("l", "n", "u"))
    mongo.login_events.insert_one({"id": lid, "email": "x@kkt.in", "success": True, "created_at": old_at})
    mongo.notifications.insert_one({"id": nid, "read": True, "title": "old", "created_at": old_at})
    mongo.notifications.insert_one({"id": uid, "read": False, "title": "old unread", "created_at": old_at})
    r = requests.post(f"{API}/admin/audit/archive", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text[:200]
    assert not mongo.login_events.find_one({"id": lid}) and mongo.login_events_archive.find_one({"id": lid})
    assert not mongo.notifications.find_one({"id": nid}) and mongo.notifications_archive.find_one({"id": nid})
    assert mongo.notifications.find_one({"id": uid})  # unread stays where it is seen
