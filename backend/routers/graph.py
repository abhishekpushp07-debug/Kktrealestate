"""Phase X.4 — Connected-to graph: `GET /api/graph/{entity}/{id}` returns the relationship map of one record (counts + ids for deep
links). Permission-shaped: sections the user cannot view are omitted; flats are masked through services.inventory.shape; booking_id is
never leaked to non-privileged users. Batched reads only (one query per collection; `$in`/aggregate, no N+1)."""
import asyncio
from typing import Literal

from fastapi import APIRouter, Depends

from db import db
from deps import ensure_project_access, project_scope_filter, require_any
from services import inventory as inv
from services.money import present_money
from utils import ApiError, get_or_404

router = APIRouter(prefix="/graph", tags=["graph"])
Entity = Literal["project", "block", "tower", "flat", "customer", "booking", "stage_plan", "payment_plan", "demand", "payment", "document"]
LIMIT = 25
P = {"project": "masters.project.view", "block": "masters.project.view", "flat": "masters.flat.view", "customer": "sales.customer.view", "booking": "sales.booking.view",
     "stage_plan": "masters.stage_plan.view", "payment_plan": "masters.payment_plan.view", "demand": "demands.register.view", "payment": "finance.payment.view", "document": "documents.document.view"}
COLL = {"project": db.projects, "block": db.blocks, "flat": db.flats, "customer": db.customers, "booking": db.bookings, "stage_plan": db.construction_stage_plans,
        "payment_plan": db.payment_plans, "demand": db.demands, "payment": db.payments, "document": db.documents}
ROUTE = {"project": "/projects/{id}", "block": "/blocks/{id}", "flat": "/blocks/{block_id}?flat={id}", "customer": "/customers/{id}", "booking": "/bookings/{id}", "stage_plan": "/master/stage-plans?project_id={project_id}",
         "payment_plan": "/master/payment-plans?project_id={project_id}", "demand": "/demands?booking_id={booking_id}", "payment": "/payments?q={id}", "document": "/documents?entity_type={entity_type}&entity_id={entity_id}"}
LABEL = {"project": "name", "block": "name", "flat": "flat_number", "customer": "name", "booking": "booking_number", "stage_plan": "name", "payment_plan": "name", "demand": "demand_number", "payment": "receipt_number", "document": "file_name"}


def _node(kind: str, d: dict) -> dict:
    return {"kind": kind, "id": d["id"], "label": d.get(LABEL[kind]) or d.get("name") or d["id"][:8], "status": d.get("status"),
            "to": ROUTE[kind].format(id=d["id"], block_id=d.get("block_id"), project_id=d.get("project_id") or "", booking_id=d.get("booking_id") or "", entity_type=d.get("entity_type") or "", entity_id=d.get("entity_id") or "")}


async def _section(kind: str, user: dict, q: dict, extra_fields: tuple = (), sort=None) -> dict | None:
    if P[kind] not in user["permissions"]:
        return None
    coll = COLL[kind]
    scoped = {**q, **({"company_id": user["company_id"]} if kind != "flat" else {"company_id": user["company_id"]})}
    if kind not in ("document",):
        scoped.update(project_scope_filter(user))
    proj = {"_id": 0, "id": 1, "status": 1, "project_id": 1, "block_id": 1, "booking_id": 1, "entity_type": 1, "entity_id": 1, LABEL[kind]: 1, **{f: 1 for f in extra_fields}}
    if kind == "flat":
        proj.update({f: 1 for f in ("display_state", "display_override", "flat_number")})
    cur = coll.find(scoped, proj)
    if sort:
        cur = cur.sort(sort)
    rows, total = await asyncio.gather(cur.limit(LIMIT).to_list(LIMIT), coll.count_documents(scoped))
    if kind == "flat":
        rows = [r for r in (inv.shape(r, user) for r in rows) if r is not None]
    return {"kind": kind, "total": total, "items": [_node(kind, present_money(r)) for r in rows], "truncated": total > len(rows), "masked": kind == "flat" and not inv.can_see_real(user)}


async def _load(entity: str, eid: str, user: dict) -> dict:
    kind = "block" if entity == "tower" else entity
    if P[kind] not in user["permissions"]:
        raise ApiError(403, f"Missing permission: {P[kind]}", "PERMISSION_DENIED")
    d = await get_or_404(COLL[kind], eid, kind.replace("_", " ").title(), {"company_id": user["company_id"]})
    if d.get("project_id"):
        ensure_project_access(user, d["project_id"])
    if kind == "flat":
        d = inv.shape(d, user) or {}
        if not d:
            raise ApiError(404, "Flat not found", "NOT_FOUND")
    if kind == "document":
        from routers.documents import READ_PERMS
        if READ_PERMS.get(d.get("entity_type")) not in user["permissions"]:
            raise ApiError(403, "Missing permission for this document's parent", "PERMISSION_DENIED")
    return d


