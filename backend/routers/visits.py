"""Phase 9 — Brochure lead gate + Site visit scheduler (public + ERP)."""
import asyncio
import hmac
import hashlib
import base64
import json
import logging
from datetime import UTC, date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field, field_validator

from services import clock
from db import db
from models_out import VisitsOut, VisitsOutPage
from deps import JWT_SECRET, enforce_rate_limit, project_scope_filter, require, require_any
from routers.notifications import notify_roles
from services import ttlcache
from services.kyc import normalize_phone
from services.numbering import generate_number
from storage import get_object
from utils import ApiError, ListParams, StrictModel, base_doc, client_ip, get_or_404, new_id, now_iso, paginate, to_csv, write_audit

pub = APIRouter(prefix="/public", tags=["public (visits & brochure)"])
router = APIRouter(prefix="/site-visits", tags=["site visits"])
IST = timezone(timedelta(hours=5, minutes=30))
VISIT_DEFAULTS = {"enabled": False, "visit_days": [0, 1, 2, 3, 4, 5, 6], "start_time": "10:00", "end_time": "18:00", "slot_minutes": 60, "capacity_per_slot": 3, "min_lead_hours": 3, "max_days_ahead": 30, "blackout_dates": [], "site_office_address": "", "maps_url": "", "instructions": ""}
VISIT_STATUSES = ["Confirmed", "Rescheduled", "Completed", "No-show", "Cancelled"]
log = logging.getLogger("kkt.visits")


# ---------- signed tokens ----------
def sign(payload: dict, minutes: int | None) -> str:
    if minutes:
        payload = {**payload, "exp": int(datetime.now(UTC).timestamp()) + minutes * 60}
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(JWT_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{raw}.{sig}"


def unsign(token: str) -> dict:
    try:
        raw, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, hmac.new(JWT_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:24]):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except Exception:
        raise ApiError(404, "Invalid link", "NOT_FOUND")
    if payload.get("exp") and payload["exp"] < datetime.now(UTC).timestamp():
        raise ApiError(410, "This link has expired", "LINK_EXPIRED")
    return payload


# ---------- lead helpers ----------
async def _company_id() -> str:
    c = await db.companies.find_one({}, {"_id": 0, "id": 1})
    return c["id"]


