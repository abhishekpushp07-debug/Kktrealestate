"""Story anchors found by role, never by number (numbers only go up across rebuilds — REQ-28)."""

import functools
import os

from pymongo import MongoClient


@functools.lru_cache(maxsize=None)
def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@functools.lru_cache(maxsize=None)
def bk(role: str) -> str:
    """Booking number of a story role: "first"/"second" = first two story bookings, else remarks `story:<role>`."""
    if role in ("first", "second"):  # the two portal personas (first two story buyers)
        name = "Amit Kumar Sinha" if role == "first" else "Priya Verma"
        c = _db().customers.find_one({"full_name": name}, {"_id": 0, "id": 1}, sort=[("created_at", 1)])
        b = c and _db().bookings.find_one({"customer_id": c["id"]}, {"_id": 0, "booking_number": 1})
    else:
        b = _db().bookings.find_one({"remarks": {"$regex": f"^story:{role}( |$|—)"}}, {"_id": 0, "booking_number": 1})
    assert b, f"story role {role} not found"
    return b["booking_number"]


@functools.lru_cache(maxsize=None)
def sr_new() -> str:
    """Ticket number of the story ticket that stays New: the first one, "Payment query — <first story booking>" (story_seed flow 0)."""
    s = _db().service_requests.find_one(
        {"subject": f"Payment query — {bk('first')}", "description": {"$regex": "^story:"}, "status": "New"},
        {"_id": 0, "ticket_number": 1},
    )
    assert s, "story ticket in New not found"
    return s["ticket_number"]


@functools.lru_cache(maxsize=None)
def cust(role: str) -> str:
    b = _db().bookings.find_one({"booking_number": bk(role)}, {"_id": 0, "customer_id": 1})
    return _db().customers.find_one({"id": b["customer_id"]}, {"_id": 0, "customer_code": 1})["customer_code"]