@router.get("/{entity}/{entity_id}")
async def graph(entity: Entity, entity_id: str, user: dict = Depends(require_any(*sorted(set(P.values()))))):
    kind = "block" if entity == "tower" else entity
    d = await _load(kind, entity_id, user)
    pid, bid = d.get("project_id"), d.get("block_id")
    S = lambda k, q, **kw: _section(k, user, q, **kw)  # noqa: E731
    jobs: dict[str, asyncio.Future | None] = {}
    if kind == "project":
        jobs = {"towers": S("block", {"project_id": pid or d["id"], "is_active": True}), "flats": S("flat", {"project_id": d["id"], "is_active": True}), "bookings": S("booking", {"project_id": d["id"], "status": "Active"}),
                "customers": None, "stage_plans": S("stage_plan", {"project_id": d["id"], "is_active": True}), "payment_plans": S("payment_plan", {"project_id": d["id"], "is_active": True}),
                "demands": S("demand", {"project_id": d["id"]}), "payments": S("payment", {"project_id": d["id"]}), "documents": S("document", {"entity_type": "project", "entity_id": d["id"], "is_active": {"$ne": False}})}
    elif kind == "block":
        jobs = {"project": S("project", {"id": pid}), "flats": S("flat", {"block_id": d["id"], "is_active": True}), "bookings": S("booking", {"block_id": d["id"], "status": "Active"}),
                "stage_plans": S("stage_plan", {"$or": [{"block_id": d["id"]}, {"project_id": pid, "block_id": None}], "is_active": True}), "payment_plans": S("payment_plan", {"$or": [{"block_id": d["id"]}, {"project_id": pid, "block_id": None}], "is_active": True}),
                "demands": S("demand", {"block_id": d["id"]}), "payments": S("payment", {"block_id": d["id"]}), "documents": S("document", {"entity_type": "block", "entity_id": d["id"]})}
    elif kind == "flat":
        jobs = {"project": S("project", {"id": pid}), "tower": S("block", {"id": bid}), "documents": S("document", {"entity_type": "flat", "entity_id": d["id"]})}
        if inv.can_see_real(user):  # bookings/demands/payments of a flat reveal its real state → privileged only
            jobs.update({"bookings": S("booking", {"flat_id": d["id"]}), "demands": S("demand", {"flat_id": d["id"]}), "payments": S("payment", {"flat_id": d["id"]})})
    elif kind == "customer":
        jobs = {"bookings": S("booking", {"$or": [{"customer_id": d["id"]}, {"co_applicant_customer_ids": d["id"]}]}), "demands": S("demand", {"customer_id": d["id"]}), "payments": S("payment", {"customer_id": d["id"]}),
                "documents": S("document", {"entity_type": "customer", "entity_id": d["id"]})}
    elif kind == "booking":
        jobs = {"customer": S("customer", {"id": {"$in": [d.get("customer_id"), *(d.get("co_applicant_customer_ids") or [])]}}), "project": S("project", {"id": pid}), "tower": S("block", {"id": bid}), "flat": S("flat", {"id": d.get("flat_id")}),
                "payment_plan": S("payment_plan", {"id": (d.get("payment_plan_snapshot") or {}).get("payment_plan_id") or d.get("payment_plan_id")}), "demands": S("demand", {"booking_id": d["id"]}, sort=[("due_date", 1)]), "payments": S("payment", {"booking_id": d["id"]}, sort=[("payment_date", -1)]),
                "documents": S("document", {"entity_type": "booking", "entity_id": d["id"]})}
    elif kind == "stage_plan":
        jobs = {"project": S("project", {"id": pid}), "towers": S("block", {"id": bid} if bid else {"project_id": pid, "is_active": True}), "payment_plans": S("payment_plan", {"stage_plan_id": d["id"]})}
    elif kind == "payment_plan":
        asg = await db.payment_plan_assignments.find({"payment_plan_id": d["id"], "is_active": True}, {"_id": 0, "block_id": 1}).to_list(200)
        bids = [a["block_id"] for a in asg if a.get("block_id")]
        jobs = {"project": S("project", {"id": pid}), "towers": S("block", {"id": {"$in": bids}} if bids else {"project_id": pid, "is_active": True}), "stage_plan": S("stage_plan", {"id": d.get("stage_plan_id")}),
                "bookings": S("booking", {"payment_plan_snapshot.payment_plan_id": d["id"], "status": "Active"})}
    elif kind in ("demand", "payment"):
        jobs = {"booking": S("booking", {"id": d.get("booking_id")}), "customer": S("customer", {"id": d.get("customer_id")}), "flat": S("flat", {"id": d.get("flat_id")}), "tower": S("block", {"id": bid}), "project": S("project", {"id": pid})}
        jobs["payments" if kind == "demand" else "demands"] = S("payment", {"demand_id": d["id"]}) if kind == "demand" else S("demand", {"booking_id": d.get("booking_id"), "status": {"$ne": "Voided"}})
    elif kind == "document":
        et = d.get("entity_type")
        jobs = {et: S(et, {"id": d.get("entity_id")})} if et in P else {}
    keys = [k for k, v in jobs.items() if v is not None]
    results = await asyncio.gather(*[jobs[k] for k in keys])
    sections = {k: r for k, r in zip(keys, results) if r is not None}
    if kind == "project" and "bookings" in sections and P["customer"] in user["permissions"]:
        cids = await db.bookings.distinct("customer_id", {"project_id": d["id"], "status": "Active"})
        sections["customers"] = {"kind": "customer", "total": len(cids), "items": [], "truncated": True, "masked": False, "to": f"/customers?project_id={d['id']}"}
    return {"entity": _node(kind, present_money(d)), "sections": sections}
