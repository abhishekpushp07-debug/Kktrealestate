"""KKT Real Estate ERP backend tests - covers auth, RBAC, masters, projects, blocks, flats, settings."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-realty-hub-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PWD = "Kkt@12345"

# ---- shared cache to avoid repeated logins (rate limit 10/min) ----
_TOKEN_CACHE: dict[str, dict] = {}


def _login(email: str) -> dict:
    if email in _TOKEN_CACHE:
        return _TOKEN_CACHE[email]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PWD})
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    data = r.json()
    _TOKEN_CACHE[email] = data
    return data


def _h(email: str) -> dict:
    return {"Authorization": f"Bearer {_login(email)['access_token']}"}


# =====================================================================
# 1. Health, openapi, auth gates
# =====================================================================
class TestInfra:
    def test_health(self):
        r = requests.get(f"{API}/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_openapi(self):
        r = requests.get(f"{API}/openapi.json")
        assert r.status_code == 200
        assert "paths" in r.json()

    def test_unauth_projects(self):
        r = requests.get(f"{API}/projects")
        assert r.status_code == 401
        j = r.json()
        assert "detail" in j and "code" in j

    def test_employee_forbidden_on_users(self):
        r = requests.get(f"{API}/users", headers=_h("employee@kkt.in"))
        assert r.status_code == 403
        j = r.json()
        assert j.get("code") in ("FORBIDDEN", "PERMISSION_DENIED")


# =====================================================================
# 2. Auth flows
# =====================================================================
class TestAuth:
    def test_all_seeded_users_login(self):
        for em in ["admin@kkt.in", "projectadmin@kkt.in", "accounts@kkt.in", "sales@kkt.in", "employee@kkt.in"]:
            tok = _login(em)
            assert "access_token" in tok and "refresh_token" in tok
            assert tok["user"]["email"] == em

    def test_me_returns_permissions(self):
        r = requests.get(f"{API}/auth/me", headers=_h("admin@kkt.in"))
        assert r.status_code == 200
        assert isinstance(r.json().get("permissions"), list)
        assert len(r.json()["permissions"]) > 0

    def test_refresh_rotation_and_reuse_detection(self):
        # Use sales user (non-destructive) with FRESH login (not cached) to get a dedicated refresh
        r = requests.post(f"{API}/auth/login", json={"email": "sales@kkt.in", "password": PWD})
        assert r.status_code == 200
        old_refresh = r.json()["refresh_token"]
        # rotate
        r2 = requests.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh})
        assert r2.status_code == 200, r2.text
        new_pair = r2.json()
        assert new_pair["refresh_token"] != old_refresh
        # reuse old -> 401
        r3 = requests.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh})
        assert r3.status_code == 401
        # Invalidate sales cache so other tests get fresh token
        _TOKEN_CACHE.pop("sales@kkt.in", None)

    def test_logout_revokes(self):
        r = requests.post(f"{API}/auth/login", json={"email": "accounts@kkt.in", "password": PWD})
        tok = r.json()
        h = {"Authorization": f"Bearer {tok['access_token']}"}
        rl = requests.post(f"{API}/auth/logout", headers=h, json={"refresh_token": tok["refresh_token"]})
        assert rl.status_code == 200
        # refresh now 401
        rr = requests.post(f"{API}/auth/refresh", json={"refresh_token": tok["refresh_token"]})
        assert rr.status_code == 401


# =====================================================================
# 3. Account lockout - uses a NEW throwaway user to avoid locking seeded
# =====================================================================
class TestLockout:
    def test_lockout_new_user(self):
        admin_h = _h("admin@kkt.in")
        # Get a Sales role id
        roles = requests.get(f"{API}/roles", headers=admin_h).json()
        role_id = next(r["id"] for r in roles["items"] if r["name"] == "Sales")
        email = f"locktest_{uuid.uuid4().hex[:6]}@kkt.in"
        r = requests.post(f"{API}/users", headers=admin_h, json={
            "name": "Lock Test", "email": email, "password": PWD,
            "role_id": role_id, "project_scope": ["*"],
        })
        assert r.status_code == 201, r.text
        # 5 wrong passwords
        got_locked = False
        for i in range(5):
            rr = requests.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass123"})
            if rr.status_code == 429:
                pytest.skip("Rate limited during lockout test")
            if rr.status_code == 423:
                got_locked = True
                break
            assert rr.status_code == 401
        if not got_locked:
            # 5th attempt should trigger lock
            rr = requests.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass123"})
            assert rr.status_code == 423
        # correct password still locked
        rc = requests.post(f"{API}/auth/login", json={"email": email, "password": PWD})
        if rc.status_code == 429:
            pytest.skip("Rate limited during final assertion")
        assert rc.status_code == 423
        assert rc.json()["code"] == "ACCOUNT_LOCKED"


# =====================================================================
# 4. RBAC & Project scope
# =====================================================================
class TestRBAC:
    def test_projectadmin_scoped_to_SGH(self):
        h = _h("projectadmin@kkt.in")
        r = requests.get(f"{API}/projects", headers=h)
        assert r.status_code == 200
        items = r.json()["items"]
        codes = {p["code"] for p in items}
        assert codes == {"SGH"}, codes
        sgh_id = items[0]["id"]
        # try to fetch GGV
        all_admin = requests.get(f"{API}/projects?include_inactive=true", headers=_h("admin@kkt.in")).json()["items"]
        ggv = next((p for p in all_admin if p["code"] == "GGV"), None)
        assert ggv is not None
        r2 = requests.get(f"{API}/projects/{ggv['id']}", headers=h)
        assert r2.status_code == 404
        # blocks & flats also only SGH
        bl = requests.get(f"{API}/blocks", headers=h).json()
        for b in bl["items"]:
            assert b["project_id"] == sgh_id
        fl = requests.get(f"{API}/flats?page_size=100", headers=h).json()
        for f in fl["items"]:
            assert f["project_id"] == sgh_id

    def test_sales_cannot_post_master(self):
        r = requests.post(f"{API}/master/room-types", headers=_h("sales@kkt.in"),
                          json={"name": "X", "code": "X1"})
        assert r.status_code == 403

    def test_sales_cannot_list_users(self):
        r = requests.get(f"{API}/users", headers=_h("sales@kkt.in"))
        assert r.status_code == 403

    def test_employee_read_only(self):
        h = _h("employee@kkt.in")  # R1: Employee = zero permissions until granted
        assert requests.get(f"{API}/projects", headers=h).json().get("code") == "PERMISSION_DENIED"
        r = requests.post(f"{API}/master/room-types", headers=h, json={"name": "X", "code": "X2"})
        assert r.status_code == 403 and r.json()["code"] == "PERMISSION_DENIED"


# =====================================================================
# 5. Flat Type creation / validation
# =====================================================================
class TestFlatType:
    @pytest.fixture(scope="class")
    def master_ids(self):
        h = _h("admin@kkt.in")
        rt = requests.get(f"{API}/master/room-types?page_size=100", headers=h).json()["items"]
        at = requests.get(f"{API}/master/area-types?page_size=100", headers=h).json()["items"]
        rt_by = {r["code"]: r["id"] for r in rt}
        at_by = {a["code"]: a["id"] for a in at}
        return {"rt": rt_by, "at": at_by, "all_rt": rt}

    def test_create_flat_type_auto_area(self, master_ids):
        h = _h("admin@kkt.in")
        # pick 4 room type ids (first 4 active ones)
        rt_list = master_ids["all_rt"][:4]
        assert len(rt_list) >= 4, "Need 4 seeded room types"
        payload = {
            "name": f"TEST_FT_{uuid.uuid4().hex[:6]}",
            "code": f"TFT{uuid.uuid4().hex[:4].upper()}",
            "bhk": 3,
            "rooms": [
                {"room_type_id": rt_list[0]["id"], "label": "Bed1", "length_ft": 12, "width_ft": 10},
                {"room_type_id": rt_list[1]["id"], "label": "Bed2", "length_ft": 11, "width_ft": 10},
                {"room_type_id": rt_list[2]["id"], "label": "Living", "length_ft": 15, "width_ft": 12},
                {"room_type_id": rt_list[3]["id"], "label": "Kitchen", "length_ft": 8, "width_ft": 7},
            ],
            "areas": [
                {"area_type_id": master_ids["at"]["CARPET"], "value_sqft": 900},
                {"area_type_id": master_ids["at"]["BUILTUP"], "value_sqft": 1050},
                {"area_type_id": master_ids["at"]["SUPER_BUILTUP"], "value_sqft": 1250},
            ],
        }
        r = requests.post(f"{API}/master/flat-types", headers=h, json=payload)
        assert r.status_code == 201, r.text
        data = r.json()
        for room in data["rooms"]:
            assert room["area_sqft"] == pytest.approx(room["length_ft"] * room["width_ft"], rel=1e-2)
        # cleanup
        requests.post(f"{API}/master/flat-types/{data['id']}/deactivate", headers=h)

    def test_create_flat_type_invalid_hierarchy(self, master_ids):
        h = _h("admin@kkt.in")
        rt_list = master_ids["all_rt"][:1]
        payload = {
            "name": f"TEST_BAD_{uuid.uuid4().hex[:6]}",
            "code": f"TBD{uuid.uuid4().hex[:4].upper()}",
            "bhk": 2,
            "rooms": [{"room_type_id": rt_list[0]["id"], "label": "R", "length_ft": 10, "width_ft": 10}],
            "areas": [
                {"area_type_id": master_ids["at"]["CARPET"], "value_sqft": 1300},
                {"area_type_id": master_ids["at"]["SUPER_BUILTUP"], "value_sqft": 1200},
            ],
        }
        r = requests.post(f"{API}/master/flat-types", headers=h, json=payload)
        assert r.status_code == 422
        assert "area" in r.json()["detail"].lower()


# =====================================================================
# 6. Block creation + flat generation + pricing + status flows
# =====================================================================
class TestBlock:
    @pytest.fixture(scope="class")
    def ctx(self):
        h = _h("admin@kkt.in")
        projs = requests.get(f"{API}/projects", headers=h).json()["items"]
        sgh = next(p for p in projs if p["code"] == "SGH")
        bt = requests.get(f"{API}/master/block-types?page_size=50", headers=h).json()["items"]
        tower = next(b for b in bt if b["name"].lower().startswith("tower"))
        fts = requests.get(f"{API}/master/flat-types?page_size=50", headers=h).json()["items"]
        assert len(fts) >= 1
        ft_id = fts[0]["id"]
        return {"h": h, "sgh": sgh, "tower": tower, "ft_id": ft_id}

    def test_create_block_and_generation(self, ctx):
        h = ctx["h"]
        code = f"T{uuid.uuid4().hex[:1].upper()}"
        body = {
            "project_id": ctx["sgh"]["id"],
            "block_type_id": ctx["tower"]["id"],
            "name": f"TEST_Tower_{code}",
            "code": code,
            "floors": 8,
            "flats_per_floor": 4,
            "floor_start": 1,
            "numbering_pattern": "{block}-{floor}{pos2}",
            "position_flat_types": [
                {"position": 1, "flat_type_id": ctx["ft_id"]},
                {"position": 2, "flat_type_id": ctx["ft_id"]},
                {"position": 3, "flat_type_id": ctx["ft_id"]},
                {"position": 4, "flat_type_id": ctx["ft_id"]},
            ],
            "rate_per_sqft": 4000,
            "floor_rise_per_sqft": 50,
        }
        r = requests.post(f"{API}/blocks", headers=h, json=body)
        assert r.status_code == 201, r.text
        bk = r.json()
        assert bk["flats_generated"] == 32
        block_id = bk["id"]
        pytest.block_id = block_id
        pytest.block_code = code

        # list flats
        fl = requests.get(f"{API}/flats?block_id={block_id}&page_size=100", headers=h).json()
        assert fl["total"] == 32
        numbers = sorted(f["flat_number"] for f in fl["items"])
        assert f"{code}-101" in numbers
        assert f"{code}-804" in numbers

        # verify pricing for floor 3
        f3 = next(f for f in fl["items"] if f["flat_number"] == f"{code}-301")
        full = requests.get(f"{API}/flats/{f3['id']}", headers=h).json()
        assert "rooms_snapshot" in full and "areas_snapshot" in full
        sbu = full.get("super_builtup_sqft")
        if sbu:
            expected = round((4000 + 50 * 2) * sbu, 2)
            assert full["price"] == pytest.approx(expected, abs=0.5)

    def test_regenerate_409_on_hold(self, ctx):
        h = ctx["h"]
        block_id = pytest.block_id
        code = pytest.block_code
        flats = requests.get(f"{API}/flats?block_id={block_id}&page_size=100", headers=h).json()["items"]
        f101 = next(f for f in flats if f["flat_number"] == f"{code}-101")
        rs = requests.patch(f"{API}/flats/{f101['id']}/status", headers=h, json={"status": "Hold"})
        assert rs.status_code == 200
        rr = requests.post(f"{API}/blocks/{block_id}/generate-flats", headers=h)
        assert rr.status_code == 409

    def test_booked_status_manual_blocked(self, ctx):
        h = ctx["h"]
        block_id = pytest.block_id
        code = pytest.block_code
        flats = requests.get(f"{API}/flats?block_id={block_id}&page_size=100", headers=h).json()["items"]
        f102 = next(f for f in flats if f["flat_number"] == f"{code}-102")
        rs = requests.patch(f"{API}/flats/{f102['id']}/status", headers=h, json={"status": "Booked"})
        assert rs.status_code == 409

    def test_add_floors_and_bulk_price(self, ctx):
        h = ctx["h"]
        block_id = pytest.block_id
        r = requests.post(f"{API}/blocks/{block_id}/floors", headers=h, json={"count": 1})
        assert r.status_code == 200
        total = requests.get(f"{API}/flats?block_id={block_id}&page_size=100", headers=h).json()["total"]
        assert total == 36
        bp = requests.post(f"{API}/blocks/{block_id}/bulk-price", headers=h,
                           json={"rate_per_sqft": 5000, "only_available": True})
        assert bp.status_code == 200
        assert bp.json()["flats_updated"] >= 30

    def test_block_grid(self, ctx):
        h = ctx["h"]
        g = requests.get(f"{API}/blocks/{pytest.block_id}/grid", headers=h)
        assert g.status_code == 200
        d = g.json()
        assert "floors" in d and "positions" in d and "counts" in d
        # floors desc
        floor_nums = [f["floor"] for f in d["floors"]]
        assert floor_nums == sorted(floor_nums, reverse=True)

    def test_audit_log_flat_status(self, ctx):
        h = ctx["h"]
        r = requests.get(f"{API}/audit-logs?entity_type=flat&action=flat.status&page_size=100", headers=h)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(it["action"] == "flat.status" for it in items)
        sample = next(it for it in items if it["action"] == "flat.status")
        assert sample["action_kind"] == "status_changed" and sample["module_name"] == "Flat"
        assert any(c["field"] == "status" for c in sample.get("changed_fields") or []) or sample.get("record_label")


# =====================================================================
# 7. Deactivate room type usage check
# =====================================================================
class TestMasterDeactivate:
    def test_deactivate_room_type_in_use(self):
        h = _h("admin@kkt.in")
        fts = requests.get(f"{API}/master/flat-types?page_size=5", headers=h).json()["items"]
        assert fts
        room_type_id = fts[0]["rooms"][0]["room_type_id"]
        r = requests.post(f"{API}/master/room-types/{room_type_id}/deactivate", headers=h)
        assert r.status_code == 409
        assert "flat type" in r.json()["detail"].lower()

    def test_deactivate_unused_room_type(self):
        h = _h("admin@kkt.in")
        payload = {"name": f"TEST_RT_{uuid.uuid4().hex[:6]}", "code": f"TRT{uuid.uuid4().hex[:4].upper()}"}
        c = requests.post(f"{API}/master/room-types", headers=h, json=payload)
        assert c.status_code == 201
        rid = c.json()["id"]
        r = requests.post(f"{API}/master/room-types/{rid}/deactivate", headers=h)
        assert r.status_code == 200
        assert r.json()["is_active"] is False


# =====================================================================
# 8. Pagination, search, dashboard
# =====================================================================
class TestLists:
    def test_flats_pagination(self):
        h = _h("admin@kkt.in")
        r = requests.get(f"{API}/flats?page=1&page_size=10", headers=h)
        assert r.status_code == 200
        d = r.json()
        for k in ("items", "total", "page", "page_size"):
            assert k in d
        assert len(d["items"]) <= 10

    def test_page_size_too_large(self):
        h = _h("admin@kkt.in")
        r = requests.get(f"{API}/flats?page=1&page_size=500", headers=h)
        assert r.status_code == 422

    def test_search(self):
        h = _h("admin@kkt.in")
        r = requests.get(f"{API}/flats?search=A-1&page_size=50", headers=h)
        assert r.status_code == 200
        for f in r.json()["items"]:
            assert "A-1" in f["flat_number"] or "A-1" in (f.get("flat_type_code") or "")

    def test_dashboard_total_matches(self):
        h = _h("admin@kkt.in")
        d = requests.get(f"{API}/dashboard", headers=h).json()
        total_dash = d["inventory"]["total"]
        total_flats = requests.get(f"{API}/flats?page=1&page_size=1", headers=h).json()["total"]
        assert total_dash == total_flats


# =====================================================================
# 9. Users / Roles / Permissions
# =====================================================================
class TestUsersRoles:
    def test_cannot_deactivate_self(self):
        tok = _login("admin@kkt.in")
        h = {"Authorization": f"Bearer {tok['access_token']}"}
        uid = tok["user"]["id"]
        r = requests.patch(f"{API}/users/{uid}", headers=h, json={"is_active": False})
        assert r.status_code == 409
        assert r.json()["code"] == "SELF_DEACTIVATE"

    def test_delete_system_role(self):
        h = _h("admin@kkt.in")
        roles = requests.get(f"{API}/roles", headers=h).json()["items"]
        sys_role = next(r for r in roles if r.get("is_system"))
        r = requests.delete(f"{API}/roles/{sys_role['id']}", headers=h)
        assert r.status_code == 409

    def test_permissions_groups(self):
        h = _h("admin@kkt.in")
        r = requests.get(f"{API}/permissions", headers=h)
        assert r.status_code == 200
        assert "groups" in r.json()


# =====================================================================
# 10. Settings - bank account masking
# =====================================================================
class TestSettings:
    def test_bank_account_masked(self):
        h = _h("admin@kkt.in")
        acct = "99887766554433"
        r = requests.patch(f"{API}/settings/company", headers=h, json={
            "bank_account": {"bank_name": "HDFC", "account_name": "KKT", "account_number": acct, "ifsc": "HDFC0001"}
        })
        assert r.status_code == 200, r.text
        ba = r.json()["bank_account"]
        assert "account_number" not in ba
        masked = ba.get("account_number_masked", "")
        assert masked.endswith("4433")
        assert "*" in masked or "X" in masked.upper()
        # GET returns masked only
        g = requests.get(f"{API}/settings/company", headers=h).json()
        assert "account_number" not in (g.get("bank_account") or {})
        assert g["bank_account"]["account_number_masked"].endswith("4433")
