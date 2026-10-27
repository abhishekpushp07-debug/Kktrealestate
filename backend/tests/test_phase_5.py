"""Phase 5 — Customer Portal + ERP support (service req, notices, construction photos, doc share).
Covers: portal auth, audience isolation, refresh rotation, portal data endpoints, PDFs,
construction photos (hidden), notices, service requests, profile, change password,
ERP portal management, ERP service requests RBAC, ERP notices, ERP photos, ERP document share.
"""
import io
import os
import time
import uuid

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)


def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL not set"
    return v.rstrip("/")

BASE = _load_base()
ERP_LOGIN = f"{BASE}/api/auth/login"
PORTAL_LOGIN = f"{BASE}/api/portal/auth/login"

ERP_PW = TEST_PASSWORD
PORTAL_PW = "Buyer@12345"


def _hdr(tok, idem=False):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if idem:
        h["Idempotency-Key"] = str(uuid.uuid4())
    return h


def _erp_login(email):
    r = requests.post(ERP_LOGIN, json={"email": email, "password": ERP_PW})
    assert r.status_code == 200, (email, r.status_code, r.text)
    return r.json()["access_token"]


def _portal_login(phone, pw=PORTAL_PW):
    for attempt in range(4):
        r = requests.post(PORTAL_LOGIN, json={"phone": phone, "password": pw})
        if r.status_code == 429:
            ra = int(r.headers.get("Retry-After", "7"))
            time.sleep(min(ra, 15))
            continue
        return r
    return r


@pytest.fixture(scope="module")
def admin_tok():
    return _erp_login("admin@kkt.in")


@pytest.fixture(scope="module")
def sales_tok():
    return _erp_login("sales@kkt.in")


@pytest.fixture(scope="module")
def marketing_tok():
    return _erp_login("marketing@kkt.in")


@pytest.fixture(scope="module")
def portal_amit():
    r = _portal_login("9431012345")
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Portal auth ----------
class TestPortalAuth:
    def test_login_ok(self, portal_amit):
        d = portal_amit
        assert d["access_token"] and d["refresh_token"]
        assert d.get("must_change_password") is False

    def test_login_wrong_password(self):
        # Use a phone we won't lock in the lockout test
        r = _portal_login("9431012346", "WRONG!!!!")
        assert r.status_code in (401, 423)

    def test_erp_token_rejected_on_portal(self, admin_tok):
        r = requests.get(f"{BASE}/api/portal/me", headers=_hdr(admin_tok))
        assert r.status_code == 401

    def test_portal_token_rejected_on_erp(self, portal_amit):
        r = requests.get(f"{BASE}/api/customers", headers=_hdr(portal_amit["access_token"]))
        assert r.status_code == 401


class TestRefreshRotation:
    def test_refresh_rotate_and_reuse(self, portal_amit):
        old = portal_amit["refresh_token"]
        r = requests.post(f"{BASE}/api/portal/auth/refresh", json={"refresh_token": old})
        assert r.status_code == 200, r.text
        pair = r.json()
        assert pair["access_token"] and pair["refresh_token"]
        assert pair["refresh_token"] != old
        # reuse old -> 401 with TOKEN_REUSE
        r2 = requests.post(f"{BASE}/api/portal/auth/refresh", json={"refresh_token": old})
        assert r2.status_code == 401
        assert "TOKEN_REUSE" in r2.text.upper() or "REUSE" in r2.text.upper()
        # update fixture token for other tests
        portal_amit["access_token"] = pair["access_token"]
        portal_amit["refresh_token"] = pair["refresh_token"]


# ---------- Portal data ----------
class TestPortalData:
    def test_booking_detail_and_subresources(self, portal_amit):
        tok = portal_amit["access_token"]
        r = requests.get(f"{BASE}/api/portal/bookings", headers=_hdr(tok))
        bk = [b for b in (r.json().get("items") or r.json()) if b["booking_number"] == "BK-2526-0001"][0]
        bid = bk["id"]
        for sub in ("", "/ledger", "/payments", "/demands", "/schedule", "/documents", "/construction"):
            rr = requests.get(f"{BASE}/api/portal/bookings/{bid}{sub}", headers=_hdr(tok))
            assert rr.status_code == 200, (sub, rr.status_code, rr.text[:200])
        return bid

