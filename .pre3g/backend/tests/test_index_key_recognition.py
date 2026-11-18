"""Startup index creation recognises an existing index by key (older ad-hoc name) instead of warning 'already exists with a different name'."""

import asyncio
import logging
import os

from motor.motor_asyncio import AsyncIOMotorClient

from db import _ci, _safe_index


def test_existing_index_recognised_by_key(caplog):
    async def run():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        coll = cl[os.environ["DB_NAME"]]["_ix_probe"]
        await coll.drop()
        await coll.create_index([("booking_id", 1), ("seq", 1)], name="booking_id_1_seq_1")
        with caplog.at_level(logging.INFO):
            await _ci(coll, [("booking_id", 1), ("seq", 1)], name="booking_seq")
            await _safe_index(coll, [("booking_id", 1), ("seq", 1)], "booking_seq")
            await _ci(coll, [("other", 1)], name="other_1")
        names = set((await coll.index_information()).keys())
        await coll.drop()
        cl.close()
        return names

    names = asyncio.new_event_loop().run_until_complete(run())
    assert "booking_id_1_seq_1" in names and "booking_seq" not in names and "other_1" in names
    assert "skipped" not in caplog.text
