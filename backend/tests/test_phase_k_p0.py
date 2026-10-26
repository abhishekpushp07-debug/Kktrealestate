"""Phase K P0 proofs: job isolation, invariants + concurrency, immutable audit/ledger, durable idempotency branches, cap-headroom warning."""
import asyncio
import os
import sys
import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402


def _sync_db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


_LOOP = asyncio.new_event_loop()


def _run(coro):
    """Motor binds its client to the first loop it sees — keep one loop per process."""
    return _LOOP.run_until_complete(coro)


# ---- 1. job isolation -------------------------------------------------------------------------
def test_poisoned_booking_does_not_stop_dues_run():
    from services import job_runs

    async def go():
        items = [{"id": "ok1"}, {"id": "bad"}, {"id": "ok2"}]
        seen = []

        async def one(b):
            if b["id"] == "bad":
                raise RuntimeError("poisoned")
            seen.append(b["id"])
            return 1

        async def gen():
            for i in items:
                yield i
        return await job_runs.run_isolated("TEST_DUES", gen(), one, item_id=lambda b: b["id"]), seen
    run, seen = _run(go())
    assert seen == ["ok1", "ok2"]
    assert run["status"] == "FAILED" and run["failed_items"] == 1 and run["items"] == 3
    assert run["errors"][0]["item"] == "bad" and "poisoned" in run["errors"][0]["error"]
    _sync_db().job_runs.delete_many({"job": "TEST_DUES"})


def test_sweep_marks_stuck_runs_abandoned_and_health_flags_stale(admin_headers):
    from services import job_runs
    db = _sync_db()
    old = (datetime.now(UTC) - timedelta(hours=3)).isoformat()
    db.job_runs.insert_one({"id": "stuck1", "job": "TEST_STUCK", "started_at": old, "finished_at": None, "status": "RUNNING", "budget_s": 60, "items": 0, "failed_items": 0, "errors": []})
    _run(job_runs.sweep())
    assert db.job_runs.find_one({"id": "stuck1"})["status"] == "ABANDONED"
    h = _run(job_runs.health())
    assert "DAILY_DUES" in h["jobs"] and "NIGHTLY_INTEGRITY" in h["jobs"]
    r = requests.get(f"{BASE}/api/admin/ops", headers=admin_headers)
    assert r.status_code == 200 and "job_runs" in r.json() and "stale" in r.json()["job_runs"]
    db.job_runs.delete_many({"job": "TEST_STUCK"})


# ---- 2. invariants ----------------------------------------------------------------------------
def test_invariant_indexes_and_validators_reject_bad_docs():
    from pymongo.errors import DuplicateKeyError, WriteError
    from services.invariants import ensure_invariants
    _run(ensure_invariants())
    db = _sync_db()
    flat = f"flat-inv-{uuid.uuid4()}"
    base = {"company_id": "c", "project_id": "p", "block_id": "b", "flat_id": flat, "customer_id": "c", "status": "Active", "agreement_value_paise": 100, "cash_agreed_paise": 60, "account_agreed_paise": 40, "version": 1}
    ids = [f"BK-inv-{uuid.uuid4()}" for _ in range(3)]
    try:
        db.bookings.insert_one({**base, "id": ids[0], "booking_number": ids[0]})
        with pytest.raises(DuplicateKeyError):
            db.bookings.insert_one({**base, "id": ids[1], "booking_number": ids[1]})
        with pytest.raises(WriteError):  # split must equal agreement value
            db.bookings.insert_one({**base, "id": ids[2], "booking_number": ids[2], "flat_id": flat + "x", "cash_agreed_paise": 70})
        with pytest.raises(WriteError):  # payments amount > 0
            db.payments.insert_one({"id": ids[2], "company_id": "c", "booking_id": "b", "receipt_number": "R", "amount_paise": 0, "status": "Cleared", "against": "FLAT_VALUE", "payment_category": "Cash", "payment_date": "2026-01-01", "idempotency_key": ids[2], "version": 1})
        with pytest.raises(WriteError):  # demands non-negative
            db.demands.insert_one({"id": ids[2], "company_id": "c", "booking_id": "b", "installment_seq": 1, "demand_number": "DM-X", "cash_demand_paise": -5, "account_demand_paise": 0, "total_demand_paise": -5, "status": "Open", "voided": False})
    finally:
        db.bookings.delete_many({"id": {"$in": ids}})
        db.payments.delete_many({"id": {"$in": ids}})
        db.demands.delete_many({"id": {"$in": ids}})


