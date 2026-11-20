"""Phase 1 F-5: audited hard purge of test lineage. Selection = named test records (QA / test / Load Test / LT CLP / QSH* /
S1ACC) + their children. Refuses (409) when the selection reaches a record that is not test data. Audit rows are kept."""

import re

from db import db
from services.counters import recompute_all
from utils import ApiError, now_iso

TEST_RE = re.compile(r"\bQA\b|(?i:\btest\b)|(?i:load test)|\bLT CLP\b|^QSH|S1ACC|S1 Acceptance|^Own-T[0-9A-F]{3}$")
TEST_TOWERS = {"QA Tower S1", "Tower M2 (test)", "Tower QA 92712", "QA Tower", "Tower S (setup test)", "Tower Z (test)"}
EXPLICIT = {"customers": {"CUST-2627-0085"}, "bookings": {"BK-2627-0030"}, "payments": {"KKT/2627/00590"}}
EXTRA_PLANS = {"M2 Flexi"}
NAMED = (
    "payment_plans",
    "payment_plan_templates",
    "tower_templates",
    "floor_plan_templates",
    "flat_types",
    "stage_plan_templates",
    "construction_stage_plans",
    "construction_stages",
)
IMPORTED = "Imported – "


def is_test(*vals) -> bool:
    return any(v and TEST_RE.search(str(v)) for v in vals)


async def _ids(coll: str, q: dict, field: str = "id") -> list:
    return [d[field] for d in await db[coll].find(q, {"_id": 0, field: 1}).to_list(None) if field in d]


async def _named(coll: str) -> list[dict]:
    rows = await db[coll].find({}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)
    return [
        r
        for r in rows
        if is_test(r.get("name"), r.get("code")) or (coll == "payment_plans" and r.get("name") in EXTRA_PLANS)
    ]


def _stop(what: str):
    raise ApiError(409, f"Purge stopped: {what} is not test data", "NOT_TEST_DATA")


async def _structure(extra: dict) -> tuple[list, list]:
    projects = [
        p
        for p in await db.projects.find({}, {"_id": 0}).to_list(None)
        if is_test(p.get("name"), p.get("code")) or "load_test" in (p.get("tags") or []) or p.get("load_test")
    ]
    pids = [p["id"] for p in projects]
    for pid in extra.get("project_ids") or []:
        if pid not in pids:
            p = await db.projects.find_one({"id": pid}, {"_id": 0, "name": 1})
            _stop(f"project {(p or {}).get('name', pid)}")
    blocks = await db.blocks.find({}, {"_id": 0, "id": 1, "name": 1, "project_id": 1}).to_list(None)
    bids = [b["id"] for b in blocks if b["project_id"] in pids or b["name"] in TEST_TOWERS or is_test(b.get("name"))]
    for bid in extra.get("block_ids") or []:
        if bid not in bids:
            _stop(f"tower {next((b['name'] for b in blocks if b['id'] == bid), bid)}")
    return pids, bids


OWNER_PROJECTS = {"Ye"}  # never purged, whatever the names inside say


async def _test_customer_ids() -> list:
    rows = await db.customers.find({}, {"_id": 0, "id": 1, "full_name": 1}).to_list(None)
    return [c["id"] for c in rows if is_test(c.get("full_name"))]


async def _bookings(pids, bids, extra) -> tuple[list, list]:
    """Test towers' bookings + any booking of a test-named customer (e.g. "QA tscheck …" on a real tower)."""
    bk = await db.bookings.find(
        {
            "$or": [
                {"project_id": {"$in": pids}},
                {"block_id": {"$in": bids}},
                {"booking_number": {"$in": list(EXPLICIT["bookings"])}},
                {"customer_id": {"$in": await _test_customer_ids()}},
            ]
        },
        {"_id": 0, "id": 1, "booking_number": 1, "customer_id": 1, "project_id": 1},
    ).to_list(None)
    owner = {p["id"] async for p in db.projects.find({"name": {"$in": list(OWNER_PROJECTS)}}, {"_id": 0, "id": 1})}
    for b in bk:
        if b.get("project_id") in owner:
            _stop(f"booking {b['booking_number']} (owner project)")
    ids = {b["id"] for b in bk}
    for b in extra.get("booking_ids") or []:
        if b not in ids:
            row = await db.bookings.find_one({"id": b}, {"_id": 0, "booking_number": 1})
            _stop(f"booking {(row or {}).get('booking_number', b)}")
    return [b["id"] for b in bk], bk


async def _customers(bk_rows: list, bk_ids: list) -> list:
    cands = {b["customer_id"] for b in bk_rows}
    for c in await db.customers.find({}, {"_id": 0, "id": 1, "full_name": 1, "customer_code": 1}).to_list(None):
        if is_test(c.get("full_name")) or c.get("customer_code") in EXPLICIT["customers"]:
            cands.add(c["id"])
    out = []
    for cid in cands:
        kept = await db.bookings.find_one({"customer_id": cid, "id": {"$nin": bk_ids}}, {"_id": 0, "booking_number": 1})
        if not kept:
            out.append(cid)
            continue
        c = await db.customers.find_one({"id": cid}, {"_id": 0, "full_name": 1, "customer_code": 1})
        if is_test(c.get("full_name")) or c.get("customer_code") in EXPLICIT["customers"]:
            _stop(f"booking {kept['booking_number']} of test-named customer {c.get('customer_code')}")
    return out


