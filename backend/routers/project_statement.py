"""Phase X.7 — Project Statement: per tower every live booking (customer · flat · bill raised · received · balance with Due/Advance),
tower subtotals, project grand total; then (new page) tower-wise sales & inventory summary. Figures = booking ledger summaries
(services/ledger rebuild) — the same numbers Customer 360 / Outstanding use; sign convention from definitions.two_sided.
Section B "Sold" = flat has a live booking (real association) → shown only to users with inventory.real_status.view."""
from fastapi import APIRouter, Depends, Request

from db import db
from deps import ensure_project_access, require
from routers.reports import _company, respond
from services import pdf as _pdf
from services.definitions import live_bookings_match, two_sided
from services.inventory import can_see_real
from utils import ApiError, base_doc, now_iso

router = APIRouter(prefix="/reports", tags=["reports"])
COLS = [("tower", "Tower", "str", 1.1), ("customer", "Customer name", "str", 2.2), ("flat_number", "Flat number", "str", 0.9),
        ("bill_raised_paise", "Total bill raised", "money"), ("received_paise", "Total payment received", "money"), ("balance_signed_paise", "Balance", "money"), ("balance_status", "Status", "str", 0.7)]
INV_COLS = [("tower", "Tower", "str"), ("total", "Total flats", "num"), ("sold", "Sold", "num"), ("available", "Available", "num"), ("hold", "Hold", "num"), ("landowner", "Landowner", "num"),
            ("blocked", "Blocked/Other", "num"), ("sold_pct", "Sold %", "pct"), ("bill_raised_paise", "Total bill raised", "money"), ("received_paise", "Total received", "money"), ("balance_signed_paise", "Balance", "money")]


def _status_word(bal: int) -> str:
    return "Due" if bal < 0 else "Advance" if bal > 0 else "Settled"


