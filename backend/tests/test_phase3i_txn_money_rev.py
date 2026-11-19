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
    # a real booking + one of its bills, cloned under new ids so the collection validators accept them
    src = await db.demands.find_one({"voided": False, "status": "Open"}, {"_id": 0})
    bk = await db.bookings.find_one({"id": src["booking_id"]}, {"_id": 0})
    bk |= {"id": bid, "booking_number": f"BK-TXN-{bid[4:]}", "money_rev": 3, "money_snapshot": {"rev": 3, "bills": []}}
    await db.bookings.insert_one(bk)
    await db.demands.insert_one(src | {"id": did, "demand_number": f"DM-TXN-{did[6:]}", "booking_id": bid})
    start = bk["status"]
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
        return b, d, start
    finally:
        await db.bookings.delete_one({"id": bid})
        await db.demands.delete_one({"id": did})
        client.close()


@pytest.mark.parametrize("commit", [False, True])
def test_bill_write_in_transaction_keeps_money_rev_consistent(commit):
    res = asyncio.run(_run(commit))
    if res is None:
        pytest.skip("standalone MongoDB — transactions need a replica set (REQ-379 run)")
    b, d, start = res
    if commit:
        assert d["status"] == "Cancelled" and b["money_rev"] == 5  # bumped before + after the write, in the txn
        assert b["money_snapshot"]["rev"] != b["money_rev"]  # → the snapshot is no longer trusted
    else:
        assert d["status"] == "Open" and b["money_rev"] == 3 and b["status"] == start
        assert b["money_snapshot"]["rev"] == b["money_rev"]  # rollback: still the valid snapshot
