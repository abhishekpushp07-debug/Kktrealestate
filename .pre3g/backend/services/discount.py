"""REQ-235…242 Discount given: list price (the flat's own priced value from services.pricing, stored on the flat and in the
booking's flat_snapshot) − agreed total (Cash + Account). A record only — it never feeds agreement, shares, bills, GST or
the ledger. Parking and other charges are billed at their own agreed amounts and are outside the agreement value."""

from services import clock
from utils import now_iso

NOT_RECORDED = {"status": "not_recorded", "note": "List price not set — discount not recorded"}


def snapshot(
    flat_snap: dict,
    agreed_paise: int,
    reason: str | None,
    sales_user_id: str | None,
    user: dict | None,
    on: str,
    backfilled: bool = False,
) -> dict:
    lst = flat_snap.get("price_paise")
    if not lst:
        return dict(NOT_RECORDED)
    amt = lst - agreed_paise
    return {
        "status": "recorded",
        "kind": "discount" if amt > 0 else ("none" if amt == 0 else "above list"),
        "list_paise": lst,
        "list_breakup": flat_snap.get("price_breakup") or [],
        "agreed_paise": agreed_paise,
        "amount_paise": amt,
        "percent": round(100 * amt / lst, 2),
        "reason": (reason or "").strip() or None,
        "sales_user_id": sales_user_id,
        "recorded_by": (user or {}).get("id"),
        "recorded_by_name": (user or {}).get("name") or ("back-fill" if backfilled else None),
        "on": on,
        "recorded_at": now_iso(),
        **({"backfilled": True} if backfilled else {}),
    }


def revision_event(before_paise: int, after_paise: int, reason: str, user: dict | None, at: str | None = None) -> dict:
    """Revise agreement: lower = "discount on revision", higher = "price increase" (amount is the change, ₹ down > 0)."""
    down = before_paise - after_paise
    return {
        "kind": "discount on revision" if down > 0 else "price increase",
        "before_paise": before_paise,
        "after_paise": after_paise,
        "amount_paise": down,
        "reason": reason,
        "by": (user or {}).get("id"),
        "by_name": (user or {}).get("name"),
        "on": clock.day_of(at) if at else clock.today().isoformat(),
    }


def total_given(b: dict) -> int:
    """Discount given today = list − current agreed (at booking + every revision since)."""
    d = b.get("discount") or {}
    if d.get("status") != "recorded":
        return 0
    return d["list_paise"] - b["agreement_value_paise"]


async def backfill(dbx, write: bool = True) -> dict:
    """REQ-242: exact back-fill only where the booking's own flat_snapshot price exists; else "discount not recorded".
    Idempotent (skips bookings that already carry a discount); never touches a money field."""
    out = {"bookings": 0, "recorded": 0, "not_recorded": 0, "skipped": 0, "revision_events": 0}
    async for b in dbx.bookings.find({}, {"_id": 0}):
        out["bookings"] += 1
        if b.get("discount"):
            out["skipped"] += 1
            continue
        revs = b.get("agreement_revisions") or []
        first = revs[0]["before"]["agreement_value_paise"] if revs else b["agreement_value_paise"]
        d = snapshot(
            b.get("flat_snapshot") or {},
            first,
            None,
            b.get("sales_user_id"),
            None,
            clock.day_of(b["booking_date"]) if "T" in str(b.get("booking_date")) else str(b.get("booking_date")),
            backfilled=True,
        )
        ev = [
            revision_event(
                r["before"]["agreement_value_paise"],
                r["after"]["agreement_value_paise"],
                r["reason"],
                {"id": r.get("by"), "name": r.get("by_name")},
                r.get("at"),
            )
            for r in revs
        ]
        out["recorded" if d["status"] == "recorded" else "not_recorded"] += 1
        out["revision_events"] += len(ev)
        if write:
            await dbx.bookings.update_one(
                {"id": b["id"], "discount": None}, {"$set": {"discount": d, "discount_events": ev}}
            )
    return out
