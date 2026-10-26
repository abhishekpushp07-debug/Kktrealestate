"""Phase R1 — RBAC tests: registry completeness, effective-permission algebra, guard rails, 403 envelope."""
import os

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")}
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _login(email, pw="Kkt@12345"):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, headers=BYPASS, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}


@pytest.fixture(scope="module")
def admin():
    return _login("admin@kkt.in")


PROBE = "rbac-probe@kkt.in"


@pytest.fixture(scope="module")
def sales_user(admin):
    """Throwaway Sales user so concurrent xdist workers never see a mutated demo account."""
    db.users.delete_one({"email": PROBE})
    r = requests.post(f"{BASE}/users", json={"name": "RBAC Probe", "email": PROBE, "password": "Kkt@12345", "role_ids": [_role("Sales")]}, headers=admin, timeout=20)
    assert r.status_code == 201, r.text
    u = r.json()
    acc = requests.get(f"{BASE}/admin/access/users/{u['id']}", headers=admin, timeout=20).json()
    yield u, acc
    db.users.delete_one({"email": PROBE})
    db.user_direct_permissions.delete_many({"user_id": u["id"]})


def _role(name):
    return db.roles.find_one({"name": name, "is_system": True}, {"_id": 0, "id": 1})["id"]


def test_registry_complete_every_guarded_route_registered(admin):
    reg = requests.get(f"{BASE}/admin/access/registry", headers=admin, timeout=20).json()
    assert reg["unregistered"] == [], reg["unregistered"]
    from permissions import ALL_PERMISSIONS
    codes = {r["code"] for r in reg["items"]}
    assert set(ALL_PERMISSIONS) <= codes
    guarded = [r for r in reg["items"] if not r.get("ui_only")]
    assert all(r["route_refs"] for r in guarded if r["code"] not in ("receipt.print", "customer.kyc_view", "catalogue.write")), [r["code"] for r in guarded if not r["route_refs"]]


def test_tree_has_modules_features_actions(admin):
    t = requests.get(f"{BASE}/admin/access/tree", headers=admin, timeout=20).json()
    assert len(t["modules"]) >= 8
    acts = {a["action"] for m in t["modules"] for f in m["features"] for a in f["actions"]}
    assert {"view", "create", "edit", "delete", "export", "approve"} <= acts


def test_multi_role_union_and_direct_deny(admin, sales_user):
    u, acc = sales_user
    r = requests.put(f"{BASE}/admin/access/users/{u['id']}", json={"role_ids": [_role("Sales"), _role("Accounts")], "direct": [{"code": "finance.payment.create", "effect": "deny", "reason": "test"}]}, headers=admin, timeout=20)
    assert r.status_code == 200, r.text
    eff = set(r.json()["effective"])
    assert "finance.payment.reverse" in eff and "sales.customer.edit" in eff  # union of both roles
    assert "finance.payment.create" not in eff  # direct deny wins over role grant
    assert {"role", "deny"} <= {s["type"] for s in r.json()["sources"]["finance.payment.create"]}
    h = _login(PROBE)
    me = requests.get(f"{BASE}/auth/me", headers=h, timeout=20).json()
    assert me["role_names"] == ["Sales", "Accounts"] and "finance.payment.create" not in me["permissions"]
    p = requests.post(f"{BASE}/payments", json={}, headers=h, timeout=20)
    assert p.status_code == 403 and p.json()["code"] == "PERMISSION_DENIED" and p.json()["missing"] == "finance.payment.create"
    # direct allow on top of role
    r = requests.put(f"{BASE}/admin/access/users/{u['id']}", json={"role_ids": [_role("Sales")], "direct": [{"code": "admin.audit.view", "effect": "allow"}]}, headers=admin, timeout=20)
    assert "admin.audit.view" in r.json()["effective"]
    assert requests.get(f"{BASE}/audit-logs?limit=1", headers=_login(PROBE), timeout=20).status_code == 200  # no re-login needed


def test_super_admin_unrestrictable_and_last_super_admin(admin):
    me = requests.get(f"{BASE}/auth/me", headers=admin, timeout=20).json()
    sa = _role("Super Admin")
    r = requests.put(f"{BASE}/admin/access/users/{me['id']}", json={"role_ids": [sa], "direct": [{"code": "finance.payment.create", "effect": "deny"}]}, headers=admin, timeout=20)
    assert r.status_code == 409 and r.json()["code"] == "SUPER_ADMIN_UNRESTRICTABLE"
    others = db.users.count_documents({"is_active": True, "id": {"$ne": me["id"]}, "$or": [{"role_id": sa}, {"role_ids": sa}]})
    if others == 0:
        r = requests.put(f"{BASE}/admin/access/users/{me['id']}", json={"role_ids": [_role("Employee")], "direct": []}, headers=admin, timeout=20)
        assert r.status_code == 409 and r.json()["code"] == "LAST_SUPER_ADMIN"
    else:  # simulate: deactivate the others in DB so this admin is the last one, then expect 409
        db.users.update_many({"is_active": True, "id": {"$ne": me["id"]}, "$or": [{"role_id": sa}, {"role_ids": sa}]}, {"$set": {"_rbac_tmp": True, "is_active": False}})
        try:
            r = requests.put(f"{BASE}/admin/access/users/{me['id']}", json={"role_ids": [_role("Employee")], "direct": []}, headers=admin, timeout=20)
            assert r.status_code == 409 and r.json()["code"] == "LAST_SUPER_ADMIN", r.text
        finally:
            db.users.update_many({"_rbac_tmp": True}, {"$set": {"is_active": True}, "$unset": {"_rbac_tmp": ""}})
    r = requests.patch(f"{BASE}/roles/{sa}", json={"permissions": ["masters.project.view"]}, headers=admin, timeout=20)
    assert r.status_code == 409


def test_new_user_defaults_to_employee_zero_permissions(admin):
    email = "rbac-newbie@kkt.in"
    db.users.delete_one({"email": email})
    r = requests.post(f"{BASE}/users", json={"name": "RBAC Newbie", "email": email, "password": "Newbie@12345"}, headers=admin, timeout=20)
    assert r.status_code == 201, r.text
    assert r.json()["role_names"] == ["Employee"]
    acc = requests.get(f"{BASE}/admin/access/users/{r.json()['id']}", headers=admin, timeout=20).json()
    assert acc["effective"] == []
    db.users.delete_one({"email": email})


def test_access_change_is_audited(admin, sales_user):
    u, _ = sales_user
    rows = list(db.audit_logs.find({"action": "user.access_update", "entity_id": u["id"]}).sort("created_at", -1).limit(1))
    assert rows and rows[0]["changed_fields"] and rows[0]["module_name"] == "User"
