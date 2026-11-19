"""Phase 3I REQ-379 + REQ-355: a bill write inside a transaction (cancel / transfer / refund use one) bumps the booking's
money_rev inside the same session — an aborted transaction leaves bill and rev untouched; a committed one moves both."""

import asyncio
import os
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from services.money_snapshot import DemandsCollection


async def _run(commit: bool):
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    hello = await client.admin.command("hello")
    if not hello.get("setName"):
        client.close()
        return None
    db = client[os.environ["DB_NAME"]]
    bid, did = f"txn-{uuid.uuid4().hex[:8]}", f"txn-d-{uuid.uuid4().hex[:8]}"
    await db.bookings.insert_one(
        {"id": bid, "booking_number": f"TXN-{bid}", "money_rev": 3, "money_snapshot": {"rev": 3, "bills": []}}
    )
    await db.demands.insert_one(
        {"id": did, "demand_number": f"TXN-{did}", "booking_id": bid, "status": "Open", "paid_paise": 0}
    )
    dem = DemandsCollection(db.demands, db)
    try:
        async with await client.start_session() as s:
            s.start_transaction()
            await db.bookings.update_one(
                {"id": bid}, {"$set": {"status": "Cancelled"}}, session=s
            )  # the txn's own write
            await dem.update_one({"id": did}, {"$set": {"status": "Cancelled"}}, session=s)
            if commit:
                await s.commit_transaction()
            else:
                await s.abort_transaction()
        b = await db.bookings.find_one({"id": bid})
        d = await db.demands.find_one({"id": did})
        return b, d
    finally:
        await db.bookings.delete_one({"id": bid})
        await db.demands.delete_one({"id": did})
        client.close()


@pytest.mark.parametrize("commit", [False, True])
def test_bill_write_in_transaction_keeps_money_rev_consistent(commit):
    res = asyncio.run(_run(commit))
    if res is None:
        pytest.skip("standalone MongoDB — transactions need a replica set (REQ-379 run)")
    b, d = res
    if commit:
        assert d["status"] == "Cancelled" and b["money_rev"] == 5  # bumped before + after the write, in the txn
        assert b["money_snapshot"]["rev"] != b["money_rev"]  # → the snapshot is no longer trusted
    else:
        assert d["status"] == "Open" and b["money_rev"] == 3 and b.get("status") is None
        assert b["money_snapshot"]["rev"] == b["money_rev"]  # rollback: still the valid snapshot
