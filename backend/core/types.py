"""Leaf: ids, timestamps and the base document shape. Depends only on services.clock."""
import uuid

from services import clock


def now_iso() -> str:
    return clock.now().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def base_doc(user: dict | None, company_id: str) -> dict:
    ts = now_iso()
    return {"id": new_id(), "company_id": company_id, "created_at": ts, "updated_at": ts,
            "created_by": user["id"] if user else "system", "is_active": True, "deleted_at": None, "version": 1}