async def _assignee(cid: str) -> str | None:
    s = await db.site_settings.find_one({"company_id": cid}, {"_id": 0, "round_robin_assignment": 1}) or {}
    sales_role = await db.roles.find_one({"name": "Sales"}, {"_id": 0, "id": 1})
    reps = await db.users.find({"company_id": cid, "is_active": True, "role_id": sales_role["id"]}, {"_id": 0, "id": 1}).sort("id", 1).to_list(50) if sales_role else []
    if not reps:
        return None
    if not s.get("round_robin_assignment", True):
        return reps[0]["id"]
    c = await db.counters.find_one_and_update({"scope": "round_robin", "key": "sales"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return reps[c["seq"] % len(reps)]["id"]


async def add_activity(lead_id: str, atype: str, title: str, payload: dict | None = None, by: str | None = None):
    await db.leads.update_one({"id": lead_id}, {"$push": {"activities": {"id": new_id(), "type": atype, "title": title, "payload": payload or {}, "at": now_iso(), "by": by}}, "$set": {"updated_at": now_iso()}})


async def upsert_lead(cid: str, project: dict, name: str, phone: str, email: str | None, source: str, note: str, utm: dict | None, ip: str) -> tuple[dict, bool]:
    """Reuse an open lead (same phone + project, not Lost/Converted); else create one with round-robin assignment."""
    lead = await db.leads.find_one({"company_id": cid, "phone": phone, "project_id": project["id"], "status": {"$nin": ["Lost", "Converted"]}}, {"_id": 0})
    if lead:
        return lead, False
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    ts = now_iso()
    lead = {**base_doc(None, cid), "lead_number": await generate_number("lead", company), "name": name, "phone": phone, "email": email, "project_id": project["id"], "project_name": project["name"], "flat_type_id": None, "flat_id": None, "flat_number": None,
            "budget_min": None, "budget_max": None, "source": source, "status": "New", "stage_history": [{"status": "New", "at": ts, "by": None, "note": note}], "assigned_to": await _assignee(cid), "notes": None, "follow_ups": [], "activities": [],
            "next_follow_up_at": None, "lost_reason": None, "converted_customer_id": None, "utm": utm or {}, "ip": ip, "is_read": False}
    await db.leads.insert_one(lead)
    lead.pop("_id", None)
    await write_audit(None, "lead.create", "lead", lead["id"], after={"lead_number": lead["lead_number"], "source": source, "project": project["name"]}, company_id=cid)
    return lead, True


async def notify_user(cid: str, user_id: str | None, title: str, body: str, kind: str, entity_type: str, entity_id: str, link: str | None = None):
    if not user_id:
        return
    await db.notifications.insert_one({**base_doc(None, cid), "user_id": user_id, "title": title, "body": body, "kind": kind, "entity_type": entity_type, "entity_id": entity_id, "link": link, "read": False, "created_at": now_iso()})


async def _project_by_slug(slug: str) -> dict:
    p = await db.projects.find_one({"website.slug": slug, "website.is_published": True, "is_active": True}, {"_id": 0})
    if not p:
        raise ApiError(404, "Project not found", "NOT_FOUND")
    return p


# =====================================================================
# A. Brochure lead gate
# =====================================================================
class BrochureIn(StrictModel):
    project_slug: str
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    consent: bool
    utm: dict[str, str] | None = None
    website: str | None = Field(default=None, max_length=200)  # honeypot

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)


@pub.post("/brochure-requests")
async def brochure_request(body: BrochureIn, request: Request):
    ip = client_ip(request)
    await enforce_rate_limit(f"brochure:{ip}", 5, 60)
    if body.website:
        return {"ok": True, "reference": None, "download_url": None}
    if not body.consent:
        raise ApiError(422, "Consent is required", "VALIDATION_ERROR")
    p = await _project_by_slug(body.project_slug)
    web = p.get("website") or {}
    if not web.get("brochure_document_id"):
        raise ApiError(404, "This project has no brochure yet", "NO_BROCHURE")
    if web.get("brochure_gate_enabled") is False:
        raise ApiError(409, "Brochure gate is disabled for this project", "GATE_DISABLED")
    cid = p["company_id"]
    lead, created = await upsert_lead(cid, p, body.name, body.phone, body.email, "Brochure", "Brochure download", body.utm, ip)
    await add_activity(lead["id"], "brochure_downloaded", f"Downloaded brochure — {p['name']}", {"project_id": p["id"], "project_name": p["name"], "ip": ip})
    await notify_user(cid, lead.get("assigned_to"), "Brochure downloaded", f"{body.name} · {p['name']}", "lead.brochure", "lead", lead["id"], f"/leads?open={lead['id']}")
    token = sign({"t": "brochure", "p": p["id"], "l": lead["id"], "n": new_id()[:8]}, 15)
    return {"ok": True, "reference": lead["lead_number"], "new_lead": created, "download_url": f"/api/public/brochure/{token}"}


@pub.get("/brochure/{token}")
async def brochure_download(token: str):
    if len(token) < 40 or "." not in token:  # legacy doc-id links are handled by public.py; this route only serves signed tokens
        raise ApiError(404, "Not found", "NOT_FOUND")
    t = unsign(token)
    if t.get("t") != "brochure":
        raise ApiError(404, "Not found", "NOT_FOUND")
    p = await db.projects.find_one({"id": t["p"]}, {"_id": 0, "id": 1, "name": 1, "website.brochure_document_id": 1})
    d = await db.documents.find_one({"id": (p or {}).get("website", {}).get("brochure_document_id"), "is_active": True}, {"_id": 0}) if p else None
    if not d:
        raise ApiError(404, "Brochure not found", "NOT_FOUND")
    first = await db.brochure_tokens.update_one({"nonce": t["n"]}, {"$setOnInsert": {"nonce": t["n"], "at": now_iso(), "expires_at": datetime.now(UTC) + timedelta(hours=1)}}, upsert=True)
    if first.upserted_id is not None:
        await db.projects.update_one({"id": p["id"]}, {"$inc": {"website.brochure_download_count": 1}})
        await db.brochure_downloads.insert_one({"id": new_id(), "project_id": p["id"], "lead_id": t.get("l"), "at": now_iso()})
    data, ctype = await get_object(d["storage_key"])
    return Response(content=data, media_type=d.get("mime") or ctype or "application/pdf", headers={"Content-Disposition": f'attachment; filename="{d["file_name"]}"', "Cache-Control": "private, no-store"})


@router.get("/brochure-stats")
async def brochure_stats(project_id: str | None = None, user: dict = Depends(require("sales.lead.view"))):
    since = (clock.today() - timedelta(days=29)).isoformat()
    q = {"at": {"$gte": since}, **({"project_id": project_id} if project_id else {})}
    rows = await db.brochure_downloads.aggregate([{"$match": q}, {"$group": {"_id": {"$substr": ["$at", 0, 10]}, "n": {"$sum": 1}}}]).to_list(None)
    by = {r["_id"]: r["n"] for r in rows}
    days = [(clock.today() - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    week = (clock.today() - timedelta(days=6)).isoformat()
    lq = {"company_id": user["company_id"], "source": "Brochure", "created_at": {"$gte": week}, **project_scope_filter(user)}
    total = await db.projects.find_one({"id": project_id}, {"_id": 0, "website.brochure_download_count": 1}) if project_id else None
    return {"series": [{"date": d, "count": by.get(d, 0)} for d in days], "last_30": sum(by.values()), "total": ((total or {}).get("website") or {}).get("brochure_download_count", 0), "brochure_leads_week": await db.leads.count_documents(lq)}


# =====================================================================
# B. Site visits
# =====================================================================
def visit_settings(p: dict) -> dict:
    return {**VISIT_DEFAULTS, **((p.get("website") or {}).get("site_visits") or {})}


def _slots_for(cfg: dict, d: date, now_ist: datetime) -> list[tuple[str, str]]:
    if not cfg["enabled"] or d.weekday() not in cfg["visit_days"] or d.isoformat() in cfg["blackout_dates"]:
        return []
    if d > now_ist.date() + timedelta(days=cfg["max_days_ahead"]):
        return []
    sh, sm = map(int, cfg["start_time"].split(":"))
    eh, em = map(int, cfg["end_time"].split(":"))
    cur = datetime(d.year, d.month, d.day, sh, sm, tzinfo=IST)
    end = datetime(d.year, d.month, d.day, eh, em, tzinfo=IST)
    out = []
    while cur + timedelta(minutes=cfg["slot_minutes"]) <= end:
        if cur >= now_ist + timedelta(hours=cfg["min_lead_hours"]):
            out.append((cur.strftime("%H:%M"), (cur + timedelta(minutes=cfg["slot_minutes"])).strftime("%H:%M")))
        cur += timedelta(minutes=cfg["slot_minutes"])
    return out


async def availability(p: dict, d_from: date, d_to: date) -> list[dict]:
    cfg = visit_settings(p)
    now_ist = datetime.now(IST)
    booked = await db.site_visits.aggregate([{"$match": {"project_id": p["id"], "date": {"$gte": d_from.isoformat(), "$lte": d_to.isoformat()}, "status": {"$nin": ["Cancelled"]}}}, {"$group": {"_id": {"d": "$date", "s": "$slot_start"}, "n": {"$sum": 1}}}]).to_list(None)
    cnt = {(b["_id"]["d"], b["_id"]["s"]): b["n"] for b in booked}
    days = []
    d = d_from
    while d <= d_to:
        slots = [{"start": s, "end": e, "available_count": max(cfg["capacity_per_slot"] - cnt.get((d.isoformat(), s), 0), 0)} for s, e in _slots_for(cfg, d, now_ist)]
        days.append({"date": d.isoformat(), "slots": [s for s in slots if s["available_count"] > 0]})
        d += timedelta(days=1)
    return days


@pub.get("/site-visits/availability")
async def public_availability(project_slug: str, from_: str | None = Query(default=None, alias="from"), to: str | None = None, from_compat: str | None = Query(default=None, alias="from_")):
    p = await _project_by_slug(project_slug)
    from_ = from_ or from_compat
    d_from = date.fromisoformat(from_) if from_ else datetime.now(IST).date()
    d_to = min(date.fromisoformat(to) if to else d_from + timedelta(days=13), d_from + timedelta(days=45))
    ck = f"avail:{p['id']}:{d_from}:{d_to}"
    hit = ttlcache.get(ck)
    if hit is None:
        cfg = visit_settings(p)
        hit = {"project": {"name": p["name"], "slug": project_slug, "enabled": cfg["enabled"], "slot_minutes": cfg["slot_minutes"], "site_office_address": cfg["site_office_address"], "maps_url": cfg["maps_url"], "instructions": cfg["instructions"]}, "days": await availability(p, d_from, d_to)}
        ttlcache.put(ck, hit, 60)
    return hit


class VisitPublicIn(StrictModel):
    project_slug: str
    date: str
    slot_start: str
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    visitors_count: int = Field(default=1, ge=1, le=6)
    message: str | None = Field(default=None, max_length=500)
    consent: bool
    utm: dict[str, str] | None = None
    website: str | None = Field(default=None, max_length=200)

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)


async def _reserve(p: dict, d: str, slot_start: str, exclude_id: str | None = None) -> str:
    """Atomic capacity check: insert a reservation marker then recount; roll back if over capacity."""
    cfg = visit_settings(p)
    now_ist = datetime.now(IST)
    slots = dict(_slots_for(cfg, date.fromisoformat(d), now_ist))
    if slot_start not in slots:
        raise ApiError(409, "That slot is not available", "SLOT_UNAVAILABLE")
    q = {"project_id": p["id"], "date": d, "slot_start": slot_start, "status": {"$nin": ["Cancelled"]}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    if await db.site_visits.count_documents(q) >= cfg["capacity_per_slot"]:
        raise ApiError(409, "This slot is now full — please pick another", "SLOT_FULL")
    return slots[slot_start]


async def create_visit(p: dict, lead: dict | None, d: str, slot_start: str, name: str, phone: str, email: str | None, visitors: int, notes: str | None, source: str, by: str | None, customer_id: str | None = None) -> dict:
    cid = p["company_id"]
    slot_end = await _reserve(p, d, slot_start)
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    v = {**base_doc(None, cid), "visit_number": await generate_number("visit", {**company, "visit_number_format": company.get("visit_number_format") or "SV-{FY}-{SEQ}"}), "lead_id": (lead or {}).get("id"), "customer_id": customer_id, "project_id": p["id"], "project_name": p["name"],
         "date": d, "slot_start": slot_start, "slot_end": slot_end, "name": name, "phone": phone, "email": email, "visitors_count": visitors, "status": "Confirmed", "assigned_to": (lead or {}).get("assigned_to"), "source": source, "notes": notes,
         "timeline": [{"at": now_iso(), "by": by, "event": "booked", "note": f"{source}: {d} {slot_start}"}]}
    await db.site_visits.insert_one(v)
    v.pop("_id", None)
    cfg = visit_settings(p)
    if await db.site_visits.count_documents({"project_id": p["id"], "date": d, "slot_start": slot_start, "status": {"$nin": ["Cancelled"]}}) > cfg["capacity_per_slot"]:
        await db.site_visits.delete_one({"id": v["id"]})
        raise ApiError(409, "This slot is now full — please pick another", "SLOT_FULL")
    ttlcache.invalidate(f"avail:{p['id']}")
    if lead:
        if lead.get("status") in ("New", "Contacted"):
            await db.leads.update_one({"id": lead["id"]}, {"$set": {"status": "Site Visit Scheduled", "updated_at": now_iso()}, "$push": {"stage_history": {"status": "Site Visit Scheduled", "at": now_iso(), "by": by, "note": v["visit_number"]}}})
        await add_activity(lead["id"], "site_visit_booked", f"Site visit booked — {p['name']} · {fmt_date(d)} {slot_start}", {"visit_id": v["id"], "visit_number": v["visit_number"], "date": d, "slot_start": slot_start}, by)
    await notify_user(cid, v["assigned_to"], "Site visit booked", f"{name} · {p['name']} · {fmt_date(d)} {slot_start}", "visit.booked", "site_visit", v["id"], "/site-visits")
    await notify_roles(cid, ["Sales"], "Site visit booked", f"{v['visit_number']} · {name} · {p['name']} · {fmt_date(d)} {slot_start}", "visit.booked", "site_visit", v["id"], "/site-visits")
    await write_audit(None if not by else {"id": by, "company_id": cid}, "visit.create", "site_visit", v["id"], after={"visit_number": v["visit_number"], "date": d, "slot": slot_start}, company_id=cid)
    return {k: val for k, val in v.items() if k != "_id"}


def fmt_date(d: str) -> str:
    return date.fromisoformat(d).strftime("%d %b %Y")


def _public_visit(v: dict, p: dict) -> dict:
    cfg = visit_settings(p)
    token = sign({"t": "visit", "v": v["id"]}, visit_link_minutes(v["date"]))
    return {"visit_number": v["visit_number"], "date": v["date"], "slot": f"{v['slot_start']}–{v['slot_end']}", "slot_start": v["slot_start"], "slot_end": v["slot_end"], "status": v["status"], "name": v["name"], "visitors_count": v["visitors_count"], "project": p["name"],
            "address": cfg["site_office_address"], "maps_url": cfg["maps_url"], "instructions": cfg["instructions"], "ics_url": f"/api/public/site-visits/{token}.ics", "manage_url": f"/visit/{token}", "token": token}


@pub.post("/site-visits", status_code=201)
async def public_book(body: VisitPublicIn, request: Request):
    ip = client_ip(request)
    await enforce_rate_limit(f"visit:{ip}", 5, 60)
    if body.website:
        return {"ok": True, "visit_number": None}
    if not body.consent:
        raise ApiError(422, "Consent is required", "VALIDATION_ERROR")
    p = await _project_by_slug(body.project_slug)
    if not visit_settings(p)["enabled"]:
        raise ApiError(409, "Site visits are not open for this project", "VISITS_DISABLED")
    lead, _ = await upsert_lead(p["company_id"], p, body.name, body.phone, body.email, "Site Visit", "Site visit booking", body.utm, ip)
    v = await create_visit(p, lead, body.date, body.slot_start, body.name, body.phone, body.email, body.visitors_count, body.message, "Website", None)
    return _public_visit(v, p)


def visit_link_minutes(visit_date: str) -> int:
    """Signed manage/ICS links expire 7 days after the visit date."""
    end = datetime.combine(date.fromisoformat(visit_date) + timedelta(days=7), datetime.min.time(), tzinfo=IST)
    return max(1, int((end - datetime.now(IST)).total_seconds() // 60))


async def _visit_from_token(token: str) -> tuple[dict, dict]:
    t = unsign(token)
    v = await db.site_visits.find_one({"id": t.get("v")}, {"_id": 0}) if t.get("t") == "visit" else None
    if not v:
        raise ApiError(404, "Visit not found", "NOT_FOUND")
    if v["status"] in ("Completed", "No-show"):
        raise ApiError(410, "This link is no longer valid", "LINK_REVOKED")
    return v, await db.projects.find_one({"id": v["project_id"]}, {"_id": 0})


@pub.get("/site-visits/{token}.ics")
async def visit_ics(token: str):
    v, p = await _visit_from_token(token)
    cfg = visit_settings(p)
    d = date.fromisoformat(v["date"])
    st = datetime(d.year, d.month, d.day, *map(int, v["slot_start"].split(":")), tzinfo=IST)
    en = datetime(d.year, d.month, d.day, *map(int, v["slot_end"].split(":")), tzinfo=IST)
    esc = lambda s: (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
    ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KKT//Site Visits//EN", "BEGIN:VTIMEZONE", "TZID:Asia/Kolkata", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "TZNAME:IST", "END:STANDARD", "END:VTIMEZONE",
                       "BEGIN:VEVENT", f"UID:{v['id']}@kkt", f"DTSTAMP:{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}", f"DTSTART;TZID=Asia/Kolkata:{st.strftime('%Y%m%dT%H%M%S')}", f"DTEND;TZID=Asia/Kolkata:{en.strftime('%Y%m%dT%H%M%S')}",
                       f"SUMMARY:{esc('Site visit — ' + p['name'])}", f"LOCATION:{esc(cfg['site_office_address'])}", f"DESCRIPTION:{esc(v['visit_number'] + '. ' + (cfg['instructions'] or ''))}", f"URL:{esc(cfg['maps_url'])}", f"STATUS:{'CANCELLED' if v['status'] == 'Cancelled' else 'CONFIRMED'}",
                       "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Site visit in 1 hour", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""])
    return Response(content=ics, media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{v["visit_number"]}.ics"', "Cache-Control": "private, no-store"})


@pub.get("/site-visits/{token}")
async def visit_public_detail(token: str):
    v, p = await _visit_from_token(token)
    return _public_visit(v, p)


class CancelIn(StrictModel):
    reason: str | None = Field(default=None, max_length=300)


async def _set_status(v: dict, status: str, by: str | None, note: str | None, activity: str, title: str):
    await db.site_visits.update_one({"id": v["id"]}, {"$set": {"status": status, "updated_at": now_iso(), **({"cancel_reason": note} if status == "Cancelled" else {})}, "$push": {"timeline": {"at": now_iso(), "by": by, "event": status.lower(), "note": note}}})
    ttlcache.invalidate(f"avail:{v['project_id']}")
    if v.get("lead_id"):
        await add_activity(v["lead_id"], activity, f"{title} — {v['project_name']} · {fmt_date(v['date'])} {v['slot_start']}", {"visit_id": v["id"], "visit_number": v["visit_number"], "note": note}, by)
        if status in ("Completed", "No-show"):
            lead = await db.leads.find_one({"id": v["lead_id"]}, {"_id": 0, "status": 1})
            if lead and lead["status"] in ("New", "Contacted", "Site Visit Scheduled") and status == "Completed":
                await db.leads.update_one({"id": v["lead_id"]}, {"$set": {"status": "Site Visit Done", "updated_at": now_iso()}, "$push": {"stage_history": {"status": "Site Visit Done", "at": now_iso(), "by": by, "note": v["visit_number"]}}})
        if status == "Cancelled":
            lead = await db.leads.find_one({"id": v["lead_id"]}, {"_id": 0, "status": 1, "stage_history": 1})
            still_open = await db.site_visits.count_documents({"lead_id": v["lead_id"], "id": {"$ne": v["id"]}, "status": {"$in": ["Confirmed", "Rescheduled"]}, "date": {"$gte": datetime.now(IST).date().isoformat()}})
            if lead and lead["status"] == "Site Visit Scheduled" and not still_open:
                prev = next((h["status"] for h in reversed(lead.get("stage_history") or []) if h["status"] != "Site Visit Scheduled"), "New")
                await db.leads.update_one({"id": v["lead_id"]}, {"$set": {"status": prev, "updated_at": now_iso()}, "$push": {"stage_history": {"status": prev, "at": now_iso(), "by": by, "note": f"Reverted — {v['visit_number']} cancelled"}}})
                await add_activity(v["lead_id"], "stage_reverted", f"Stage reverted to {prev} — no upcoming site visit", {"visit_number": v["visit_number"]}, by)


@pub.post("/site-visits/{token}/cancel")
async def visit_public_cancel(token: str, body: CancelIn):
    v, p = await _visit_from_token(token)
    if v["status"] in ("Cancelled", "Completed", "No-show"):
        raise ApiError(409, f"Visit is already {v['status']}", "INVALID_STATE")
    await _set_status(v, "Cancelled", None, body.reason or "Cancelled by visitor", "site_visit_cancelled", "Site visit cancelled by visitor")
    await notify_user(p["company_id"], v.get("assigned_to"), "Site visit cancelled", f"{v['name']} · {p['name']} · {fmt_date(v['date'])} {v['slot_start']}", "visit.cancelled", "site_visit", v["id"], "/site-visits")
    await write_audit({"id": f"visitor:{v['id']}", "name": v.get("name") or "Visitor", "company_id": p["company_id"]}, "visit.cancel", "site_visit", v["id"], before={"visit_number": v.get("visit_number"), "status": v["status"]}, after={"visit_number": v.get("visit_number"), "status": "Cancelled", "reason": body.reason}, company_id=p["company_id"])
    return _public_visit({**v, "status": "Cancelled"}, p)


# ---------- ERP ----------
@router.get("", response_model=VisitsOutPage, response_model_exclude_unset=True)
async def list_visits(params: ListParams = Depends(), project_id: str | None = None, status: str | None = None, assigned_to: str | None = None, date_from: str | None = None, date_to: str | None = None, lead_id: str | None = None, user: dict = Depends(require("sales.site_visit.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user)}
    if project_id: q["project_id"] = project_id
    if status: q["status"] = status
    if assigned_to: q["assigned_to"] = assigned_to
    if lead_id: q["lead_id"] = lead_id
    if date_from or date_to: q["date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    if params.search: q["$or"] = [{"name": {"$regex": params.search, "$options": "i"}}, {"phone": {"$regex": params.search}}, {"visit_number": {"$regex": params.search, "$options": "i"}}]
    res = await paginate(db.site_visits, q, params, params.sort_spec(["date", "slot_start", "name", "status", "created_at"], "date"))
    users = {u["id"]: u["name"] for u in await db.users.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    for v in res["items"]:
        v["assigned_to_name"] = users.get(v.get("assigned_to"))
    return res


@router.get("/export")
async def export_visits(project_id: str | None = None, status: str | None = None, date_from: str | None = None, date_to: str | None = None, user: dict = Depends(require("sales.site_visit.export"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user)}
    if project_id: q["project_id"] = project_id
    if status: q["status"] = status
    if date_from or date_to: q["date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    rows = await db.site_visits.find(q, {"_id": 0}).sort([("date", 1), ("slot_start", 1)]).to_list(5000)
    return Response(content=to_csv(rows, ["visit_number", "date", "slot_start", "slot_end", "name", "phone", "email", "project_name", "visitors_count", "status", "source", "notes"]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="site-visits.csv"'})


@router.get("/today")
async def today_visits(user: dict = Depends(require("sales.site_visit.view"))):
    today = datetime.now(IST).date().isoformat()
    q = {"company_id": user["company_id"], "date": today, "status": {"$nin": ["Cancelled"]}, **project_scope_filter(user)}
    if user.get("role_name") == "Sales":
        q["assigned_to"] = user["id"]
    items = await db.site_visits.find(q, {"_id": 0}).sort("slot_start", 1).to_list(100)
    users = {u["id"]: u["name"] for u in await db.users.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    return {"date": today, "items": [{**v, "assigned_to_name": users.get(v.get("assigned_to"))} for v in items]}


@router.get("/calendar")
async def calendar(date_from: str, date_to: str, project_id: str | None = None, user: dict = Depends(require("sales.site_visit.view"))):
    q = {"company_id": user["company_id"], "date": {"$gte": date_from, "$lte": date_to}, **project_scope_filter(user)}
    if project_id: q["project_id"] = project_id
    items = await db.site_visits.find(q, {"_id": 0}).sort([("date", 1), ("slot_start", 1)]).to_list(2000)
    projects = await db.projects.find({"company_id": user["company_id"], "is_active": True, **project_scope_filter(user, "id")}, {"_id": 0, "id": 1, "name": 1, "website.site_visits": 1}).to_list(50)
    users = {u["id"]: u["name"] for u in await db.users.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    return {"projects": [{"id": p["id"], "name": p["name"], "settings": visit_settings(p)} for p in projects], "items": [{**v, "assigned_to_name": users.get(v.get("assigned_to"))} for v in items]}


@router.get("/availability")
async def erp_availability(project_id: str, date_from: str, date_to: str, user: dict = Depends(require("sales.site_visit.view"))):
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    return {"days": await availability(p, date.fromisoformat(date_from), date.fromisoformat(date_to))}


class VisitIn(StrictModel):
    project_id: str
    date: str
    slot_start: str
    lead_id: str | None = None
    customer_id: str | None = None
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = None
    email: str | None = None
    visitors_count: int = Field(default=1, ge=1, le=6)
    notes: str | None = Field(default=None, max_length=500)


@router.post("", status_code=201)
async def erp_create(body: VisitIn, request: Request, user: dict = Depends(require("sales.site_visit.create"))):
    p = await get_or_404(db.projects, body.project_id, "Project", {"company_id": user["company_id"]})
    lead = await db.leads.find_one({"id": body.lead_id}, {"_id": 0}) if body.lead_id else None
    cust = await db.customers.find_one({"id": body.customer_id}, {"_id": 0, "full_name": 1, "phone": 1, "email": 1}) if body.customer_id else None
    name = body.name or (lead or {}).get("name") or (cust or {}).get("full_name")
    phone = body.phone or (lead or {}).get("phone") or (cust or {}).get("phone")
    if not name or not phone:
        raise ApiError(422, "Name and phone are required (or pick a lead/customer)", "VALIDATION_ERROR")
    v = await create_visit(p, lead, body.date, body.slot_start, name, normalize_phone(phone), body.email or (lead or {}).get("email") or (cust or {}).get("email"), body.visitors_count, body.notes, "ERP", user["id"], body.customer_id)
    if not lead:
        await db.site_visits.update_one({"id": v["id"]}, {"$set": {"assigned_to": user["id"]}})
    return v


class RescheduleIn(StrictModel):
    date: str
    slot_start: str
    note: str | None = Field(default=None, max_length=300)


@router.post("/{visit_id}/reschedule")
async def reschedule(visit_id: str, body: RescheduleIn, request: Request, user: dict = Depends(require("sales.site_visit.edit"))):
    v = await get_or_404(db.site_visits, visit_id, "Visit", {"company_id": user["company_id"]})
    if v["status"] in ("Cancelled", "Completed", "No-show"):
        raise ApiError(409, f"Visit is {v['status']}", "INVALID_STATE")
    p = await get_or_404(db.projects, v["project_id"], "Project")
    end = await _reserve(p, body.date, body.slot_start, exclude_id=visit_id)
    await db.site_visits.update_one({"id": visit_id}, {"$set": {"date": body.date, "slot_start": body.slot_start, "slot_end": end, "status": "Rescheduled", "updated_at": now_iso()}, "$push": {"timeline": {"at": now_iso(), "by": user["id"], "event": "rescheduled", "note": f"{v['date']} {v['slot_start']} → {body.date} {body.slot_start}. {body.note or ''}"}}})
    ttlcache.invalidate(f"avail:{p['id']}")
    if v.get("lead_id"):
        await add_activity(v["lead_id"], "site_visit_rescheduled", f"Site visit rescheduled — {p['name']} · {fmt_date(body.date)} {body.slot_start}", {"visit_id": visit_id, "visit_number": v["visit_number"]}, user["id"])
    await write_audit(user, "visit.reschedule", "site_visit", visit_id, before={"date": v["date"], "slot": v["slot_start"]}, after={"date": body.date, "slot": body.slot_start}, ip=client_ip(request))
    return await db.site_visits.find_one({"id": visit_id}, {"_id": 0})


class OutcomeIn(StrictModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/{visit_id}/{action}")
async def visit_action(visit_id: str, action: str, body: OutcomeIn, request: Request, user: dict = Depends(require_any("sales.site_visit.cancel", "sales.site_visit.complete", "sales.site_visit.edit"))):
    v = await get_or_404(db.site_visits, visit_id, "Visit", {"company_id": user["company_id"]})
    m = {"confirm": ("Confirmed", "site_visit_booked", "Site visit confirmed"), "cancel": ("Cancelled", "site_visit_cancelled", "Site visit cancelled"), "complete": ("Completed", "site_visit_completed", "Site visit completed"), "no-show": ("No-show", "site_visit_no_show", "Site visit no-show")}
    if action not in m:
        raise ApiError(404, "Unknown action", "NOT_FOUND")
    if action == "cancel" and not body.note:
        raise ApiError(422, "A reason is required to cancel", "VALIDATION_ERROR")
    if v["status"] in ("Cancelled", "Completed", "No-show") and action != "confirm":
        raise ApiError(409, f"Visit is already {v['status']}", "INVALID_STATE")
    status, activity, title = m[action]
    await _set_status(v, status, user["id"], body.note, activity, title)
    await write_audit(user, f"visit.{action}", "site_visit", visit_id, before={"status": v["status"]}, after={"status": status}, ip=client_ip(request))
    return await db.site_visits.find_one({"id": visit_id}, {"_id": 0})


class NoteIn(StrictModel):
    notes: str | None = Field(default=None, max_length=1000)


@router.patch("/{visit_id}")
async def visit_notes(visit_id: str, body: NoteIn, user: dict = Depends(require("sales.site_visit.edit"))):
    before = await get_or_404(db.site_visits, visit_id, "Visit", {"company_id": user["company_id"]})
    await db.site_visits.update_one({"id": visit_id}, {"$set": {"notes": body.notes, "updated_at": now_iso()}})
    after = await db.site_visits.find_one({"id": visit_id}, {"_id": 0})
    await write_audit(user, "visit.update", "site_visit", visit_id, before={"visit_number": before.get("visit_number"), "notes": before.get("notes")}, after={"visit_number": before.get("visit_number"), "notes": body.notes})
    return after


# ---------- daily nudge ----------
async def nudge_loop():
    while True:
        try:
            today = datetime.now(IST).date().isoformat()
            async for v in db.site_visits.find({"date": {"$lt": today}, "status": {"$in": ["Confirmed", "Rescheduled"]}, "nudged_on": {"$ne": today}}, {"_id": 0}):
                await notify_user(v["company_id"], v.get("assigned_to"), "Mark outcome", f"{v['visit_number']} · {v['name']} · {v['project_name']} · {fmt_date(v['date'])} — mark Completed or No-show", "visit.nudge", "site_visit", v["id"], "/site-visits")
                await db.site_visits.update_one({"id": v["id"]}, {"$set": {"nudged_on": today}})
        except Exception as e:  # pragma: no cover
            log.warning("nudge loop: %s", e)
        await asyncio.sleep(6 * 3600)


# ---------- seed ----------
async def seed_phase9():
    if await db.settings.find_one({"key": "seed_phase9_done"}):
        return
    cid = await _company_id()
    projects = await db.projects.find({"company_id": cid, "website.is_published": True}, {"_id": 0}).to_list(10)
    if not projects:
        return
    from services.pdf import brochure_pdf
    from storage import put_object
    for p in projects:
        code = (p.get("code") or "").upper()
        cfg = {**VISIT_DEFAULTS, "enabled": True, "site_office_address": f"{p['name']} site office, {((p.get('address') or {}).get('line1') or 'Patna')}, Patna", "maps_url": "https://maps.google.com/?q=" + (p['name'].replace(" ", "+") + "+Patna"), "instructions": "Please carry a photo ID. Parking is available at the site office."}
        if code == "GGV":
            cfg.update({"visit_days": [5, 6], "start_time": "10:00", "end_time": "16:00"})
        upd = {"website.site_visits": cfg, "website.brochure_gate_enabled": True}
        if not (p.get("website") or {}).get("brochure_document_id"):
            pdf = brochure_pdf(p)
            key = f"brochures/{p['id']}.pdf"
            await put_object(key, pdf, "application/pdf")
            doc = {**base_doc(None, cid), "entity_type": "project", "entity_id": p["id"], "document_type_id": None, "document_type_name": "Brochure", "title": f"{p['name']} brochure", "file_name": f"{(p.get('website') or {}).get('slug') or code.lower()}-brochure.pdf", "mime": "application/pdf", "size": len(pdf), "storage_key": key, "is_sensitive": False, "shared_with_customer": True, "uploaded_by": None}
            await db.documents.insert_one(doc)
            upd["website.brochure_document_id"] = doc["id"]
        await db.projects.update_one({"id": p["id"]}, {"$set": upd})
    projects = await db.projects.find({"company_id": cid, "website.is_published": True}, {"_id": 0}).to_list(10)
    leads = await db.leads.find({"company_id": cid, "status": {"$nin": ["Lost", "Converted"]}}, {"_id": 0}).to_list(30)
    today = datetime.now(IST).date()
    sgh = next((p for p in projects if (p.get("code") or "").upper() == "SGH"), projects[0])
    ggv = next((p for p in projects if (p.get("code") or "").upper() == "GGV"), projects[-1])
    plan = []
    for i in range(6):  # upcoming
        p = sgh if i % 3 else ggv
        d = today + timedelta(days=1 + i)
        while d.weekday() not in visit_settings(p)["visit_days"]:
            d += timedelta(days=1)
        plan.append((p, d, ["11:00", "12:00", "15:00"][i % 3], "Confirmed"))
    for i, st in enumerate(["Completed", "Completed", "No-show", "Confirmed"]):  # past
        plan.append((sgh, today - timedelta(days=2 + i), "11:00", st))
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    for k, (p, d, slot, st) in enumerate(plan):
        lead = leads[k % len(leads)] if leads else None
        sm = int(slot[:2])
        v = {**base_doc(None, cid), "visit_number": await generate_number("visit", {**company, "visit_number_format": "SV-{FY}-{SEQ}"}), "lead_id": (lead or {}).get("id"), "customer_id": None, "project_id": p["id"], "project_name": p["name"], "date": d.isoformat(), "slot_start": slot, "slot_end": f"{sm + 1:02d}:00",
             "name": (lead or {}).get("name") or f"Visitor {k + 1}", "phone": (lead or {}).get("phone") or f"98765432{k:02d}", "email": (lead or {}).get("email"), "visitors_count": 1 + k % 3, "status": st, "assigned_to": (lead or {}).get("assigned_to"), "source": "Website" if k % 2 else "ERP", "notes": None,
             "timeline": [{"at": now_iso(), "by": None, "event": "booked", "note": "seed"}]}
        await db.site_visits.insert_one(v)
        v.pop("_id", None)
        if lead:
            await add_activity(lead["id"], "site_visit_booked", f"Site visit booked — {p['name']} · {fmt_date(v['date'])} {slot}", {"visit_id": v["id"], "visit_number": v["visit_number"]})
            if st in ("Completed", "No-show"):
                await add_activity(lead["id"], "site_visit_completed" if st == "Completed" else "site_visit_no_show", f"Site visit {st.lower()} — {p['name']} · {fmt_date(v['date'])} {slot}", {"visit_id": v["id"], "visit_number": v["visit_number"]})
    for k in range(5):
        lead = leads[(k * 2) % len(leads)] if leads else None
        p = projects[k % len(projects)]
        if lead:
            at = (datetime.now(UTC) - timedelta(days=k * 3)).isoformat()
            await add_activity(lead["id"], "brochure_downloaded", f"Downloaded brochure — {p['name']}", {"project_id": p["id"], "project_name": p["name"]})
            await db.brochure_downloads.insert_one({"id": new_id(), "project_id": p["id"], "lead_id": lead["id"], "at": at})
            await db.projects.update_one({"id": p["id"]}, {"$inc": {"website.brochure_download_count": 1}})
    await db.site_visits.create_index([("project_id", 1), ("date", 1), ("slot_start", 1)])
    await db.brochure_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.settings.update_one({"key": "seed_phase9_done"}, {"$set": {"value": True}}, upsert=True)
    log.info("[phase9] seeded visits=%s", len(plan))