async def build_project_statement(project_id: str, user: dict, block_ids: list[str] | None = None, as_of: str | None = None) -> dict:
    cid = user["company_id"]
    project = await db.projects.find_one({"id": project_id, "company_id": cid}, {"_id": 0, "id": 1, "name": 1, "code": 1})
    if not project:
        raise ApiError(404, "Project not found", "NOT_FOUND")
    ensure_project_access(user, project_id)
    bq = {"company_id": cid, "block_id": {"$in": block_ids}} if block_ids else {"company_id": cid}
    blocks = sorted(await db.blocks.find({**bq, "project_id": project_id, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1}).to_list(None), key=lambda b: b["name"])
    bmatch = live_bookings_match({"project_id": project_id, **({"block_id": {"$in": block_ids}} if block_ids else {})})
    if as_of:
        bmatch["booking_date"] = {"$lte": as_of}
    bookings = await db.bookings.find(bmatch, {"_id": 0, "id": 1, "block_id": 1, "flat_id": 1, "customer_name": 1, "co_applicant_customer_ids": 1, "flat_snapshot": 1, "summary": 1, "booking_number": 1}).to_list(None)
    co_ids = sorted({c for b in bookings for c in (b.get("co_applicant_customer_ids") or [])})
    co_names = {c["id"]: c["full_name"] for c in await db.customers.find({"id": {"$in": co_ids}}, {"_id": 0, "id": 1, "full_name": 1}).to_list(None)} if co_ids else {}
    by_block: dict[str, list] = {}
    for b in bookings:
        by_block.setdefault(b["block_id"], []).append(b)
    rows, towers = [], []
    for blk in blocks:
        trows = []
        for b in sorted(by_block.get(blk["id"], []), key=lambda x: (x.get("flat_snapshot") or {}).get("flat_number") or ""):
            s = b.get("summary") or {}
            t = two_sided(s.get("total_udhar_paise", 0), s.get("total_jama_paise", 0))
            names = [b.get("customer_name") or ""] + [co_names.get(c, "") for c in (b.get("co_applicant_customer_ids") or []) if co_names.get(c)]
            trows.append({"id": b["id"], "tower": blk["name"], "booking_number": b["booking_number"], "customer": " / ".join(n for n in names if n), "flat_number": (b.get("flat_snapshot") or {}).get("flat_number"),
                          **t, "balance_status": t["balance_status"]})
        sub = two_sided(sum(r["bill_raised_paise"] for r in trows), sum(r["received_paise"] for r in trows))
        towers.append({"block_id": blk["id"], "tower": blk["name"], "rows": trows, "subtotal": sub})
        rows.extend(trows)
    grand = two_sided(sum(r["bill_raised_paise"] for r in rows), sum(r["received_paise"] for r in rows))
    inventory = None
    if can_see_real(user):
        flats = await db.flats.find({"company_id": cid, "project_id": project_id, "is_active": {"$ne": False}, **({"block_id": {"$in": block_ids}} if block_ids else {})},
                                    {"_id": 0, "id": 1, "block_id": 1, "status": 1, "allocation_category_code": 1}).to_list(None)
        sold_flats = {b["flat_id"] for b in bookings}
        inv_rows = []
        for blk in blocks:
            fl = [f for f in flats if f["block_id"] == blk["id"]]
            sold = sum(1 for f in fl if f["id"] in sold_flats)
            lo = sum(1 for f in fl if f.get("allocation_category_code") == "LANDOWNER" and f["id"] not in sold_flats)
            rest = [f for f in fl if f["id"] not in sold_flats and f.get("allocation_category_code") != "LANDOWNER"]
            avail = sum(1 for f in rest if f.get("status") == "Available")
            hold = sum(1 for f in rest if f.get("status") == "Hold")
            tw = next(t for t in towers if t["block_id"] == blk["id"])
            inv_rows.append({"tower": blk["name"], "total": len(fl), "sold": sold, "available": avail, "hold": hold, "landowner": lo, "blocked": len(rest) - avail - hold,
                             "sold_pct": round(sold * 100 / len(fl), 1) if fl else 0, **{k: tw["subtotal"][k] for k in ("bill_raised_paise", "received_paise", "balance_signed_paise")}})
        tot = {k: sum(r[k] for r in inv_rows) for k in ("total", "sold", "available", "hold", "landowner", "blocked", "bill_raised_paise", "received_paise", "balance_signed_paise")}
        tot["sold_pct"] = round(tot["sold"] * 100 / tot["total"], 1) if tot["total"] else 0
        inventory = {"rows": inv_rows, "totals": tot}
    return {"project": project, "as_of": as_of or _pdf.today_ist(), "towers": towers, "rows": rows, "grand": grand, "inventory": inventory,
            "legend": "Bill raised = demands + other charges + agreement increases · Received = cleared receipts (reversals/refunds negative) · Balance = Received − Bill raised: negative Due, positive Advance. Cancelled bookings and voided demands/payments excluded. Sold = flat with a live booking."}


def _chip(bal: int) -> str:
    txt = f"-{_pdf.inr(-bal)}" if bal < 0 else _pdf.inr(bal)
    color = "#B3261E" if bal < 0 else "#1B7F4E" if bal > 0 else "#6B6B6B"
    return f'<font color="{color}"><b>{txt}</b> {_status_word(bal)}</font>'


