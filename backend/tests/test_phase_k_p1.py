"""Phase K P1 proofs: load shedding, query budgets, anti-escalation rules, DB lockout + constant-time login, retryable envelopes."""
import os
import sys
import threading
import time
import uuid

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE, session_token  # noqa: E402


def _sync_db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ---- 7. load shedding ---------------------------------------------------------------------------
def test_loadshed_sheds_with_prebuilt_503_and_exempts_probes():
    from starlette.testclient import TestClient
    from fastapi import FastAPI
    from services import loadshed
    app = FastAPI()
    app.add_middleware(loadshed.LoadShedMiddleware)

    @app.get("/api/x")
    async def x():
        return {"ok": True}

    @app.get("/api/health")
    async def h():
        return {"ok": True}
    c = TestClient(app)
    loadshed.STATE["inflight"] = loadshed.current_cap()  # saturate
    try:
        r = c.get("/api/x")
        assert r.status_code == 503 and r.headers["Retry-After"] == "2" and r.json()["code"] == "OVERLOADED"
        assert c.get("/api/health").status_code == 200
        before = loadshed.STATE["shed_total"]
        c.get("/api/x")
        assert loadshed.STATE["shed_total"] == before + 1
    finally:
        loadshed.STATE["inflight"] = 0
    assert c.get("/api/x").status_code == 200
    loadshed.STATE["degraded"] = True
    assert loadshed.current_cap() == max(8, loadshed.MAX_INFLIGHT // 4)
    loadshed.STATE["degraded"] = False
    assert "shed_total" in loadshed.snapshot()


def test_health_fast_and_ops_shows_shed(admin_headers):
    t0 = time.perf_counter()
    r = requests.get(f"{BASE}/api/health")
    assert r.status_code == 200 and time.perf_counter() - t0 < 0.5
    ops = requests.get(f"{BASE}/api/admin/ops", headers=admin_headers).json()
    assert "load_shed" in ops and "shed_total" in ops["load_shed"]


# ---- 8. query budgets ---------------------------------------------------------------------------
def test_query_timeout_envelope():
    """ExecutionTimeout from any budgeted cursor → 503 QUERY_TIMEOUT + Retry-After: 5 (exception handler proof)."""
    from fastapi import FastAPI
    from pymongo.errors import ExecutionTimeout
    from starlette.testclient import TestClient
    import server
    app = FastAPI()
    app.add_exception_handler(Exception, server.unhandled_exc_handler)

    @app.get("/boom")
    async def boom():
        raise ExecutionTimeout("operation exceeded time limit")
    r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 503 and r.json()["code"] == "QUERY_TIMEOUT" and r.headers["Retry-After"] == "5"


def test_budgets_wired_into_search_and_reports():
    src = open(os.path.join(os.path.dirname(__file__), "..", "routers", "search.py")).read()
    assert src.count("max_time_ms(SEARCH_MS)") >= 5
    for f in ("reports.py", "reports_i.py"):
        s = open(os.path.join(os.path.dirname(__file__), "..", "routers", f)).read()
        assert ".aggregate([" not in s and "maxTimeMS=REPORT_MS" in s, f


# ---- 11. retryable DB envelopes -----------------------------------------------------------------
def test_transient_db_errors_map_to_retryable_envelopes():
    from fastapi import FastAPI
    from pymongo.errors import AutoReconnect, OperationFailure
    from starlette.testclient import TestClient
    import server
    app = FastAPI()
    app.add_exception_handler(Exception, server.unhandled_exc_handler)

    @app.get("/a")
    async def a():
        raise AutoReconnect("connection reset")

    @app.get("/b")
    async def b():
        raise OperationFailure("write conflict", code=112)
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/a")
    assert r.status_code == 503 and r.json()["code"] == "DB_TIMEOUT" and r.headers["Retry-After"] == "2"
    r = c.get("/b")
    assert r.status_code == 409 and r.json()["code"] == "CONFLICT_RETRY" and r.headers["Retry-After"] == "1"


def test_frontend_retries_idempotent_get_once_on_503():
    src = open("/app/frontend/src/lib/api.js").read()
    assert "_retried503" in src and 'retry-after' in src


# ---- 9. anti-escalation -------------------------------------------------------------------------
def _me(h):
    return requests.get(f"{BASE}/api/auth/me", headers=h).json()


def test_r1_cannot_change_own_roles_or_reset_own_password(admin_headers):
    me = _me(admin_headers)
    acc = requests.get(f"{BASE}/api/admin/access/users/{me['id']}", headers=admin_headers).json()["user"]
    r = requests.put(f"{BASE}/api/admin/access/users/{me['id']}", json={"role_ids": acc["role_ids"] or [acc["role_id"]], "direct": [], "version": acc.get("version")}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "SELF_ACCESS_CHANGE", r.text
    r = requests.post(f"{BASE}/api/users/{me['id']}/reset-password", json={"new_password": "Another@12345x"}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "SELF_ACCESS_CHANGE", r.text


@pytest.fixture
def scoped_admin(admin_headers):
    """A non-super admin holding admin.user.edit + access_control.manage, scoped to one project."""
    db = _sync_db()
    projects = requests.get(f"{BASE}/api/projects?page_size=5", headers=admin_headers).json()
    projects = projects["items"] if isinstance(projects, dict) else projects
    pid = projects[0]["id"]
    role_id = f"role-k9-{uuid.uuid4()}"
    company_id = _me(admin_headers)["company_id"]
    db.roles.insert_one({"id": role_id, "company_id": company_id, "name": f"K9 Admin {role_id[-4:]}", "is_system": False, "is_active": True, "permissions": ["admin.user.view", "admin.user.edit", "admin.access_control.view", "admin.access_control.manage", "sales.customer.view"], "version": 1})
    email = f"k9-{uuid.uuid4().hex[:8]}@kkt.in"
    r = requests.post(f"{BASE}/api/users", json={"name": "K9 Scoped", "email": email, "phone": f"96{uuid.uuid4().int % 10**8:08d}", "role_id": role_id, "project_scope": [pid], "password": "Scoped@12345"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    db.users.update_one({"id": uid}, {"$set": {"must_change_password": False}})
    tok = session_token(email, "Scoped@12345")
    yield {"headers": {"Authorization": f"Bearer {tok}"}, "id": uid, "role_id": role_id, "project_id": pid, "company_id": company_id}
    db.users.delete_one({"id": uid})
    db.roles.delete_one({"id": role_id})
    db.user_direct_permissions.delete_many({"user_id": uid})


def test_r2_r3_r4_escalation_blocked(admin_headers, scoped_admin):
    db = _sync_db()
    h = scoped_admin["headers"]
    # target: a plain employee scoped to the same project
    emp_role = db.roles.find_one({"name": "Employee", "is_system": True}, {"id": 1}) or db.roles.find_one({"is_active": True, "permissions": []}, {"id": 1})
    assert emp_role, "needs an Employee role"
    r = requests.post(f"{BASE}/api/users", json={"name": "K9 Target", "email": f"k9t-{uuid.uuid4().hex[:8]}@kkt.in", "phone": f"95{uuid.uuid4().int % 10**8:08d}", "role_id": emp_role["id"], "project_scope": [scoped_admin["project_id"]], "password": "Target@12345"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    try:
        acc = requests.get(f"{BASE}/api/admin/access/users/{tid}", headers=h).json()["user"]
        # R2: grant a permission the actor does not hold
        r = requests.put(f"{BASE}/api/admin/access/users/{tid}", json={"role_ids": acc["role_ids"] or [acc["role_id"]], "direct": [{"code": "finance.payment.export", "effect": "allow", "reason": "esc"}], "version": acc.get("version")}, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "GRANT_ESCALATION", r.text
        # R3: widen scope beyond own
        r = requests.put(f"{BASE}/api/admin/access/users/{tid}", json={"role_ids": acc["role_ids"] or [acc["role_id"]], "direct": [], "project_scope": ["*"], "version": acc.get("version")}, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "SCOPE_ESCALATION", r.text
        # R4: assign Super Admin
        sa = db.roles.find_one({"name": "Super Admin", "is_system": True}, {"id": 1})
        r = requests.put(f"{BASE}/api/admin/access/users/{tid}", json={"role_ids": [sa["id"]], "direct": [], "version": acc.get("version")}, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "SUPER_ADMIN_ONLY", r.text
        # R4: touch a Super Admin account
        admin_id = _me(admin_headers)["id"]
        r = requests.post(f"{BASE}/api/users/{admin_id}/reset-password", json={"new_password": "Hijack@12345"}, headers=h)
        assert r.status_code == 403 and r.json()["code"] == "SUPER_ADMIN_ONLY", r.text
        # R3: a wider-scope (global) account is untouchable
        g = requests.post(f"{BASE}/api/users", json={"name": "K9 Global", "email": f"k9g-{uuid.uuid4().hex[:8]}@kkt.in", "phone": f"94{uuid.uuid4().int % 10**8:08d}", "role_id": emp_role["id"], "project_scope": ["*"], "password": "Global@12345"}, headers=admin_headers).json()
        try:
            r = requests.patch(f"{BASE}/api/users/{g['id']}", json={"name": "renamed", "version": g["version"]}, headers=h)
            assert r.status_code == 403 and r.json()["code"] == "SCOPE_ESCALATION", r.text
        finally:
            db.users.delete_one({"id": g["id"]})
        # positive: allowed grant within held permissions on an in-scope account works
        r = requests.put(f"{BASE}/api/admin/access/users/{tid}", json={"role_ids": acc["role_ids"] or [acc["role_id"]], "direct": [{"code": "sales.customer.view", "effect": "allow", "reason": "ok"}], "version": acc.get("version")}, headers=h)
        assert r.status_code == 200, r.text
    finally:
        db.users.delete_one({"id": tid})
        db.user_direct_permissions.delete_many({"user_id": tid})
        db.audit_logs.delete_many({"entity_id": tid}) if False else None


# ---- 10. lockout + timing -----------------------------------------------------------------------
def test_unknown_vs_known_identifier_same_response_and_timing():
    import statistics
    def t(email):
        t0 = time.perf_counter()
        r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "definitely-wrong-1"})
        return r, time.perf_counter() - t0
    known, unknown = [], []
    for i in range(3):
        r1, d1 = t("admin@kkt.in")
        r2, d2 = t(f"nobody-{i}@kkt.in")
        assert r1.status_code == r2.status_code == 401 and r1.json()["code"] == r2.json()["code"] == "INVALID_CREDENTIALS"
        assert r1.json()["detail"] == r2.json()["detail"]
        known.append(d1)
        unknown.append(d2)
    assert abs(statistics.median(known) - statistics.median(unknown)) < 0.15, (known, unknown)


def test_pair_lockout_from_login_events():
    db = _sync_db()
    email = f"lock-{uuid.uuid4().hex[:6]}@kkt.in"
    for _ in range(10):
        requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "x" * 8}, headers={"X-Forwarded-For": "10.9.9.9"})
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": "x" * 8}, headers={"X-Forwarded-For": "10.9.9.9"})
    assert r.status_code in (423, 429), r.text
    if r.status_code == 423:
        assert r.json()["code"] == "ACCOUNT_LOCKED"
    db.login_events.delete_many({"email": email})


def test_refresh_reuse_and_sessions_exist():
    src = open(os.path.join(os.path.dirname(__file__), "..", "routers", "auth.py")).read()
    assert "REFRESH_TOKEN_REUSED" in src and '@router.get("/sessions")' in src and '@router.delete("/sessions/{session_id}")' in src
