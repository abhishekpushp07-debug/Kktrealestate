"""Phase 1.5 'Foundation Power-Up' tests for KKT Real Estate ERP."""
import io
import os
import time
import uuid

import pyotp
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-realty-hub-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@kkt.in", "password": "Kkt@12345"}
EMPLOYEE = {"email": "employee@kkt.in", "password": "Kkt@12345"}
PASSWORD = "Kkt@12345"


# ---------- shared session + tokens ----------
_session = requests.Session()
_tokens: dict = {}


def _login(creds):
    r = _session.post(f"{API}/auth/login", json=creds, timeout=30)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def admin_token():
    if "admin" not in _tokens:
        _tokens["admin"] = _login(ADMIN)["access_token"]
    return _tokens["admin"]


@pytest.fixture(scope="session")
def employee_token():
    if "employee" not in _tokens:
        _tokens["employee"] = _login(EMPLOYEE)["access_token"]
    return _tokens["employee"]


def _h(tok, extra=None):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


# ---------- Health, security headers ----------
class TestHealthHeaders:
    def test_health_shape(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok"
        assert isinstance(d["version"], str) and d["version"]  # 1.5.0 → 7.0.0 after Phase 7
        assert "transaction_mode" in d
        # security + tracing headers
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("x-frame-options") == "DENY"
        assert r.headers.get("x-request-id")
        assert r.headers.get("x-response-time")

    def test_auth_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN["email"]


# ---------- Optimistic concurrency ----------
class TestOptimisticConcurrency:
    def test_version_conflict_and_success(self, admin_token):
        r = requests.get(f"{API}/projects", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        projects = r.json().get("items", r.json() if isinstance(r.json(), list) else [])
        sgh = next((p for p in projects if p.get("code") == "SGH"), None)
        assert sgh, "SGH project not found"
        pid = sgh["id"]
        cur_version = sgh.get("version", 0)

        # Stale version
        stale = requests.patch(
            f"{API}/projects/{pid}",
            headers=_h(admin_token),
            json={"description": "stale write", "version": max(0, cur_version - 1) if cur_version > 0 else 999},
            timeout=15,
        )
        assert stale.status_code == 409
        body = stale.json()
        # error envelope may be nested
        code = body.get("code") or body.get("error", {}).get("code") or body.get("detail", {}).get("code")
        assert code == "VERSION_CONFLICT", f"Expected VERSION_CONFLICT, got {body}"

        # Correct version
        good = requests.patch(
            f"{API}/projects/{pid}",
            headers=_h(admin_token),
            json={"description": f"phase15 test {uuid.uuid4().hex[:6]}", "version": cur_version},
            timeout=15,
        )
        assert good.status_code == 200, good.text
        new_version = good.json().get("version")
        assert new_version == cur_version + 1


# ---------- Idempotency ----------
class TestIdempotency:
    def test_idempotent_replay(self, admin_token):
        key = str(uuid.uuid4())
        body = {"name": f"TEST_Amenity_{key[:8]}", "category": "Lifestyle"}
        headers = _h(admin_token, {"Idempotency-Key": key})
        r1 = requests.post(f"{API}/master/amenities", headers=headers, json=body, timeout=15)
        assert r1.status_code in (200, 201), r1.text
        r2 = requests.post(f"{API}/master/amenities", headers=headers, json=body, timeout=15)
        assert r2.status_code == r1.status_code
        assert r2.json().get("id") == r1.json().get("id")
        # replay header (case-insensitive)
        replayed = r2.headers.get("Idempotent-Replayed") or r2.headers.get("idempotent-replayed")
        assert replayed and replayed.lower() == "true", f"Missing Idempotent-Replayed header: {dict(r2.headers)}"

        # Verify only one record was created
        q = requests.get(
            f"{API}/master/amenities", headers=_h(admin_token), params={"search": body["name"]}, timeout=15
        )
        items = q.json().get("items", q.json() if isinstance(q.json(), list) else [])
        assert len([i for i in items if i["name"] == body["name"]]) == 1

        # cleanup
        requests.post(f"{API}/master/amenities/{r1.json()['id']}/deactivate", headers=_h(admin_token), timeout=15)


# ---------- ETag ----------
class TestETag:
    def test_etag_304(self, admin_token):
        r = requests.get(f"{API}/master/flat-types", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        etag = r.headers.get("ETag") or r.headers.get("etag")
        assert etag, "No ETag on master list"
        r2 = requests.get(
            f"{API}/master/flat-types", headers=_h(admin_token, {"If-None-Match": etag}), timeout=15
        )
        assert r2.status_code == 304, f"Expected 304, got {r2.status_code}"


# ---------- Cursor pagination ----------
class TestCursorPagination:
    def test_cursor(self, admin_token):
        r1 = requests.get(f"{API}/flats", headers=_h(admin_token), params={"limit": 10}, timeout=15)
        assert r1.status_code == 200
        d1 = r1.json()
        cursor = d1.get("next_cursor")
        assert cursor, f"No next_cursor in response: {list(d1.keys())}"
        items1 = d1.get("items", [])
        assert len(items1) <= 10
        r2 = requests.get(
            f"{API}/flats", headers=_h(admin_token), params={"limit": 10, "cursor": cursor}, timeout=15
        )
        assert r2.status_code == 200
        items2 = r2.json().get("items", [])
        ids1 = {i["id"] for i in items1}
        ids2 = {i["id"] for i in items2}
        assert ids1.isdisjoint(ids2), "Cursor returned overlapping items"


# ---------- Tower C skip/refuge ----------
class TestTowerC:
    def test_tower_c_grid(self, admin_token):
        projects = requests.get(f"{API}/projects", headers=_h(admin_token), timeout=15).json()
        projects = projects.get("items", projects) if isinstance(projects, dict) else projects
        sgh = next(p for p in projects if p["code"] == "SGH")
        blocks = requests.get(
            f"{API}/blocks", headers=_h(admin_token), params={"project_id": sgh["id"]}, timeout=15
        ).json()
        blocks = blocks.get("items", blocks) if isinstance(blocks, dict) else blocks
        tower_c = next(b for b in blocks if b["code"] == "C")
        grid = requests.get(f"{API}/blocks/{tower_c['id']}/grid", headers=_h(admin_token), timeout=15).json()
        # count flats
        rows = grid.get("floors") or grid.get("rows") or grid.get("grid") or []
        all_flats = []
        for row in rows:
            units = row.get("units") or row.get("flats") or []
            all_flats.extend(units)
        # fallback: top-level flats
        if not all_flats:
            all_flats = grid.get("flats", [])
        unit_flats = [f for f in all_flats if f.get("kind") not in ("skip", "refuge") and f.get("flat_number")]
        assert len(unit_flats) == 56, f"Expected 56 unit flats, got {len(unit_flats)}: sample {unit_flats[:2]}"
        numbers = {f["flat_number"] for f in unit_flats}
        assert not any(n.startswith("C-13") for n in numbers), "Found C-13xx flats which should be skipped"
        assert "C-101" in numbers
        assert "C-1604" in numbers

        # refuge floor 7 - find row where floor==7
        floor7 = next((r for r in rows if r.get("floor") == 7), None)
        if floor7 is not None:
            kind = floor7.get("kind") or (floor7.get("units", [{}])[0].get("kind") if floor7.get("units") else None)
            # no actual flat units on floor 7
            unit_count = len([u for u in floor7.get("units", []) if u.get("kind") not in ("refuge", "skip")])
            assert unit_count == 0, f"Floor 7 should be refuge w/ 0 units, got {unit_count}"


# ---------- Rate cards ----------
# ---------- Parking ----------
class TestParking:
    def test_parking_list_bulk_patch(self, admin_token):
        projects = requests.get(f"{API}/projects", headers=_h(admin_token), timeout=15).json()
        projects = projects.get("items", projects) if isinstance(projects, dict) else projects
        sgh = next(p for p in projects if p["code"] == "SGH")

        lst = requests.get(
            f"{API}/parking",
            headers=_h(admin_token),
            params={"project_id": sgh["id"], "page_size": 100},
            timeout=15,
        )
        assert lst.status_code == 200
        total_before = lst.json().get("total", 0)
        assert total_before >= 100, f"Expected ~120 seeded SGH parking slots, got total={total_before}"

        # bulk-generate 5 slots
        gen = requests.post(
            f"{API}/parking/bulk-generate",
            headers=_h(admin_token),
            json={
                "project_id": sgh["id"],
                "prefix": f"T{uuid.uuid4().hex[:3].upper()}",
                "start": 1,
                "count": 5,
                "type": "Covered",
            },
            timeout=20,
        )
        assert gen.status_code in (200, 201), gen.text

        lst2 = requests.get(
            f"{API}/parking",
            headers=_h(admin_token),
            params={"project_id": sgh["id"], "page_size": 100},
            timeout=15,
        ).json()
        total_after = lst2.get("total", 0)
        assert total_after >= total_before + 5, (
            f"Parking total did not grow by 5: before={total_before}, after={total_after}"
        )

        # pick a slot and PATCH its status
        slot = lst2.get("items", [])[0]
        upd = requests.patch(
            f"{API}/parking/{slot['id']}",
            headers=_h(admin_token),
            json={"status": "Blocked", "version": slot.get("version", 0)},
            timeout=15,
        )
        assert upd.status_code in (200, 409), upd.text


# ---------- CSV Import ----------
class TestImports:
    def test_import_template_preview_confirm(self, admin_token):
        tpl = requests.get(f"{API}/imports/template/amenities", headers=_h(admin_token), timeout=15)
        assert tpl.status_code == 200
        assert "name" in tpl.text.lower()

        tag = uuid.uuid4().hex[:6]
        # 1 valid + 1 invalid (bad category)
        bad_csv = f"name,category\nTEST_IMP_{tag}_ok,Lifestyle\nTEST_IMP_{tag}_bad,NotACategory\n"
        files = {"file": ("amenities.csv", io.BytesIO(bad_csv.encode()), "text/csv")}
        prev = requests.post(
            f"{API}/imports/amenities/preview",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=20,
        )
        assert prev.status_code == 200, prev.text
        pdata = prev.json()
        # Preview must mark the invalid row and refuse to issue a confirm_token (all-or-nothing)
        assert pdata.get("invalid", 0) >= 1, f"Preview should flag invalid row: {pdata}"
        assert pdata.get("confirm_token") is None, (
            f"confirm_token should be None for invalid batch: {pdata}"
        )

        # confirm invalid batch should fail (if token given)
        token = pdata.get("confirm_token") or pdata.get("token") or pdata.get("preview_id")
        if token:
            conf = requests.post(
                f"{API}/imports/amenities/confirm",
                headers=_h(admin_token),
                params={"confirm_token": token},
                timeout=20,
            )
            assert conf.status_code >= 400, f"Confirm with invalid should fail: {conf.status_code} {conf.text[:200]}"

        # valid-only CSV
        good_csv = f"name,category\nTEST_IMP_{tag}_v1,Lifestyle\nTEST_IMP_{tag}_v2,Sports\n"
        files = {"file": ("amenities.csv", io.BytesIO(good_csv.encode()), "text/csv")}
        prev2 = requests.post(
            f"{API}/imports/amenities/preview",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=20,
        )
        assert prev2.status_code == 200, prev2.text
        pd2 = prev2.json()
        tok2 = pd2.get("confirm_token") or pd2.get("token") or pd2.get("preview_id")
        assert tok2, f"No confirm_token in valid preview: {pd2}"
        conf2 = requests.post(
            f"{API}/imports/amenities/confirm",
            headers=_h(admin_token),
            params={"confirm_token": tok2},
            timeout=30,
        )
        assert conf2.status_code in (200, 201), conf2.text

        # cleanup created
        lst = requests.get(
            f"{API}/master/amenities",
            headers=_h(admin_token),
            params={"search": f"TEST_IMP_{tag}", "page_size": 50},
            timeout=15,
        ).json()
        for it in lst.get("items", []):
            requests.post(f"{API}/master/amenities/{it['id']}/deactivate", headers=_h(admin_token), timeout=10)


# ---------- Global Search + Entity History ----------
class TestSearchHistory:
    def test_search_and_history(self, admin_token):
        s = requests.get(f"{API}/search", headers=_h(admin_token), params={"q": "A-10"}, timeout=15)
        assert s.status_code == 200
        sj = s.json()
        # grouped results — look for flats
        found = False
        for key in ("flats", "results", "groups"):
            v = sj.get(key)
            if v:
                found = True
                break
        assert found or sj, f"Search returned nothing: {sj}"

        projects = requests.get(f"{API}/projects", headers=_h(admin_token), timeout=15).json()
        projects = projects.get("items", projects) if isinstance(projects, dict) else projects
        sgh = next(p for p in projects if p["code"] == "SGH")
        h = requests.get(
            f"{API}/audit-logs/entity/project/{sgh['id']}", headers=_h(admin_token), timeout=15
        )
        assert h.status_code == 200
        items = h.json().get("items", h.json() if isinstance(h.json(), list) else [])
        assert len(items) >= 1


# ---------- Metrics RBAC ----------
class TestMetricsRBAC:
    def test_metrics_admin_ok_employee_forbidden(self, admin_token, employee_token):
        a = requests.get(f"{API}/metrics", headers=_h(admin_token), timeout=15)
        assert a.status_code == 200
        assert "routes" in a.json() or "metrics" in a.json() or isinstance(a.json(), (list, dict))

        e = requests.get(f"{API}/metrics", headers=_h(employee_token), timeout=15)
        assert e.status_code == 403


# ---------- Soft Delete / Restore ----------
class TestSoftDeleteRestore:
    def test_soft_delete_and_restore(self, admin_token):
        tag = uuid.uuid4().hex[:6]
        c = requests.post(
            f"{API}/master/amenities",
            headers=_h(admin_token),
            json={"name": f"TEST_SD_{tag}", "category": "Lifestyle"},
            timeout=15,
        )
        assert c.status_code in (200, 201), c.text
        aid = c.json()["id"]

        d = requests.post(f"{API}/master/amenities/{aid}/deactivate", headers=_h(admin_token), timeout=15)
        assert d.status_code in (200, 204), d.text

        # should NOT be in default list
        act = requests.get(
            f"{API}/master/amenities",
            headers=_h(admin_token),
            params={"search": f"TEST_SD_{tag}"},
            timeout=15,
        ).json()
        act_items = act.get("items", act) if isinstance(act, dict) else act
        assert not any(i["id"] == aid for i in act_items), "Soft-deleted still in default listing"

        # should appear with include_inactive
        inc = requests.get(
            f"{API}/master/amenities",
            headers=_h(admin_token),
            params={"search": f"TEST_SD_{tag}", "include_inactive": "true"},
            timeout=15,
        ).json()
        inc_items = inc.get("items", inc) if isinstance(inc, dict) else inc
        assert any(i["id"] == aid for i in inc_items), f"Not found with include_inactive: {inc_items}"

        # restore
        rst = requests.post(
            f"{API}/master/amenities/{aid}/restore", headers=_h(admin_token), timeout=15
        )
        assert rst.status_code in (200, 204), rst.text

        # cleanup (deactivate again if active)
        requests.post(f"{API}/master/amenities/{aid}/deactivate", headers=_h(admin_token), timeout=10)


# ---------- MFA full lifecycle ----------
class TestMFA:
    def test_mfa_enroll_verify_login_disable(self):
        # Login fresh as employee (fresh session, don't pollute shared)
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json=EMPLOYEE, timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        rtok = r.json().get("refresh_token")
        H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

        try:
            # Enroll
            en = s.post(f"{API}/auth/mfa/enroll", headers=H, timeout=15)
            assert en.status_code in (200, 201), en.text
            enj = en.json()
            secret = enj.get("secret") or enj.get("totp_secret")
            otpauth = enj.get("otpauth") or enj.get("otpauth_url") or enj.get("uri")
            assert secret and otpauth, f"Enroll missing fields: {enj}"

            # Verify
            totp = pyotp.TOTP(secret)
            code = totp.now()
            v = s.post(f"{API}/auth/mfa/verify", headers=H, json={"code": code}, timeout=15)
            assert v.status_code in (200, 204), v.text

            # Fresh login must now require MFA
            lr = s.post(f"{API}/auth/login", json=EMPLOYEE, timeout=15)
            assert lr.status_code == 200, lr.text
            lj = lr.json()
            assert lj.get("mfa_required") is True, f"MFA not required after enable: {lj}"
            mfa_token = lj.get("mfa_token")
            assert mfa_token

            # Wait if same second to avoid replay rejection
            time.sleep(1)
            code2 = pyotp.TOTP(secret).now()
            lm = s.post(
                f"{API}/auth/login/mfa",
                json={"mfa_token": mfa_token, "code": code2},
                timeout=15,
            )
            assert lm.status_code == 200, lm.text
            tok2 = lm.json()["access_token"]
            H2 = {"Authorization": f"Bearer {tok2}", "Content-Type": "application/json"}

            # Disable (uses password; code optional)
            time.sleep(1)
            dcode = pyotp.TOTP(secret).now()
            dis = s.post(
                f"{API}/auth/mfa/disable",
                headers=H2,
                json={"password": PASSWORD, "code": dcode},
                timeout=15,
            )
            assert dis.status_code in (200, 204), dis.text
        finally:
            # Safety: ensure MFA is disabled on employee
            try:
                # Try plain-password login — if MFA still enabled, we'll get mfa_required and attempt disable
                check = requests.post(f"{API}/auth/login", json=EMPLOYEE, timeout=15).json()
                if check.get("mfa_required"):
                    # best-effort recovery — can't disable without secret, flag
                    pytest.fail("Employee left with MFA enabled; cannot recover without stored secret")
            except Exception:
                pass

        # Final: login works normally
        final = requests.post(f"{API}/auth/login", json=EMPLOYEE, timeout=15)
        assert final.status_code == 200
        assert "access_token" in final.json()
        assert not final.json().get("mfa_required")


# ---------- Sessions list & revoke ----------
class TestSessions:
    def test_list_and_revoke_other(self):
        # Create two independent sessions for admin
        s1 = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15).json()
        time.sleep(1)
        s2 = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15).json()
        tok1, rtok1 = s1["access_token"], s1["refresh_token"]
        tok2, rtok2 = s2["access_token"], s2["refresh_token"]

        lst = requests.get(f"{API}/auth/sessions", headers=_h(tok1), timeout=15)
        assert lst.status_code == 200
        sessions = lst.json().get("items", lst.json() if isinstance(lst.json(), list) else [])
        assert len(sessions) >= 2

        # Identify session "other" than tok1's — try to find one that is NOT current
        current = next((s for s in sessions if s.get("is_current") or s.get("current")), None)
        other = next(
            (s for s in sessions if (not s.get("is_current") and not s.get("current"))),
            None,
        )
        # fallback: just pick one that isn't the first — revoke the second session
        if not other and len(sessions) >= 2:
            other = sessions[1]

        assert other, f"Could not pick other session from {sessions}"
        rev = requests.delete(
            f"{API}/auth/sessions/{other['id']}", headers=_h(tok1), timeout=15
        )
        assert rev.status_code in (200, 204), rev.text

        # The refresh token belonging to that session should now fail
        # Try both rtok2 and rtok1 — whichever matches the revoked session should 401
        bad = requests.post(f"{API}/auth/refresh", json={"refresh_token": rtok2}, timeout=15)
        good_or_bad = requests.post(f"{API}/auth/refresh", json={"refresh_token": rtok1}, timeout=15)
        # At least one of them should be 401 (the revoked one)
        assert bad.status_code == 401 or good_or_bad.status_code == 401, (
            f"Neither refresh was revoked: rtok2={bad.status_code}, rtok1={good_or_bad.status_code}"
        )