def _pdf_bytes(data: dict, company: dict, user: dict) -> bytes:
    p = data["project"]
    d = _pdf.BrandedDoc("Project Statement", company, landscape_mode=True, number=p.get("code") or p["name"], date=data["as_of"], subtitle=f"{p['name']} · generated by {user.get('name', '')} · {now_iso()[:16].replace('T', ' ')}")
    d.h2("Section A — Tower-wise customer statement")
    for t in data["towers"]:
        if not t["rows"]:
            continue
        d.h2(t["tower"])
        rows = [[i + 1, r["customer"], r["flat_number"], _pdf.inr(r["bill_raised_paise"]), _pdf.inr(r["received_paise"]), _chip(r["balance_signed_paise"])] for i, r in enumerate(t["rows"])]
        st = t["subtotal"]
        d.table(["#", "Customer name", "Flat number", "Total bill raised", "Total payment received", "Balance"], rows, widths=[0.4, 3, 1, 1.4, 1.6, 1.8], align_right=[3, 4, 5],
                totals=["", f"{t['tower']} subtotal ({len(rows)} bookings)", "", _pdf.inr(st["bill_raised_paise"]), _pdf.inr(st["received_paise"]), _chip(st["balance_signed_paise"])])
        d.small(f"Bill raised {_pdf.inr(st['bill_raised_paise'])} · Received {_pdf.inr(st['received_paise'])} · Balance {_chip(st['balance_signed_paise'])}")
    g = data["grand"]
    d.totals([("Project total bill raised", _pdf.inr(g["bill_raised_paise"])), ("Project total received", _pdf.inr(g["received_paise"])), ("Project balance (Received − Bill raised)", _chip(g["balance_signed_paise"]))])
    if data.get("inventory"):
        d.page_break()
        d.h2("Section B — Tower-wise sales & inventory summary")
        inv = data["inventory"]
        rows = [[r["tower"], r["total"], r["sold"], r["available"], r["hold"], r["landowner"], r["blocked"], f"{r['sold_pct']}%", _pdf.inr(r["bill_raised_paise"]), _pdf.inr(r["received_paise"]), _chip(r["balance_signed_paise"])] for r in inv["rows"]]
        tt = inv["totals"]
        d.table([c[1] for c in INV_COLS], rows, widths=[1.4, 0.8, 0.7, 0.9, 0.6, 0.9, 1, 0.7, 1.4, 1.4, 1.8], align_right=list(range(1, 11)),
                totals=["Project total", tt["total"], tt["sold"], tt["available"], tt["hold"], tt["landowner"], tt["blocked"], f"{tt['sold_pct']}%", _pdf.inr(tt["bill_raised_paise"]), _pdf.inr(tt["received_paise"]), _chip(tt["balance_signed_paise"])])
    d.h2("Definitions")
    d.small(data["legend"])
    return d.build()


@router.get("/project-statement")
async def project_statement(request: Request, project_id: str | None = None, block_id: str | None = None, as_of: str | None = None, format: str | None = None, download: int = 0,
                            user: dict = Depends(require("reports.project_statement.view"))):
    if not project_id:
        return {"rows": [], "columns": [{"key": c[0], "label": c[1], "type": c[2]} for c in COLS], "needs_project": True, "purpose": "Pick a project to generate its statement."}
    data = await build_project_statement(project_id, user, block_id.split(",") if block_id else None, as_of)
    company = await _company(user)
    if format == "pdf":
        if "reports.project_statement.export" not in request.state.perms:
            raise ApiError(403, "Missing permission: reports.project_statement.export", "PERMISSION_DENIED")
        content = _pdf_bytes(data, company, user)
        name = f"project-statement-{(data['project'].get('code') or data['project']['name']).replace(' ', '-')}-{data['as_of']}.pdf"
        await db.documents.insert_one({**base_doc(user, user["company_id"]), "entity_type": "project", "entity_id": project_id, "document_type_id": None, "document_type_name": "Project Statement",
                                       "kind": "generated", "doc_type": "project_statement", "file_name": name, "mime": "application/pdf", "size": len(content), "storage_key": None,
                                       "uploaded_by": user["id"], "uploaded_by_name": user.get("name"), "uploaded_at": now_iso(), "is_sensitive": False, "as_of": data["as_of"]})
        return _pdf.pdf_response(content, name, bool(download))
    rows = [{**r, "balance_status": _status_word(r["balance_signed_paise"])} for r in data["rows"]]
    totals = {"bill_raised_paise": data["grand"]["bill_raised_paise"], "received_paise": data["grand"]["received_paise"], "balance_signed_paise": data["grand"]["balance_signed_paise"], "balance_status": _status_word(data["grand"]["balance_signed_paise"])}
    payload = {"as_of": data["as_of"], "project": data["project"], "tower_subtotals": [{"tower": t["tower"], "block_id": t["block_id"], "count": len(t["rows"]), **t["subtotal"]} for t in data["towers"]],
               "inventory": data["inventory"], "legend": data["legend"], "filters_text": f"Project: {data['project']['name']}" + (f" · Towers: {block_id}" if block_id else ""),
               "kpis": [{"label": "Bill raised", "value_paise": totals["bill_raised_paise"], "kind": "money"}, {"label": "Received", "value_paise": totals["received_paise"], "kind": "money"},
                        {"label": "Balance", "value_paise": totals["balance_signed_paise"], "kind": "money", "hint": totals["balance_status"]}, {"label": "Bookings", "value": len(rows), "kind": "num"}]}
    return await respond(request, format, payload, "Project Statement", company, COLS, rows, totals, filename="project-statement", landscape=True)