class TestPortalPDFs:
    def test_pdfs(self, portal_amit):
        tok = portal_amit["access_token"]
        r = requests.get(f"{BASE}/api/portal/bookings", headers=_hdr(tok))
        bk = [b for b in (r.json().get("items") or r.json()) if b["booking_number"] == "BK-2526-0001"][0]
        bid = bk["id"]
        for p in (f"/api/portal/bookings/{bid}/statement.pdf", f"/api/portal/bookings/{bid}/allotment.pdf"):
            rr = requests.get(f"{BASE}{p}", headers={"Authorization": f"Bearer {tok}"})
            assert rr.status_code == 200, (p, rr.status_code)
            assert rr.headers.get("content-type", "").startswith("application/pdf")
            assert rr.content[:4] == b"%PDF"
        # payment receipt (status Cleared)
        pays = requests.get(f"{BASE}/api/portal/bookings/{bid}/payments", headers=_hdr(tok)).json()
        items = pays.get("items") or pays
        cleared = [p for p in items if p.get("status") == "Cleared"]
        if cleared:
            pid = cleared[0]["id"]
            rr = requests.get(
                f"{BASE}/api/portal/bookings/{bid}/payments/{pid}/receipt.pdf",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert rr.status_code == 200
            assert rr.content[:4] == b"%PDF"
        # demand letter
        dems = requests.get(f"{BASE}/api/portal/bookings/{bid}/demands", headers=_hdr(tok)).json()
        ditems = dems.get("items") or dems
        if ditems:
            did = ditems[0]["id"]
            rr = requests.get(
                f"{BASE}/api/portal/bookings/{bid}/demands/{did}/letter.pdf",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert rr.status_code == 200
            assert rr.content[:4] == b"%PDF"


class TestConstructionAndHiddenPhoto:
    def test_construction_and_hidden(self, portal_amit, admin_tok):
        tok = portal_amit["access_token"]
        r = requests.get(f"{BASE}/api/portal/bookings", headers=_hdr(tok)).json()
        bid = [b for b in (r.get("items") or r) if b["booking_number"] == "BK-2526-0001"][0]["id"]
        cr = requests.get(f"{BASE}/api/portal/bookings/{bid}/construction", headers=_hdr(tok))
        assert cr.status_code == 200
        miles = cr.json().get("milestones") or cr.json()
        all_photo_ids = []
        for m in miles:
            for ph in m.get("photos", []):
                all_photo_ids.append(ph.get("id"))
                assert "site engineer only" not in (ph.get("caption") or "").lower()
                # photo url should be public media
                url = ph.get("url") or ""
                if url.startswith("/api/"):
                    rr = requests.get(f"{BASE}{url}")
                    assert rr.status_code == 200
                    assert rr.headers.get("content-type", "").startswith("image/")
        # find hidden photo via ERP
        # need block id for the booking
        bdet = requests.get(f"{BASE}/api/portal/bookings/{bid}", headers=_hdr(tok)).json()
        block_id = bdet.get("block_id") or (bdet.get("booking") or {}).get("block_id")
        if not block_id:
            # scan blocks
            bl = requests.get(f"{BASE}/api/blocks", headers=_hdr(admin_tok)).json()
            blocks = bl.get("items") or bl
            block_id = blocks[0]["id"]
        rp = requests.get(f"{BASE}/api/blocks/{block_id}/photos", headers=_hdr(admin_tok))
        assert rp.status_code == 200
        _pj = rp.json(); photos = _pj["items"] if isinstance(_pj, dict) and "items" in _pj else _pj
        hidden = [p for p in photos if not p.get("visible_to_customers")]
        if hidden:
            hid = hidden[0]["id"]
            rr = requests.get(f"{BASE}/api/public/media/photo/{hid}")
            assert rr.status_code == 404
            assert hid not in all_photo_ids


class TestNotices:
    def test_portal_notices_and_mark_read(self, portal_amit):
        tok = portal_amit["access_token"]
        r = requests.get(f"{BASE}/api/portal/notices", headers=_hdr(tok))
        assert r.status_code == 200
        d = r.json()
        items = d.get("items") or d
        assert len(items) >= 2
        unread_before = d.get("unread_count") if isinstance(d, dict) else None
        nid = items[0]["id"]
        rr = requests.post(f"{BASE}/api/portal/notices/{nid}/read", headers=_hdr(tok))
        assert rr.status_code in (200, 204)
        r2 = requests.get(f"{BASE}/api/portal/notices", headers=_hdr(tok)).json()
        if unread_before is not None and isinstance(r2, dict):
            assert r2.get("unread_count", 0) <= unread_before


class TestServiceRequests:
    def test_categories_and_create_and_reply(self, portal_amit):
        tok = portal_amit["access_token"]
        rc = requests.get(f"{BASE}/api/portal/service-categories", headers=_hdr(tok))
        assert rc.status_code == 200
        bk = requests.get(f"{BASE}/api/portal/bookings", headers=_hdr(tok)).json()
        bid = [b for b in (bk.get("items") or bk) if b["booking_number"] == "BK-2526-0001"][0]["id"]
        data = {"booking_id": bid, "category": "Payment query", "subject": "TEST SR", "description": "test desc", "priority": "Medium"}
        r = requests.post(
            f"{BASE}/api/portal/service-requests",
            data=data,
            headers={"Authorization": f"Bearer {tok}", "Idempotency-Key": str(uuid.uuid4())},
        )
        assert r.status_code in (200, 201), r.text
        sr = r.json()
        tn = sr.get("ticket_number") or sr.get("ticket")
        assert tn and tn.startswith("SR-"), sr
        sid = sr["id"]
        rr = requests.post(
            f"{BASE}/api/portal/service-requests/{sid}/reply",
            data={"message": "ping"},
            headers={"Authorization": f"Bearer {tok}", "Idempotency-Key": str(uuid.uuid4())},
        )
        assert rr.status_code in (200, 201)

    def test_internal_note_hidden_on_portal(self):
        r = _portal_login("9431023456")
        assert r.status_code == 200
        tok = r.json()["access_token"]
        srs = requests.get(f"{BASE}/api/portal/service-requests", headers=_hdr(tok)).json()
        items = srs.get("items") or srs
        assert items, "story persona Priya must have a service request"
        sid = items[0]["id"]
        # staff posts an internal note on her ticket; the portal view must never show it
        r = requests.post(f"{BASE}/api/service-requests/{sid}/reply", headers=_hdr(_erp_login("admin@kkt.in"), idem=True), json={"message": "INTERNAL NOTE: vendor quote pending", "internal": True})
        assert r.status_code in (200, 201), r.text
        d = requests.get(f"{BASE}/api/portal/service-requests/{sid}", headers=_hdr(tok)).json()
        assert "INTERNAL NOTE" not in str(d).upper(), "Internal note leaked to portal"


class TestProfileBank:
    def test_patch_me_and_bank(self, portal_amit):
        tok = portal_amit["access_token"]
        r = requests.patch(
            f"{BASE}/api/portal/me",
            json={"alt_phone": "9876543210"},
            headers=_hdr(tok, idem=True),
        )
        assert r.status_code == 200, r.text
        rb = requests.get(f"{BASE}/api/portal/bank-details", headers=_hdr(tok))
        assert rb.status_code == 200


# ---------- ERP portal management ----------
class TestErpPortalMgmt:
    def test_new_customer_enable_and_temp_password_flow(self, admin_tok):
        # create new customer
        # unique phone + pan per run
        phone_last10 = f"9000{uuid.uuid4().int % 1000000:06d}"
        payload = {
            "full_name": "TEST_Portal New",
            "phone": f"+91{phone_last10}",
            "email": f"test_portal_{uuid.uuid4().hex[:6]}@example.com",
        }
        r = requests.post(
            f"{BASE}/api/customers", json=payload, headers=_hdr(admin_tok, idem=True)
        )
        if r.status_code not in (200, 201):
            pytest.fail(f"create customer failed: {r.status_code} {r.text[:300]}")
        cust = r.json()
        cid = cust["id"]
        # enable portal -> temp password
        re = requests.post(
            f"{BASE}/api/customers/{cid}/portal/enable",
            headers=_hdr(admin_tok, idem=True),
            json={},
        )
        assert re.status_code in (200, 201), re.text
        temp = re.json().get("temporary_password") or re.json().get("temp_password")
        assert temp, re.json()
        # login
        rl = _portal_login(phone_last10, temp)
        assert rl.status_code == 200, rl.text
        logd = rl.json()
        assert logd.get("must_change_password") is True
        temp_tok = logd["access_token"]
        # using temp token on bookings -> 403 PASSWORD_CHANGE_REQUIRED
        rb = requests.get(f"{BASE}/api/portal/bookings", headers=_hdr(temp_tok))
        assert rb.status_code == 403, rb.status_code
        assert "PASSWORD_CHANGE_REQUIRED" in rb.text.upper() or "CHANGE" in rb.text.upper()
        # change password -> full tokens
        rc = requests.post(
            f"{BASE}/api/portal/auth/change-password",
            json={"current_password": temp, "new_password": "Buyer@12345"},
            headers={"Authorization": f"Bearer {temp_tok}", "Content-Type": "application/json"},
        )
        assert rc.status_code in (200, 204), rc.text


# ---------- ERP service requests ----------
class TestErpServiceRequests:
    def test_admin_list_and_counts(self, admin_tok):
        r = requests.get(f"{BASE}/api/service-requests", headers=_hdr(admin_tok))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "status_counts" in d or "counts" in d
        assert (d.get("items") or d.get("results"))

    def test_marketing_forbidden(self, marketing_tok):
        r = requests.get(f"{BASE}/api/service-requests", headers=_hdr(marketing_tok))
        assert r.status_code == 403

    def test_filters_and_detail_and_actions(self, sales_tok, admin_tok):
        r = requests.get(f"{BASE}/api/service-requests?status=New", headers=_hdr(sales_tok))
        assert r.status_code == 200
        items = (r.json().get("items") or [])
        sr4 = [s for s in items if s.get("ticket_number") == "SR-2627-0004"]
        if not sr4:
            # try by ticket number (list has grown past one page)
            all_items = requests.get(f"{BASE}/api/service-requests?search=SR-2627-0004&page_size=100", headers=_hdr(sales_tok)).json().get("items", [])
            sr4 = [s for s in all_items if s.get("ticket_number") == "SR-2627-0004"]
        assert sr4, "SR-2627-0004 missing"
        sid = sr4[0]["id"]
        # detail
        d = requests.get(f"{BASE}/api/service-requests/{sid}", headers=_hdr(sales_tok))
        assert d.status_code == 200
        # internal reply
        rr = requests.post(
            f"{BASE}/api/service-requests/{sid}/reply",
            json={"message": "INT TEST", "internal": True},
            headers=_hdr(sales_tok, idem=True),
        )
        assert rr.status_code in (200, 201), rr.text
        # assign
        users = requests.get(f"{BASE}/api/users", params={"page_size": 100}, headers=_hdr(admin_tok)).json()
        uitems = users.get("items") or users
        sales_user = [u for u in uitems if u.get("email") == "sales@kkt.in"][0]
        ra = requests.post(
            f"{BASE}/api/service-requests/{sid}/assign",
            json={"assigned_to": sales_user["id"]},
            headers=_hdr(sales_tok, idem=True),
        )
        assert ra.status_code in (200, 201), ra.text
        # status change
        rs = requests.post(
            f"{BASE}/api/service-requests/{sid}/status",
            json={"status": "Awaiting Customer"},
            headers=_hdr(sales_tok, idem=True),
        )
        assert rs.status_code in (200, 201), rs.text
        # restore to New
        rrs = requests.post(
            f"{BASE}/api/service-requests/{sid}/status",
            json={"status": "New"},
            headers=_hdr(sales_tok, idem=True),
        )
        assert rrs.status_code in (200, 201), rrs.text


# ---------- ERP notices ----------
class TestErpNotices:
    def test_crud_admin(self, admin_tok):
        payload = {"title": "TEST_Notice", "body": "test body", "project_ids": [], "pinned": False}
        r = requests.post(
            f"{BASE}/api/notices", json=payload, headers=_hdr(admin_tok, idem=True)
        )
        assert r.status_code in (200, 201), r.text
        n = r.json()
        nid = n["id"]
        version = n.get("version", 0)
        # patch — strict model requires full body; version via If-Match header
        rp = requests.patch(
            f"{BASE}/api/notices/{nid}",
            json={"title": "TEST_Notice2", "body": "test body", "project_ids": [], "pinned": False},
            headers={**_hdr(admin_tok), "If-Match": str(version)},
        )
        assert rp.status_code == 200, rp.text
        # delete
        rd = requests.delete(f"{BASE}/api/notices/{nid}", headers=_hdr(admin_tok))
        assert rd.status_code in (200, 204)

    def test_sales_forbidden_post(self, sales_tok):
        r = requests.post(
            f"{BASE}/api/notices",
            json={"title": "nope", "body": "x", "project_ids": []},
            headers=_hdr(sales_tok, idem=True),
        )
        assert r.status_code == 403


# ---------- ERP construction photos ----------
def _small_jpeg_bytes():
    # Minimal valid JPEG: FFD8 FFE0 ... FFD9. We use a tiny but valid JPEG.
    # Use a hardcoded 1x1 pixel JPEG.
    hex_data = (
        "FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFDB0043010909090C0B0C180D0D1832211C213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232FFC00011080001000103012200021101031101FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC400B5100002010303020403050504040000017D01020300041105122131410613516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A3435363738393A434445464748494A535455565758595A636465666768696A737475767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFC4001F0100030101010101010101010000000000000102030405060708090A0BFFC400B51100020102040403040705040400010277000102031104052131061241510761711322328108144291A1B1C109233352F0156272D10A162434E125F11718191A262728292A35363738393A434445464748494A535455565758595A636465666768696A737475767778797A82838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE2E3E4E5E6E7E8E9EAF2F3F4F5F6F7F8F9FAFFDA000C03010002110311003F00FBFCA28A2800A28A2800FFD9"
    )
    return bytes.fromhex(hex_data)


class TestErpConstructionPhotos:
    def test_upload_valid_and_invalid_and_patch_delete(self, admin_tok):
        blocks = requests.get(f"{BASE}/api/blocks", headers=_hdr(admin_tok)).json()
        bitems = blocks.get("items") or blocks
        # pick a block with completed milestones (any block)
        block_id = bitems[0]["id"]
        # valid upload — endpoint uses `files` (plural)
        jpg = _small_jpeg_bytes()
        files = {"files": ("photo.jpg", io.BytesIO(jpg), "image/jpeg")}
        r = requests.post(
            f"{BASE}/api/blocks/{block_id}/milestones/1/photos",
            files=files,
            headers={"Authorization": f"Bearer {admin_tok}", "Idempotency-Key": str(uuid.uuid4())},
        )
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
        resp = r.json()
        photo = (resp.get("items") or [resp])[0]
        pid = photo["id"]
        # fake jpeg (text) -> 422
        bad = {"files": ("bad.jpg", io.BytesIO(b"this is not a jpeg"), "image/jpeg")}
        rb = requests.post(
            f"{BASE}/api/blocks/{block_id}/milestones/1/photos",
            files=bad,
            headers={"Authorization": f"Bearer {admin_tok}", "Idempotency-Key": str(uuid.uuid4())},
        )
        assert rb.status_code in (415, 422), rb.status_code
        assert "UNSUPPORTED" in rb.text.upper() or "MEDIA" in rb.text.upper()
        # patch (no version in body for strict model; use If-Match)
        rp = requests.patch(
            f"{BASE}/api/photos/{pid}",
            json={"visible_to_customers": False},
            headers={**_hdr(admin_tok), "If-Match": str(photo.get("version", 0))},
        )
        assert rp.status_code == 200, rp.text
        # delete
        rd = requests.delete(f"{BASE}/api/photos/{pid}", headers=_hdr(admin_tok))
        assert rd.status_code in (200, 204)


# ---------- ERP document share ----------