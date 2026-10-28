"""Z.2 — co-applicant KYC files (files pipeline, kind kyc_pan / kyc_aadhaar / kyc_other). Files are private, signed-URL only; the number itself
is never captured here (sealed fields on the co-applicant record). Access: sales.kyc.reveal, or sales.customer.edit with an audited kyc.view."""
from db import db
from utils import ApiError, write_audit

KYC_KINDS = ("kyc_pan", "kyc_aadhaar", "kyc_other")
REQUIRED = ("kyc_pan", "kyc_aadhaar")
KYC_MAX = 10 * 1024 * 1024
KYC_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".heic")
LABEL = {"kyc_pan": "PAN", "kyc_aadhaar": "Aadhaar", "kyc_other": "Other ID"}


def can_open(user: dict) -> bool:
    p = user.get("permissions") or []
    return "sales.kyc.reveal" in p or "sales.customer.edit" in p


async def gate(user: dict, f: dict, ip: str = ""):
    """Raise 403 for users who may not open KYC files; otherwise record an audited kyc.view."""
    if not can_open(user):
        raise ApiError(403, "KYC document: sales.kyc.reveal or sales.customer.edit required", "FORBIDDEN")
    await write_audit(user, "kyc.view", "file", f["id"], after={"kind": f.get("kind"), "co_applicant_id": f.get("entity_id"), "customer_id": f.get("customer_id")}, ip=ip)


async def files_for(co_applicant_ids: list[str]) -> dict[str, dict]:
    """{co_applicant_id: {kyc_pan: file_id|None, kyc_aadhaar: ..., kyc_other: ...}} — newest active file per kind."""
    out = {i: {k: None for k in KYC_KINDS} for i in co_applicant_ids}
    if not co_applicant_ids:
        return out
    rows = await db.files.find({"entity_type": "co_applicant", "entity_id": {"$in": co_applicant_ids}, "kind": {"$in": list(KYC_KINDS)}, "is_active": True},
                               {"_id": 0, "id": 1, "entity_id": 1, "kind": 1, "created_at": 1}).sort("created_at", 1).to_list(None)
    for r in rows:
        out.setdefault(r["entity_id"], {k: None for k in KYC_KINDS})[r["kind"]] = r["id"]
    return out


def completeness(co_applicants: list[dict], files: dict[str, dict]) -> dict:
    """PAN + Aadhaar per co-applicant → {done, total, missing: [{name, kind, label}], complete}."""
    missing, done = [], 0
    for c in co_applicants:
        fk = files.get(c.get("id") or "", {})
        for k in REQUIRED:
            if fk.get(k):
                done += 1
            else:
                missing.append({"co_applicant_id": c.get("id"), "name": c.get("name"), "kind": k, "label": LABEL[k]})
    total = len(co_applicants) * len(REQUIRED)
    return {"done": done, "total": total, "missing": missing, "complete": total > 0 and not missing}


async def annotate(co_applicants: list[dict]) -> list[dict]:
    """Attach `kyc` (per-kind file ids + labels) to each co-applicant dict."""
    files = await files_for([c["id"] for c in co_applicants if c.get("id")])
    for c in co_applicants:
        c["kyc"] = files.get(c.get("id") or "", {k: None for k in KYC_KINDS})
    return co_applicants


async def link_on_booking(id_map: dict[str, str], customer_id: str, booking_id: str) -> None:
    """Wizard uploads happen before the booking exists (entity_id = client co-applicant id). Idempotent: $set only; a deduped id is remapped."""
    for client_id, final_id in id_map.items():
        await db.files.update_many({"entity_type": "co_applicant", "entity_id": client_id, "kind": {"$in": list(KYC_KINDS)}},
                                   {"$set": {"entity_id": final_id, "customer_id": customer_id, "booking_id": booking_id}})
