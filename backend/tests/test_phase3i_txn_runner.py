"""3I REQ-379: the one transaction runner + session discipline by construction + side effects only after commit +
atomic member numbers. Pure-logic checks run in both modes; the session checks need the replica set."""

import asyncio
import os
import uuid

import pytest
from pymongo.errors import OperationFailure

pytestmark = pytest.mark.asyncio(loop_scope="module")  # one loop: the app's motor client is bound to it


def _transient():
    e = OperationFailure("Write conflict during plan execution", 112)
    e._error_labels = {"TransientTransactionError"}
    return e


@pytest.mark.asyncio
async def test_runner_retries_conflict_and_fires_side_effects_once_after_success():
    from services import after_commit
    from uow import transactional

    calls, fired = [], []

    async def letter(items):
        fired.extend(items)

    @transactional
    async def flow():
        calls.append(1)
        await after_commit.defer("letter", letter, f"attempt-{len(calls)}")
        if len(calls) == 1:
            raise _transient()
        return "ok"

    outer = {}
    tok = after_commit.PENDING.set(outer)
    try:
        assert await flow() == "ok"
    finally:
        after_commit.PENDING.reset(tok)
    assert len(calls) == 2
    assert [i for _, (fn, items) in outer.items() for i in items] == ["attempt-2"]  # the aborted attempt's is dropped
    assert fired == []  # nothing ran inside the flow; the request middleware runs it after the response


@pytest.mark.asyncio
async def test_runner_gives_up_and_fires_nothing_when_every_attempt_aborts():
    from services import after_commit
    from uow import TXN_ATTEMPTS, transactional

    fired, n = [], [0]

    async def letter(items):
        fired.extend(items)

    @transactional
    async def flow():
        n[0] += 1
        await after_commit.defer("letter", letter, "x")
        raise _transient()

    with pytest.raises(OperationFailure):
        await flow()  # outside a request: queued work would run inline — but only after success
    assert n[0] == TXN_ATTEMPTS and fired == []


def _rs():
    return "replicaSet" in os.environ.get("MONGO_URL", "")


@pytest.mark.asyncio
async def test_session_discipline_and_atomic_member_numbers(monkeypatch):
    """One test (one event loop for the app's motor client): calls inside a transaction join it without session=,
    strict mode rejects an opt-out, member numbers stay unique under concurrent allocation."""
    from db import db
    from services import member_no, txn_ctx
    from uow import STATE, detect_transaction_support, unit_of_work

    if _rs():
        await detect_transaction_support()
        assert STATE["transactions"]
        k = f"txn-probe-{uuid.uuid4().hex[:8]}"
        with pytest.raises(RuntimeError):
            async with unit_of_work():
                await db.system_checks.insert_one({"name": k})  # no session= : attached from the context
                assert await db.system_checks.find_one({"name": k})  # visible inside the transaction
                raise RuntimeError("abort")
        assert await db.system_checks.find_one({"name": k}) is None  # rolled back with the transaction
        async with unit_of_work():
            await db.system_checks.insert_one({"name": k})
        assert await db.system_checks.find_one({"name": k})
        await db.system_checks.delete_one({"name": k})
        monkeypatch.setattr(txn_ctx, "STRICT", True)
        with pytest.raises(txn_ctx.TxnSessionError):
            async with unit_of_work():
                await db.system_checks.insert_one({"name": "strict-probe"}, session=None)
        assert await db.system_checks.find_one({"name": "strict-probe"}) is None
        monkeypatch.setattr(txn_ctx, "STRICT", False)

    pid = f"mn-{uuid.uuid4().hex[:8]}"
    ids = [f"{pid}-b{i}" for i in range(8)]
    await db.bookings.insert_many(
        [{"id": i, "project_id": pid, "booking_date": "2026-11-19", "booking_number": i} for i in ids],
        bypass_document_validation=True,
    )
    try:
        await asyncio.gather(*(member_no.ensure_member_nos({pid}) for _ in range(4)))
        got = [b["member_no"] async for b in db.bookings.find({"project_id": pid}, {"_id": 0, "member_no": 1})]
        assert len(got) == 8 and len(set(got)) == 8, got
        assert not [r for r in await member_no.duplicates() if r["project"] == pid]
    finally:
        await db.bookings.delete_many({"project_id": pid})
        await db.counters.delete_one({"scope": "member_no", "key": pid})