def test_twenty_parallel_bookings_on_one_flat_exactly_one_wins():
    from pymongo.errors import DuplicateKeyError
    db = _sync_db()
    flat = f"flat-race-{uuid.uuid4()}"
    ids = [f"BK-race-{uuid.uuid4()}" for _ in range(20)]
    wins = []
    barrier = threading.Barrier(20)

    def go(i):
        barrier.wait()
        try:
            db.bookings.insert_one({"id": ids[i], "booking_number": ids[i], "company_id": "c", "project_id": "p", "block_id": "b", "flat_id": flat, "customer_id": "c", "status": "Active", "agreement_value_paise": 10, "cash_agreed_paise": 10, "account_agreed_paise": 0, "version": 1})
            wins.append(i)
        except DuplicateKeyError:
            pass
    ts = [threading.Thread(target=go, args=(i,)) for i in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    try:
        assert len(wins) == 1
    finally:
        db.bookings.delete_many({"id": {"$in": ids}})


# ---- 3. immutable audit / ledger --------------------------------------------------------------
def test_app_connection_cannot_update_or_delete_audit_rows():
    from db import db
    from services.immutable import ImmutableError

    async def go():
        aid = f"aud-{uuid.uuid4()}"
        await db.audit_logs.insert_one({"id": aid, "action": "test", "entity_type": "x", "entity_id": "y", "created_at": datetime.now(UTC).isoformat()})
        with pytest.raises(ImmutableError):
            await db.audit_logs.update_one({"id": aid}, {"$set": {"action": "tampered"}})
        with pytest.raises(ImmutableError):
            await db.audit_logs.delete_one({"id": aid})
        with pytest.raises(ImmutableError):
            await db.ledger_entries.update_many({"booking_id": "none"}, {"$set": {"amount_paise": 0}})
        with pytest.raises(ImmutableError):
            await db.ledger_entries.delete_many({"booking_id": "none"})
        await db.audit_logs.update_one({"id": aid}, {"$set": {"propagated": True}})  # metadata allow-list
        await db.audit_logs.raw("test cleanup").delete_one({"id": aid})
    _run(go())


# ---- 4. durable idempotency ---------------------------------------------------------------------
def _cust(phone=None):
    return {"full_name": "Idem K", "phone": phone or f"97{uuid.uuid4().int % 10**8:08d}", "salutation": "Mr"}


def test_idempotency_mismatch_and_reuse(admin_headers):
    key = f"k-{uuid.uuid4()}"
    h = {**admin_headers, "Idempotency-Key": key}
    body = _cust()
    r1 = requests.post(f"{BASE}/api/customers", json=body, headers=h)
    assert r1.status_code in (200, 201), r1.text
    r2 = requests.post(f"{BASE}/api/customers", json={**body, "full_name": "Other"}, headers=h)
    assert r2.status_code == 422 and r2.json()["code"] == "IDEMPOTENCY_MISMATCH"
    r3 = requests.post(f"{BASE}/api/customers/{r1.json()['id']}/notes", json=body, headers=h)
    assert r3.status_code == 422 and r3.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    r4 = requests.post(f"{BASE}/api/customers", json=body, headers=h)
    assert r4.status_code == r1.status_code and r4.headers.get("Idempotent-Replayed") == "true"
    requests.delete(f"{BASE}/api/customers/{r1.json()['id']}", headers=admin_headers)


def test_idempotency_in_progress_and_abandoned_claim(admin_headers):
    db = _sync_db()
    import jwt
    owner = jwt.decode(admin_headers["Authorization"][7:], options={"verify_signature": False})["sub"]
    key = f"k-{uuid.uuid4()}"
    body = _cust()
    import hashlib
    import json
    raw = json.dumps(body).encode()
    bh = hashlib.sha256(raw).hexdigest()
    now = datetime.now(UTC)
    db.idempotency_claims.insert_one({"owner": owner, "key": key, "path": "/api/customers", "body_hash": bh, "state": "in_progress", "created_at": now, "updated_at": now})
    r = requests.post(f"{BASE}/api/customers", data=raw, headers={**admin_headers, "Idempotency-Key": key, "Content-Type": "application/json"})
    assert r.status_code == 409 and r.json()["code"] == "IDEMPOTENCY_IN_PROGRESS" and r.headers.get("Retry-After") == "2"
    db.idempotency_claims.update_one({"owner": owner, "key": key}, {"$set": {"updated_at": now - timedelta(seconds=90)}})  # abandoned → taken over
    r = requests.post(f"{BASE}/api/customers", data=raw, headers={**admin_headers, "Idempotency-Key": key, "Content-Type": "application/json"})
    assert r.status_code in (200, 201), r.text
    assert db.idempotency_claims.find_one({"owner": owner, "key": key})["state"] == "done"
    requests.delete(f"{BASE}/api/customers/{r.json()['id']}", headers=admin_headers)


def test_idempotency_concurrent_duplicates_create_once(admin_headers):
    key = f"k-{uuid.uuid4()}"
    body = _cust()
    h = {**admin_headers, "Idempotency-Key": key}
    out = []
    barrier = threading.Barrier(5)

    def go():
        barrier.wait()
        out.append(requests.post(f"{BASE}/api/customers", json=body, headers=h))
    ts = [threading.Thread(target=go) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    codes = sorted(r.status_code for r in out)
    assert codes[0] in (200, 201) and all(c in (200, 201, 409) for c in codes), codes
    ids = {r.json().get("id") for r in out if r.status_code in (200, 201)}
    assert len(ids) == 1
    assert _sync_db().customers.count_documents({"phone": {"$regex": body["phone"] + "$"}}) == 1
    requests.delete(f"{BASE}/api/customers/{ids.pop()}", headers=admin_headers)


def test_idempotency_secret_replay_rejected(admin_headers):
    db = _sync_db()
    import jwt
    owner = jwt.decode(admin_headers["Authorization"][7:], options={"verify_signature": False})["sub"]
    key = f"k-{uuid.uuid4()}"
    import hashlib
    raw = b'{"x":1}'
    now = datetime.now(UTC)
    db.idempotency_claims.insert_one({"owner": owner, "key": key, "path": "/api/customers", "body_hash": hashlib.sha256(raw).hexdigest(), "state": "done", "status": 201, "body": "", "secret_redacted": True, "created_at": now, "updated_at": now})
    r = requests.post(f"{BASE}/api/customers", data=raw, headers={**admin_headers, "Idempotency-Key": key, "Content-Type": "application/json"})
    assert r.status_code == 409 and r.json()["code"] == "IDEMPOTENT_SECRET_REPLAY"
    db.idempotency_claims.delete_one({"owner": owner, "key": key})


# ---- 6. cap headroom warning --------------------------------------------------------------------
def test_pending_cheque_headroom_warning(admin_headers, anchor_booking):
    db = _sync_db()
    b = db.bookings.find_one({"id": anchor_booking["id"]})
    cleared = sum(p["amount_paise"] for p in db.payments.find({"booking_id": b["id"], "against": "FLAT_VALUE", "payment_category": "Cash", "status": "Cleared"}))
    headroom = b["cash_agreed_paise"] - cleared
    assert headroom > 0, "anchor booking has no cash headroom; pick another"
    amt = headroom // 100 * 0.6  # each cheque fits the cleared cap; both together exceed it → warning, not a block
    modes = {m["code"]: m["id"] for m in requests.get(f"{BASE}/api/master/payment-modes?page_size=50", headers=admin_headers).json()["items"]}
    bank = requests.get(f"{BASE}/api/master/bank-accounts", headers=admin_headers).json()["items"][0]
    r = requests.post(f"{BASE}/api/payments", headers={**admin_headers, "Idempotency-Key": f"k-{uuid.uuid4()}"},
                      json={"booking_id": b["id"], "amount": amt, "payment_category": "Cash", "payment_date": datetime.now().date().isoformat(), "payment_mode_id": modes["CHEQUE"], "bank_account_id": bank["id"],
                            "instrument": {"number": "999001", "date": datetime.now().date().isoformat(), "bank_name": "Test Bank"}})
    assert r.status_code in (200, 201), r.text
    first = r.json()
    assert first["status"] == "Pending" and first["warnings"] == []
    r2 = requests.post(f"{BASE}/api/payments", headers={**admin_headers, "Idempotency-Key": f"k-{uuid.uuid4()}"},
                       json={"booking_id": b["id"], "amount": amt, "payment_category": "Cash", "payment_date": datetime.now().date().isoformat(), "payment_mode_id": modes["CHEQUE"], "bank_account_id": bank["id"],
                             "instrument": {"number": "999002", "date": datetime.now().date().isoformat(), "bank_name": "Test Bank"}})
    assert r2.status_code in (200, 201), r2.text
    j = r2.json()
    try:
        assert j["status"] == "Pending"
        assert any(w["code"] == "PENDING_WOULD_EXCEED_CAP" for w in j["warnings"]), j
    finally:
        for pid in (first["id"], j["id"]):
            db.payments.delete_one({"id": pid})
            db.ledger_entries.delete_many({"source_id": pid})
