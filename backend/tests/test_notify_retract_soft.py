"""retract(): unread rows are soft-retracted (withdrawn + retracted, hidden, out of unread counts), never deleted. Startup sweep soft too."""
import asyncio
import os
import sys
import uuid

import pytest
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
TEST_DB = os.environ.get("KKT_TEST_DB", "kkt_test")


@pytest.fixture
def seeded():
    cli = MongoClient(os.environ["MONGO_URL"])
    coll = cli[TEST_DB].notifications
    uid, tag = f"test:{uuid.uuid4().hex[:8]}", uuid.uuid4().hex
    rows = [{"id": uuid.uuid4().hex, "user_id": uid, "kind": "demand.raised", "type": "demand.raised", "title": "t", "body": f"D {tag}", "read": r,
             "entity_type": "demand", "entity_id": tag, "created_at": "2026-01-01T00:00:00Z"} for r in (False, True)]
    coll.insert_many([dict(r) for r in rows])
    yield coll, uid, tag
    coll.delete_many({"user_id": uid})


def test_retract_is_soft_and_hidden(seeded):
    coll, uid, tag = seeded
    os.environ["DB_NAME"] = TEST_DB
    from services.portal_notify import retract
    async def go():
        from db import client
        client.get_io_loop = asyncio.get_running_loop
        return await retract({"entity_type": "demand", "entity_id": tag}), await retract({"entity_type": "demand", "entity_id": tag})
    res, again = asyncio.run(go())
    assert res == {"deleted": 1, "withdrawn": 1}
    assert again == {"deleted": 0, "withdrawn": 0}, "idempotent"
    assert coll.count_documents({"user_id": uid}) == 2, "nothing is deleted"
    unread = coll.find_one({"user_id": uid, "read": False}, {"_id": 0})
    assert unread["withdrawn"] is True and unread["retracted"] is True and unread["retracted_at"] and unread["reason"] == "entity_voided"
    read = coll.find_one({"user_id": uid, "read": True}, {"_id": 0})
    assert read["withdrawn"] is True and read["body"].endswith("(withdrawn)") and "retracted" not in read
    assert coll.count_documents({"user_id": uid, "read": False, "withdrawn": {"$ne": True}}) == 0, "unread-count query excludes retracted"


def test_module_has_no_hard_deletes():
    src = open(os.path.join(os.path.dirname(__file__), "..", "services", "portal_notify.py")).read()
    assert "delete_one" not in src and "delete_many" not in src
