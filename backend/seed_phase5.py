import os

"""Phase 5 seed: portal accounts, service categories/requests, notices, construction photos, shared docs, SLA. Idempotent."""
import logging
from datetime import UTC, datetime, timedelta

import httpx

from db import db
from utils import base_doc, now_iso

logger = logging.getLogger("kkt.seed5")
PHOTO_URLS = ["https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=70", "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1200&q=70", "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=70",
              "https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=1200&q=70", "https://images.unsplash.com/photo-1590644365607-1c5a2e2f4e0c?auto=format&fit=crop&w=1200&q=70", "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1200&q=70"]


async def seed_phase5():
    if await db.settings.find_one({"key": "seed_phase5_done"}):
        return
    company = await db.companies.find_one({}, {"_id": 0})
    if not company or not await db.bookings.find_one({}):
        return
    cid = company["id"]
    logger.info("Applying Phase 5 seed...")
    from permissions import SYSTEM_ROLES
    for name, spec in SYSTEM_ROLES.items():
        await db.roles.update_one({"name": name, "is_system": True}, {"$set": {"permissions": spec["permissions"]}})
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    from core.passwords import hash_password
    pw = hash_password("Buyer@12345")
    # second booking for the owner's example customer (co-applicant on BK-2526-0002) to exercise the switcher
    c1 = await db.customers.find_one({"customer_code": "CUST-2526-0001"}, {"_id": 0, "id": 1})
    if c1:
        await db.bookings.update_one({"booking_number": "BK-2526-0002"}, {"$addToSet": {"co_applicant_customer_ids": c1["id"]}})
    async for c in db.customers.find({"company_id": cid}, {"_id": 0, "id": 1, "phone": 1}):
        phone = (c.get("phone") or "")[-10:]
        if len(phone) == 10 and not await db.portal_accounts.find_one({"customer_id": c["id"]}):
            await db.portal_accounts.insert_one({**base_doc(None, cid), "customer_id": c["id"], "login_phone": phone, "password_hash": pw, "must_change_password": False, "failed_attempts": 0, "locked_until": None, "last_login_at": None, "read_notice_ids": []})
    if await db.service_categories.count_documents({}) == 0:
        await db.service_categories.insert_many([{**base_doc(None, cid), "name": n, "order": i} for i, n in enumerate(["Payment query", "Document request", "Construction query", "Possession", "Defect/Snag", "Agreement", "Other"])])
    if os.environ.get("PORTAL_PUBLIC_URL"):
        await db.site_settings.update_many({"company_id": cid, "$or": [{"portal_url": None}, {"portal_url": {"$exists": False}}]}, {"$set": {"portal_url": os.environ["PORTAL_PUBLIC_URL"]}})
    await db.settings.update_one({"key": "sla_hours"}, {"$set": {"value": {"High": 24, "Medium": 72, "Low": 168}}}, upsert=True)
    sgh = await db.projects.find_one({"code": "SGH"}, {"_id": 0, "id": 1})
    if await db.notices.count_documents({}) == 0:
        await db.notices.insert_many([
            {**base_doc(None, cid), "title": "Diwali office hours & site visit slots", "body": "Our offices will remain open **10 am – 4 pm** during the festive week. Site visits can be booked through your Relationship Manager. Wishing all our families a happy and prosperous Diwali!", "project_ids": [], "project_names": [], "publish_at": now_iso(), "expires_at": None, "pinned": True},
            {**base_doc(None, cid), "title": "Shree Ganesh Heights — Tower A plastering begins", "body": "Internal plastering on floors 1–4 of Tower A starts next week. Expect intermittent water-tanker movement at the site gate between 8–11 am. The next construction-linked demand (Brickwork) will be raised after engineer certification.", "project_ids": [sgh["id"]] if sgh else [], "project_names": ["Shree Ganesh Heights"], "publish_at": now_iso(), "expires_at": (datetime.now(UTC) + timedelta(days=45)).isoformat(), "pinned": False},
        ])
    if await db.construction_photos.count_documents({}) == 0:
        from storage import put_object
        imgs = []
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as cl:
            for u in PHOTO_URLS:
                try:
                    r = await cl.get(u)
                    if r.status_code == 200 and r.content[:3] == b"\xff\xd8\xff":
                        imgs.append(r.content)
                except Exception:
                    pass
        if imgs:
            first_hidden_done = False
            async for blk in db.blocks.find({"company_id": cid}, {"_id": 0, "id": 1, "project_id": 1, "milestones": 1, "name": 1}):
                order = 0
                for m in blk.get("milestones") or []:
                    if m["status"] != "Completed":
                        continue
                    for k in range(2):
                        data = imgs[(m["seq"] + k) % len(imgs)]
                        res = await put_object(f"construction/{blk['project_id']}/{blk['id']}/{m['seq']}/seed-{k}.jpg", data, "image/jpeg")
                        order += 1
                        hidden = not first_hidden_done and k == 1
                        doc = {**base_doc(None, cid), "project_id": blk["project_id"], "block_id": blk["id"], "milestone_seq": m["seq"], "storage_key": res["path"], "mime": "image/jpeg", "size": len(data), "caption": f"{blk['name']} — {m['name']}{' (site engineer only)' if hidden else ''}", "taken_on": (m.get("completed_on") or now_iso()[:10]), "visible_to_customers": not hidden, "show_on_website": k == 0 and m["seq"] % 3 == 0, "order": order}
                        doc["url"] = f"/api/public/media/photo/{doc['id']}"
                        await db.construction_photos.insert_one(doc)
                        if hidden:
                            first_hidden_done = True
    if await db.service_requests.count_documents({}) == 0:
        from routers.portal import create_service_request
        bks = await db.bookings.find({"company_id": cid, "status": "Active"}, {"_id": 0}).sort("booking_number", 1).to_list(5)
        specs = [("Payment query", "High", "Receipt for NEFT not received", "I transferred the Plinth demand via NEFT on 3rd; please issue the receipt.", "In Progress"), ("Document request", "Low", "Need allotment letter copy", "Please share a signed copy of my allotment letter for my bank.", "Awaiting Customer"),
                 ("Construction query", "Medium", "When does brickwork start on 3rd floor?", "I visited the site; could you share the expected date for 3rd floor brickwork?", "Resolved"), ("Defect/Snag", "Medium", "Balcony railing height", "The sample flat balcony railing seems low; will the final one be 1.1 m?", "New"), ("Agreement", "Low", "Co-applicant name spelling", "My wife's name is misspelt in the agreement draft.", "Closed")]
        staff = await db.users.find_one({"email": "sales@kkt.in"}, {"_id": 0, "id": 1, "name": 1})
        for b, (cat, pr, subj, desc, status) in zip(bks, specs):
            c = await db.customers.find_one({"id": b["customer_id"]}, {"_id": 0})
            sr = await create_service_request(cid, c, b, cat, pr, subj, desc, [], "customer", c["full_name"], None)
            thread, hist, upd = [], [], {}
            if status != "New":
                thread.append({"by": "staff", "author_name": staff["name"], "author_id": staff["id"], "message": "Checking with the accounts team — internal: verify UTR in SBI statement." if cat == "Payment query" else "Thanks for writing in. We are looking into this.", "attachments": [], "at": now_iso(), "internal": False})
                thread.append({"by": "staff", "author_name": staff["name"], "author_id": staff["id"], "message": "INTERNAL NOTE: customer is a repeat buyer, prioritise.", "attachments": [], "at": now_iso(), "internal": True})
                hist.append({"from": "New", "to": "In Progress", "at": now_iso(), "by": staff["name"]})
                upd["status"] = "In Progress"
            if status == "Awaiting Customer":
                thread.append({"by": "staff", "author_name": staff["name"], "author_id": staff["id"], "message": "Could you confirm which bank branch needs the letter addressed to?", "attachments": [], "at": now_iso(), "internal": False})
                hist.append({"from": "In Progress", "to": "Awaiting Customer", "at": now_iso(), "by": staff["name"]}); upd["status"] = "Awaiting Customer"
            if status in ("Resolved", "Closed"):
                thread.append({"by": "staff", "author_name": staff["name"], "author_id": staff["id"], "message": "Brickwork on floors 1–4 is scheduled for the first week of next month. Marking resolved.", "attachments": [], "at": now_iso(), "internal": False})
                hist.append({"from": "In Progress", "to": "Resolved", "at": now_iso(), "by": staff["name"]}); upd.update({"status": "Resolved", "resolved_at": now_iso()})
            if status == "Closed":
                hist.append({"from": "Resolved", "to": "Closed", "at": now_iso(), "by": c["full_name"]}); upd.update({"status": "Closed", "closed_at": now_iso(), "rating": 5, "rating_comment": "Quick and clear."})
            await db.service_requests.update_one({"id": sr["id"]}, {"$push": {"thread": {"$each": thread}, "stage_history": {"$each": hist}}, "$set": upd})
    # shared documents: allotment letters stored as documents on 3 bookings
    if await db.documents.count_documents({"shared_with_customer": True}) == 0:
        from routers.reports import allotment
        from storage import put_object
        admin = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0})
        if admin:
            admin["permissions"] = set(); admin["project_scope"] = ["*"]
            dt = await db.document_types.find_one({"name": {"$regex": "Allot", "$options": "i"}}, {"_id": 0, "id": 1, "name": 1})
            for b in await db.bookings.find({"company_id": cid, "status": {"$in": ["Active", "Completed"]}}, {"_id": 0}).sort("booking_number", 1).to_list(3):
                try:
                    resp = await allotment(b["id"], "pdf", 0, admin)
                    key = f"documents/{cid}/booking/{b['id']}/allotment-{b['booking_number']}.pdf"
                    res = await put_object(key, resp.body, "application/pdf")
                    await db.documents.insert_one({**base_doc(None, cid), "entity_type": "booking", "entity_id": b["id"], "document_type_id": (dt or {}).get("id"), "document_type_name": (dt or {}).get("name") or "Allotment letter", "title": f"Allotment letter {b['booking_number']}", "file_name": f"allotment-{b['booking_number']}.pdf", "mime": "application/pdf", "size": len(resp.body), "storage_key": res["path"], "is_sensitive": False, "shared_with_customer": True, "uploaded_by": None})
                except Exception as e:
                    logger.warning("allotment doc seed failed: %s", e)
    await db.settings.update_one({"key": "seed_phase5_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 5 seed complete")
