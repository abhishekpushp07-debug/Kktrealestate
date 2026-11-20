"""Phase 3 (REQ-116/117): the preconditions of the booking actions, used by the action handlers themselves and by
GET /bookings/{id}/actions so "More" shows a not-allowed action disabled with the server's own reason."""

from db import db
from permissions import canonical


async def pending_cheques(booking_id: str) -> int:
    return await db.payments.count_documents({"booking_id": booking_id, "status": "Pending"})


async def plan_locked(booking_id: str) -> bool:
    q = {"booking_id": booking_id, "voided": {"$ne": True}, "paid_paise": {"$gt": 0}}
    return bool(await db.demands.count_documents(q))


async def refund_due(booking_id: str) -> dict | None:
    return await db.refunds.find_one(
        {"booking_id": booking_id, "status": "Pending", "parent_refund_id": None}, {"_id": 0, "id": 1}
    )


ACTIONS = {  # action → permission of its POST handler
    "record_payment": "finance.payment.create",
    "agreement_signed": "sales.booking.create",
    "revise": "sales.agreement.revise",
    "change_plan": "masters.payment_plan.assign",
    "transfer": "sales.booking.transfer",
    "cancel": "sales.booking.cancel",
    "handover": "sales.booking.edit",
    "pay_refund": "finance.refund.pay",
    "print": "sales.booking.view",
}


async def action_reasons(b: dict, user: dict, plans_for_tower: int) -> dict:
    """{action: None when allowed, else the reason the server would refuse it}."""
    bid, active = b["id"], b["status"] == "Active"
    pending = await pending_cheques(bid) if active else 0
    not_active = f"Booking is {b['status']}"
    rules = {
        "record_payment": None if active else not_active,
        "agreement_signed": (
            not_active
            if not active
            else "Agreement already marked signed"
            if (b.get("plan_acceptance") or {}).get("marked_at")
            else None
        ),
        "correct_signed": (
            "The agreement is not marked signed yet"
            if not (b.get("plan_acceptance") or {}).get("marked_at")
            else None
            if user.get("role_name") in ("Super Admin", "Admin")
            else "Only the owner or an admin can correct the signed date"
        ),
        "revise": None if active else not_active,
        "change_plan": (
            not_active
            if not active
            else "A bill on this booking is already paid — plan cannot be changed"
            if await plan_locked(bid)
            else "Only one payment plan is assigned to this tower"
            if plans_for_tower < 2
            else None
        ),
        "transfer": not_active if not active else ("Clear or bounce pending cheques first" if pending else None),
        "cancel": not_active if not active else ("Clear or bounce pending cheques first" if pending else None),
        "handover": not_active if not active else None,
        "pay_refund": None if (not active and await refund_due(bid)) else "No refund is due",
        "print": None,
    }
    perms = set(user["permissions"])
    for a, code in ACTIONS.items():
        if canonical(code) not in perms:
            rules[a] = "You don't have permission for this"
    return rules