async def _guard_references(named: dict, bids: list, bk_ids: list):
    """A test master still used by a kept flat / tower / booking means the selection reached real data."""
    ft = [r["id"] for r in named["flat_types"]]
    f = await db.flats.find_one({"flat_type_id": {"$in": ft}, "block_id": {"$nin": bids}}, {"_id": 0, "flat_number": 1})
    if f:
        _stop(f"flat {f['flat_number']} (uses a test flat type)")
    plans = [r["id"] for r in named["payment_plans"]]
    b = await db.bookings.find_one(
        {"payment_plan_id": {"$in": plans}, "id": {"$nin": bk_ids}}, {"_id": 0, "booking_number": 1}
    )
    if b:
        _stop(f"booking {b['booking_number']} (on a test payment plan)")
    st = [r["id"] for r in named["construction_stages"]]
    blk = await db.blocks.find_one(
        {"id": {"$nin": bids}, "construction_stages.stage_id": {"$in": st}}, {"_id": 0, "name": 1}
    )
    if blk:
        _stop(f"tower {blk['name']} (its stage sequence uses a test stage)")


def _plan(pids, bids, bk, cids, named, leads, docs, visits) -> dict:
    ents = bk + pids + cids + bids
    plans = [r["id"] for r in named["payment_plans"]]
    plan = {
        "projects": {"id": {"$in": pids}},
        "blocks": {"id": {"$in": bids}},
        "flats": {"block_id": {"$in": bids}},
        "parking_slots": {"$or": [{"project_id": {"$in": pids}}, {"block_id": {"$in": bids}}]},
        "construction_photos": {"block_id": {"$in": bids}},
        "rate_cards": {"$or": [{"project_id": {"$in": pids}}, {"block_id": {"$in": bids}}]},
        "payment_plan_assignments": {
            "$or": [{"project_id": {"$in": pids}}, {"block_id": {"$in": bids}}, {"payment_plan_id": {"$in": plans}}]
        },
        "bookings": {"id": {"$in": bk}},
        "payments": {"booking_id": {"$in": bk}},
        "demands": {"booking_id": {"$in": bk}},
        "ledger_entries": {"booking_id": {"$in": bk}},
        "contra_entries": {"booking_id": {"$in": bk}},
        "refunds": {"booking_id": {"$in": bk}},
        "waivers": {"booking_id": {"$in": bk}},
        "reminders": {"booking_id": {"$in": bk}},
        "generated_documents": {"booking_id": {"$in": bk}},
        "doc_share_links": {"doc_id": {"$in": docs}},
        "documents": {
            "$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}, {"project_id": {"$in": pids}}]
        },
        "files": {"$or": [{"entity_id": {"$in": ents}}, {"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]},
        "messages": {"$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]},
        "service_requests": {"$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]},
        "communications": {"customer_id": {"$in": cids}},
        "leads": {"id": {"$in": leads}},
        "site_visits": {"$or": [{"project_id": {"$in": pids}}, {"lead_id": {"$in": leads}}, {"id": {"$in": visits}}]},
        "customers": {"id": {"$in": cids}},
        "portal_accounts": {"customer_id": {"$in": cids}},
        "notifications": {"entity_id": {"$in": ents}},
        "project_summaries": {"project_id": {"$in": pids}},
        "block_summaries": {"block_id": {"$in": bids}},
        "customer_summaries": {"customer_id": {"$in": cids}},
        "monthly_buckets": {"scope_id": {"$in": pids + cids}},
    }
    for coll in NAMED:
        plan.setdefault(coll, {"id": {"$in": [r["id"] for r in named[coll]]}})
    return plan


async def _loose_ends(plan: dict, bids: list):
    """Test flats added inside real towers, stage plans left behind by removed test towers, test notification mails."""
    flats = [
        f
        for f in await db.flats.find({}, {"_id": 0, "id": 1, "flat_number": 1, "status": 1, "booking_id": 1}).to_list(
            None
        )
        if is_test(f.get("flat_number"))
    ]
    for f in flats:
        if f.get("booking_id") or f.get("status") in ("Booked", "Sold"):
            _stop(f"booked flat {f['flat_number']}")
    plan["flats"] = {"$or": [plan["flats"], {"id": {"$in": [f["id"] for f in flats]}}]}
    rows = await db.construction_stage_plans.find(
        {}, {"_id": 0, "id": 1, "block_id": 1, "block_name": 1, "project_name": 1}
    ).to_list(None)
    left = [r["id"] for r in rows if r.get("block_id") in bids or is_test(r.get("block_name"), r.get("project_name"))]
    plan["construction_stage_plans"] = {"$or": [plan["construction_stage_plans"], {"id": {"$in": left}}]}
    msgs = [
        m["id"]
        for m in await db.messages.find({}, {"_id": 0, "id": 1, "subject": 1, "customer_name": 1}).to_list(None)
        if is_test(m.get("subject"), m.get("customer_name"))
    ]
    plan["messages"] = {"$or": [plan["messages"], {"id": {"$in": msgs}}]}


async def _select(extra: dict) -> dict:
    pids, bids = await _structure(extra)
    bk, bk_rows = await _bookings(pids, bids, extra)
    cids = await _customers(bk_rows, bk)
    named = {c: await _named(c) for c in NAMED}
    await _guard_references(named, bids, bk)
    leads = [
        ld["id"]
        for ld in await db.leads.find({}, {"_id": 0, "id": 1, "name": 1, "project_id": 1, "customer_id": 1}).to_list(
            None
        )
        if is_test(ld.get("name")) or ld.get("project_id") in pids or ld.get("customer_id") in cids
    ]
    docs = await _ids("generated_documents", {"booking_id": {"$in": bk}})
    visits = [
        v["id"]
        for v in await db.site_visits.find({"project_id": {"$nin": pids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
        if is_test(v.get("name"))
    ]
    plan = _plan(pids, bids, bk, cids, named, leads, docs, visits)
    await _loose_ends(plan, bids)
    numbers = {
        "bookings": sorted(b["booking_number"] for b in bk_rows),
        "receipts": sorted(await _ids("payments", {"booking_id": {"$in": bk}}, "receipt_number")),
        "customers": sorted(await _ids("customers", {"id": {"$in": cids}}, "customer_code")),
        "bills": len(await _ids("demands", {"booking_id": {"$in": bk}})),
    }
    names = {
        "projects": sorted(await _ids("projects", {"id": {"$in": pids}}, "name")),
        "towers": sorted(await _ids("blocks", {"id": {"$in": bids}}, "name")),
        **{c: sorted(r.get("name", "") for r in named[c]) for c in NAMED},
    }
    return {"plan": plan, "numbers": numbers, "names": names, "kept_bids": bids, "bk": bk}


async def _rename_imported() -> list:
    out = []
    for coll in ("payment_plans", "payment_plan_templates", "stage_plan_templates", "construction_stage_plans"):
        for r in (
            await db[coll]
            .find({"name": {"$regex": f"^{IMPORTED}"}}, {"_id": 0, "id": 1, "name": 1, "project_id": 1, "block_id": 1})
            .to_list(None)
        ):
            plain = r["name"][len(IMPORTED) :].strip()
            dup = await db[coll].find_one(
                {
                    "name": plain,
                    "project_id": r.get("project_id"),
                    "block_id": r.get("block_id"),
                    "id": {"$ne": r["id"]},
                },
                {"_id": 1},
            )
            if not dup:
                await db[coll].update_one(
                    {"id": r["id"]}, {"$set": {"name": plain, "updated_at": now_iso()}, "$inc": {"version": 1}}
                )
            out.append(
                {
                    "collection": coll,
                    "from": r["name"],
                    "to": plain if not dup else None,
                    "kept_reason": "duplicate name" if dup else None,
                }
            )
    return out


async def hard_purge(dry_run: bool, extra: dict | None = None) -> dict:
    sel = await _select(extra or {})
    counts = {c: await db[c].count_documents(q) for c, q in sel["plan"].items()}
    counts = {c: n for c, n in counts.items() if n}
    out = {"dry_run": dry_run, "counts": counts, "numbers": sel["numbers"], "names": sel["names"], "at": now_iso()}
    if dry_run:
        out["imported_renames"] = await db.payment_plans.count_documents({"name": {"$regex": f"^{IMPORTED}"}})
        return out
    await _release_kept_units(sel["bk"], sel["kept_bids"])
    for coll, q in sel["plan"].items():
        if coll in counts:
            target = db.ledger_entries.raw("hard purge of test lineage") if coll == "ledger_entries" else db[coll]
            await target.delete_many(q)
    out["imported_renames"] = await _rename_imported()
    await recompute_all()
    await _rebuild_reads()
    return out


async def _release_kept_units(bk: list, purged_bids: list):
    """A purged test booking on a real tower gives its flat / parking back (same end state as a cancellation)."""
    ts = now_iso()
    await db.flats.update_many(
        {"booking_id": {"$in": bk}, "block_id": {"$nin": purged_bids}},
        {"$set": {"status": "Available", "booking_id": None, "status_changed_at": ts}, "$inc": {"version": 1}},
    )
    await db.parking_slots.update_many(
        {"booking_id": {"$in": bk}},
        [
            {
                "$set": {
                    "status": {"$cond": [{"$ifNull": ["$flat_id", False]}, "Attached", "Available"]},
                    "booking_id": None,
                    "customer_id": None,
                }
            }
        ],
    )


async def _rebuild_reads():
    """Purged lineage must leave Home / trends / summaries too (they are read models, not recomputed by counters)."""
    from services import read_models, trends

    await read_models.recompute_all()
    await read_models._invalidate_read_caches()
    cos = {c["id"] for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None)}
    pids = {p["id"] for p in await db.projects.find({}, {"_id": 0, "id": 1}).to_list(None)}
    await trends.on_dirty(pids, set(), cos)
