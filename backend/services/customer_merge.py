"""REQ-221 customer merge as a journaled, resumable plan: pre-flight computes every move and the expected money
fingerprint; apply moves records by explicit id (idempotent), journaling each step; verify compares fingerprints and
rolls back on mismatch. A crash mid-merge leaves a journal that `resume` completes or `rollback` undoes."""

from db import db as _db
from utils import ApiError, new_id, now_iso

MERGE_FIELDS = (
    ("bookings", "customer_id"),
    ("bookings", "co_applicant_customer_ids"),
    ("payments", "customer_id"),
    ("demands", "customer_id"),
    ("refunds", "customer_id"),
    ("generated_documents", "customer_id"),
    ("parking_slots", "customer_id"),
    ("service_requests", "customer_id"),
    ("site_visits", "customer_id"),
    ("leads", "converted_customer_id"),
    ("communications", "customer_id"),
    ("documents", "entity_id"),
    ("portal_accounts", "customer_id"),
)
MONEY = (("payments", "amount_paise"), ("demands", "total_demand_paise"), ("refunds", "amount_paise"))


async def fingerprint(cid: str, dbx=None) -> dict:
    """Count + sum of every money record owned by one customer."""
    dbx = dbx if dbx is not None else _db
    out = {}
    for coll, amt in MONEY:
        r = (
            await dbx[coll]
            .aggregate(
                [
                    {"$match": {"customer_id": cid}},
                    {"$group": {"_id": None, "n": {"$sum": 1}, "s": {"$sum": f"${amt}"}}},
                ]
            )
            .to_list(1)
        )
        out[coll] = [r[0]["n"], r[0]["s"]] if r else [0, 0]
    return out


def _add(a: dict, b: dict) -> dict:
    return {k: [a[k][0] + b[k][0], a[k][1] + b[k][1]] for k in a}


def _match(coll: str, field: str, cid: str) -> dict:
    q = {field: cid}
    if coll == "documents":
        q["entity_type"] = "customer"
    return q


async def plan(keep: dict, gone: dict, user: dict, reason: str, dbx=None) -> dict:
    dbx = dbx if dbx is not None else _db
    if keep["id"] == gone["id"]:
        raise ApiError(422, "Pick two different customers", "VALIDATION_ERROR")
    if keep.get("merged_into") or gone.get("merged_into"):
        raise ApiError(409, "One of these profiles is already merged", "MERGED")
    if (
        keep.get("pan_hash")
        and gone.get("pan_hash")
        and keep["pan_hash"] != gone["pan_hash"]
        and "Verified" in (keep.get("kyc_status"), gone.get("kyc_status"))
    ):
        raise ApiError(
            409,
            "The two profiles carry different PANs with verified KYC — they are not the same person",
            "KYC_CONFLICT",
        )
    if await dbx.customer_merges.find_one({"merged_id": gone["id"], "status": {"$in": ["planned", "applying"]}}):
        raise ApiError(
            409, "A merge of this profile is already in progress — resume or roll it back", "MERGE_IN_PROGRESS"
        )
    survivor_has_portal = bool(await dbx.portal_accounts.find_one({"customer_id": keep["id"]}, {"_id": 1}))
    steps = []
    for coll, field in MERGE_FIELDS:
        if coll == "portal_accounts" and survivor_has_portal:
            continue  # survivor keeps its own login; the duplicate's login is switched off instead
        ids = [d["id"] async for d in dbx[coll].find(_match(coll, field, gone["id"]), {"_id": 0, "id": 1})]
        if ids:
            steps.append({"coll": coll, "field": field, "ids": ids, "done": False})
    fk, fg = await fingerprint(keep["id"], dbx), await fingerprint(gone["id"], dbx)
    j = {
        "id": new_id(),
        "company_id": user["company_id"],
        "survivor_id": keep["id"],
        "survivor_code": keep.get("customer_code"),
        "merged_id": gone["id"],
        "merged_code": gone.get("customer_code"),
        "reason": reason,
        "status": "planned",
        "steps": steps,
        "portal_off": survivor_has_portal,
        "before": {"survivor": fk, "merged": fg},
        "expected": {"survivor": _add(fk, fg), "merged": {k: [0, 0] for k in fk}},
        "created_at": now_iso(),
        "created_by": user["id"],
    }
    await dbx.customer_merges.insert_one(j)
    j.pop("_id", None)
    return j


async def _move(dbx, s: dict, frm: str, to: str):
    q = {"id": {"$in": s["ids"]}, s["field"]: frm}
    key = f"{s['field']}.$" if s["field"].endswith("_ids") else s["field"]
    return (await dbx[s["coll"]].update_many(q, {"$set": {key: to}})).modified_count


async def apply(j: dict, dbx=None, fail_after: int | None = None) -> dict:
    """Runs the remaining steps; `fail_after` simulates a crash after that many steps (tests only)."""
    dbx = dbx if dbx is not None else _db
    await dbx.customer_merges.update_one({"id": j["id"]}, {"$set": {"status": "applying"}})
    for i, s in enumerate(j["steps"]):
        if s["done"]:
            continue
        if fail_after is not None and i >= fail_after:
            raise RuntimeError("simulated crash mid-merge")
        s["moved"] = await _move(dbx, s, j["merged_id"], j["survivor_id"])
        s["done"] = True
        await dbx.customer_merges.update_one({"id": j["id"]}, {"$set": {f"steps.{i}": s}})
    if j["portal_off"]:
        await dbx.portal_accounts.update_many({"customer_id": j["merged_id"]}, {"$set": {"is_active": False}})
    after = {"survivor": await fingerprint(j["survivor_id"], dbx), "merged": await fingerprint(j["merged_id"], dbx)}
    if after != j["expected"]:
        await rollback(j, dbx, status="rolled_back_mismatch")
        raise ApiError(
            409,
            "Money did not tie out after moving records — the merge was rolled back",
            "MERGE_TIEOUT",
            extra={"expected": j["expected"], "after": after},
        )
    ts = now_iso()
    await dbx.customers.update_one(
        {"id": j["merged_id"]},
        {
            "$set": {
                "is_active": False,
                "merged_into": j["survivor_id"],
                "merged_into_code": j["survivor_code"],
                "merged_at": ts,
                "merge_reason": j["reason"],
                "updated_at": ts,
            }
        },
    )
    if j.get("merged_code"):
        await dbx.customers.update_one({"id": j["survivor_id"]}, {"$addToSet": {"also_known_as": j["merged_code"]}})
    await dbx.customer_merges.update_one({"id": j["id"]}, {"$set": {"status": "done", "after": after, "done_at": ts}})
    return {**j, "status": "done", "after": after}


async def rollback(j: dict, dbx=None, status: str = "rolled_back") -> dict:
    """Moves every journaled record back to the duplicate; both customers end exactly as before."""
    dbx = dbx if dbx is not None else _db
    j = await dbx.customer_merges.find_one({"id": j["id"]}, {"_id": 0})
    if j["status"] == "done":
        raise ApiError(409, "A completed merge cannot be rolled back", "MERGE_DONE")
    for i, s in enumerate(j["steps"]):
        await _move(dbx, s, j["survivor_id"], j["merged_id"])
        s["done"] = False
        await dbx.customer_merges.update_one({"id": j["id"]}, {"$set": {f"steps.{i}": s}})
    await dbx.customer_merges.update_one({"id": j["id"]}, {"$set": {"status": status, "rolled_back_at": now_iso()}})
    return {**j, "status": status}
