"""Z.2 — co-applicant KYC files uploaded in the wizard: linked on booking, completeness, idempotent retry, RBAC on signed-link issuance."""
import hashlib
import io
import os
import uuid

import pytest
import requests
from PIL import Image

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ["TEST_PASSWORD"]}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def _png():
    b = io.BytesIO()
    Image.new("RGB", (40, 40), "red").save(b, "PNG")
    return b.getvalue()


def _upload(H, data, filename, meta):
    init = requests.post(f"{BASE}/api/uploads/init", json={"filename": filename, "size": len(data), **meta}, headers={**H, "Idempotency-Key": str(uuid.uuid4())}, timeout=30)
    assert init.status_code == 201, init.text
    up = init.json()
    r = requests.put(f"{BASE}/api/uploads/{up['id']}/parts/1", data=data, headers={**H, "Content-Type": "application/octet-stream", "X-Part-Sha256": hashlib.sha256(data).hexdigest()}, timeout=30)
    assert r.status_code == 200, r.text
    r = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers={**H, "Idempotency-Key": str(uuid.uuid4())}, timeout=60)
    assert r.status_code == 201, r.text
    return r.json()


def test_kyc_files_linked_on_booking_idempotent_and_gated():
    A = _hdr("admin@kkt.in")
    pid = next(p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=A, timeout=30).json()["items"] if p.get("code") == "SGH")["id"]
    sold_blocks = {t["block_id"] for t in requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": "real"}, headers=A, timeout=60).json()["towers"] if t["sold"] > 0}
    flats = requests.get(f"{BASE}/api/flats?project_id={pid}&status=Available&page_size=200", headers=A, timeout=30).json()["items"]
    flat = next(f for f in flats if f.get("bookable") is not False and f["block_id"] in sold_blocks)
    tag = uuid.uuid4().hex[:6]
    cid = requests.post(f"{BASE}/api/customers", json={"full_name": f"Z2 Buyer {tag}", "phone": f"9{tag.encode().hex()[:9]}"}, headers=A, timeout=30).json()["id"]
    co_id = str(uuid.uuid4())
    png = _png()
    pan = _upload(A, png, "pan.png", {"entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_pan", "customer_id": cid})
    aad = _upload(A, png, "aadhaar.png", {"entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_aadhaar", "customer_id": cid})
    assert pan["is_sensitive"] is True and pan["url"] and "storage_key" not in pan
    # KYC rules at init: size cap, extension, permission, kind needs a co-applicant
    assert requests.post(f"{BASE}/api/uploads/init", json={"filename": "x.mp4", "size": 10, "entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_pan"}, headers=A, timeout=30).status_code == 415
    assert requests.post(f"{BASE}/api/uploads/init", json={"filename": "x.pdf", "size": 11 * 1024 * 1024, "entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_pan"}, headers=A, timeout=30).status_code == 413
    assert requests.post(f"{BASE}/api/uploads/init", json={"filename": "x.pdf", "size": 10, "kind": "kyc_pan"}, headers=A, timeout=30).status_code == 422
    E = _hdr("employee@kkt.in")
    assert requests.post(f"{BASE}/api/uploads/init", json={"filename": "x.pdf", "size": 10, "entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_pan"}, headers=E, timeout=30).status_code == 403
    plans = requests.get(f"{BASE}/api/projects/{pid}/blocks/{flat['block_id']}/payment-plans", headers=A, timeout=30).json()["items"]
    body = {"flat_id": flat["id"], "customer_id": cid, "booking_date": "2026-10-28", "agreement_value": 2500000, "cash_agreed": 500000, "account_agreed": 2000000,
            "payment_plan_id": plans[0]["id"] if plans else None, "co_applicants": [{"id": co_id, "name": f"Sita {tag}", "relation": "Daughter"}]}
    key = str(uuid.uuid4())
    r1 = requests.post(f"{BASE}/api/bookings", json=body, headers={**A, "Idempotency-Key": key}, timeout=60)
    assert r1.status_code == 201, r1.text
    bid = r1.json()["id"]
    det = requests.get(f"{BASE}/api/bookings/{bid}", headers=A, timeout=30).json()
    assert det["kyc_completeness"] == {"done": 2, "total": 2, "missing": [], "complete": True}
    co = det["customer"]["co_applicants"][0]
    assert co["id"] == co_id and co["kyc"]["kyc_pan"] == pan["id"] and co["kyc"]["kyc_aadhaar"] == aad["id"]
    c360 = requests.get(f"{BASE}/api/customers/{cid}", headers=A, timeout=30).json()
    assert c360["co_applicants"][0]["kyc"]["kyc_pan"] == pan["id"] and c360["kyc_completeness"]["complete"] is True
    files = requests.get(f"{BASE}/api/files", params={"kind": "kyc", "customer_id": cid}, headers=A, timeout=30).json()["items"]
    assert {f["id"] for f in files} == {pan["id"], aad["id"]} and all(f["booking_id"] == bid for f in files)
    g = requests.get(f"{BASE}/api/graph/booking/{bid}", headers=A, timeout=30).json()
    assert g["sections"]["kyc_files"]["total"] == 2
    lst = requests.get(f"{BASE}/api/bookings", params={"status": "Active", "page_size": 100, "project_id": pid}, headers=A, timeout=30).json()["items"]
    assert next(b for b in lst if b["id"] == bid)["kyc_completeness"]["done"] == 2
    # retry under the same idempotency key → no duplicate co-applicant, no duplicate files
    r2 = requests.post(f"{BASE}/api/bookings", json=body, headers={**A, "Idempotency-Key": key}, timeout=60)
    assert r2.status_code in (200, 201) and r2.json()["id"] == bid
    assert len(requests.get(f"{BASE}/api/customers/{cid}", headers=A, timeout=30).json()["co_applicants"]) == 1
    assert len(requests.get(f"{BASE}/api/files", params={"kind": "kyc", "customer_id": cid}, headers=A, timeout=30).json()["items"]) == 2
    # re-upload PAN replaces (one live per kind)
    pan2 = _upload(A, png, "pan2.png", {"entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_pan", "customer_id": cid, "booking_id": bid})
    files = requests.get(f"{BASE}/api/files", params={"kind": "kyc", "customer_id": cid}, headers=A, timeout=30).json()["items"]
    assert {f["id"] for f in files} == {pan2["id"], aad["id"]}
    # access: employee (no sales.customer.edit / kyc.reveal) → masked list entries, 403 on signed-link issuance
    assert requests.get(f"{BASE}/api/files/{aad['id']}/url", headers=E, timeout=30).status_code == 403
    em = requests.get(f"{BASE}/api/files/{aad['id']}", headers=E, timeout=30)
    assert em.status_code == 200 and em.json()["locked"] is True and em.json()["url"] is None and "size" not in em.json()
    S = _hdr("sales@kkt.in")  # sales.customer.edit but no sales.kyc.reveal → may upload, may NOT view
    assert requests.get(f"{BASE}/api/files/{aad['id']}/url", headers=S, timeout=30).status_code == 403
    meta = requests.get(f"{BASE}/api/files/{aad['id']}", headers=S, timeout=30).json()
    assert meta["locked"] is True and meta["url"] is None and meta["filename"] == "Masked" and not {"size", "sha256", "storage_key"} & set(meta)
    masked = requests.get(f"{BASE}/api/files", params={"kind": "kyc", "customer_id": cid}, headers=S, timeout=30).json()["items"]
    assert masked and all(m["locked"] and m["url"] is None and m["filename"] == "Masked" and m["variants"] == {} and "size" not in m for m in masked)
    other = _upload(S, png, "other-id.png", {"entity_type": "co_applicant", "entity_id": co_id, "kind": "kyc_other", "customer_id": cid, "booking_id": bid})
    assert other["locked"] is True and other["url"] is None and other["filename"] == "Masked"  # upload ok, nothing viewable handed back
    # Super Admin: 200 + audited kyc.view
    assert requests.get(f"{BASE}/api/files/{aad['id']}/url", headers=A, timeout=30).status_code == 200
    audit = requests.get(f"{BASE}/api/audit-logs", params={"entity_type": "file", "entity_id": aad["id"], "page_size": 20}, headers=A, timeout=30)
    assert audit.status_code == 200, audit.text
    assert any(a.get("action") == "kyc.file_reveal" for a in audit.json().get("items", []))
    requests.post(f"{BASE}/api/bookings/{bid}/cancel", json={"reason": "Z.2 test artefact", "deduction": 0, "refund": 0}, headers={**A, "Idempotency-Key": str(uuid.uuid4())}, timeout=60)
