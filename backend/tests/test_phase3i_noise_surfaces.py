"""Phase 3I guard rail: reminder / letter / message / notification writes no longer mark read models (fix for the
reminder catch-up job retiring every cache). Every surface that SHOWS them must still be right on the next read, on
BOTH servers: a second backend process on the same test database reads after each write on the first."""

import os
import subprocess
import sys
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

from tests.conftest import BASE, BYPASS_TOKEN, TEST_DB, TEST_PORT

PORT2 = TEST_PORT + 7
B2 = f"http://127.0.0.1:{PORT2}"


@pytest.fixture(scope="module")
def second_server():
    env = {
        **os.environ,
        "DB_NAME": TEST_DB,
        "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS_TOKEN,
        "KKT_ROLE": "test",
        "BACKUP_ENABLED": "0",
        "DEMO_AUTO_REFRESH": "false",
        "KKT_NO_SCHEDULER": "1",
    }
    with open("/tmp/kkt_test_backend2.log", "w") as log:
        p = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT2)],
            cwd=os.path.join(os.path.dirname(__file__), ".."),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    try:
        for _ in range(120):
            try:
                if requests.get(f"{B2}/api/health", timeout=2).status_code == 200:
                    break
            except requests.exceptions.RequestException:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("second backend did not start: /tmp/kkt_test_backend2.log")
        yield B2
    finally:
        p.kill()


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(os.environ["MONGO_URL"])[TEST_DB]


def _get(base, path, h, **params):
    r = requests.get(f"{base}/api{path}", headers=h, params=params or None, timeout=90)
    assert r.status_code == 200, (base, path, r.status_code, r.text[:200])
    return r.json()


def _both(second, path, h, **params):
    return [_get(b, path, h, **params) for b in (BASE, second)]


def test_reminder_sent_shows_in_bills_raised_on_both_servers(admin_headers, work_booking, mongo, second_server):
    d = mongo.demands.find_one({"booking_id": work_booking["id"], "voided": {"$ne": True}}, {"_id": 0, "id": 1})
    q = {"customer": work_booking["booking_number"], "include_void": "false"}

    def row(reg):
        return next(
            r
            for g in reg["groups"]
            for p in g["projects"]
            for t in p["towers"]
            for r in t["rows"]
            if r["id"] == d["id"]
        )

    _both(second_server, "/demands/register", admin_headers, **q)  # both caches warm
    r = requests.post(f"{BASE}/api/demands/{d['id']}/reminder-sent", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text[:200]
    ts = r.json()["reminder_sent_at"]
    for reg in _both(second_server, "/demands/register", admin_headers, **q):
        assert row(reg)["reminder_sent_at"] == ts


def test_generated_letter_shows_on_booking_page_and_customer_360_on_both_servers(
    admin_headers, work_booking, second_server
):
    bid, cid = work_booking["id"], work_booking["customer_id"]
    _both(second_server, "/docgen/register", admin_headers, booking_id=bid, page_size=100)  # both caches warm
    _both(second_server, f"/customers/{cid}/panels", admin_headers)
    r = requests.post(
        f"{BASE}/api/docgen/generate", json={"type": "statement", "booking_id": bid}, headers=admin_headers, timeout=60
    )
    assert r.status_code in (200, 201), r.text[:200]
    doc_id = r.json()["id"]
    for reg in _both(second_server, "/docgen/register", admin_headers, booking_id=bid, page_size=100):
        assert doc_id in [i["id"] for i in reg["items"]]  # booking page "Letters & documents"
    for panels in _both(second_server, f"/customers/{cid}/panels", admin_headers):
        assert doc_id in [g["id"] for g in panels["generated_documents"]["items"]]


@pytest.mark.load_sensitive  # unread counts read on two servers: no other worker may notify between the reads
def test_notification_bell_counts_on_both_servers(admin_headers, mongo, second_server):
    me = _get(BASE, "/auth/me", admin_headers)
    before = [x["unread"] for x in _both(second_server, "/notifications/unread-count", admin_headers)]
    nid = f"t3i-{uuid.uuid4().hex[:8]}"
    mongo.notifications.insert_one(  # what the overdue / reminder jobs write
        {"id": nid, "user_id": me["id"], "read": False, "title": "3I noise check", "created_at": "2099-01-01T00:00:00"}
    )
    try:
        assert [x["unread"] for x in _both(second_server, "/notifications/unread-count", admin_headers)] == [
            n + 1 for n in before
        ]
        for lst in _both(second_server, "/notifications", admin_headers, limit=5):
            assert lst["items"][0]["id"] == nid
    finally:
        mongo.notifications.delete_one({"id": nid})  # the test's own row only


def test_noise_actions_move_no_figure_but_follow_ups_still_move_the_call_list():
    from reports_v3.registry import REGISTRY
    from routers.reports_v3 import _deps
    from services import stamps, ttlcache

    for a in ("reminder.sent", "reminder.skipped", "document.generated", "message.queued", "notification.read"):
        assert ttlcache._NOISE.match(a), a
    # Call list "last follow-up" comes from the lead's follow-ups (lead.* = leads domain), which the report reads
    assert "leads" in stamps.domains_of("lead.follow_up") and "leads" in _deps(REGISTRY["call-list"])
    # the manual "reminder sent" on a bill is a demand action: it moves the bills / money stamp (Bills raised)
    assert set(stamps.domains_of("demand.reminder_sent")) == {"money", "bills"}
    # Payment behaviour reads bills, ledgers, bounced receipts and waivers — no reminder / letter / message field
    src = open(os.path.join(os.path.dirname(__file__), "..", "reports_v3", "customers2.py")).read()
    body = src[src.index("async def behaviour") : src.index("async def behaviour") + 3000]
    assert not any(w in body for w in ("reminder", "communications", "messages", "generated_documents"))
