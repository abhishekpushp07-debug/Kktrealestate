"""Phase Q: /api/trends — monthly series from the monthly_buckets read model."""
from fastapi import APIRouter, Depends, Query

from db import db
from deps import ensure_project_access, require_any
from services import trends
from utils import ApiError

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("")
async def get_trends(scope: str = Query("company", pattern="^(company|project|customer)$"), id: str | None = None, months: int = Query(12, ge=3, le=36),
                     user: dict = Depends(require_any("reports.collections.view", "sales.customer.view"))):
    """Per-month: collections (received cleared), demands (bills raised), outstanding_eom, bookings. Σ collections == Collections report for the same range."""
    if scope != "company" and not id:
        raise ApiError(422, "id is required for project/customer scope", "VALIDATION_ERROR")
    if scope == "project":
        ensure_project_access(user, id)
    if scope == "customer" and not await db.customers.find_one({"id": id, "company_id": user["company_id"]}, {"_id": 0, "id": 1}):
        raise ApiError(404, "Customer not found", "NOT_FOUND")
    return {"scope": scope, "id": id, **(await trends.get(user["company_id"], scope, id, months))}
