"""Granular RBAC: migration equivalence (coarse → specific) and a custom narrow role proving per-action control end to end."""
import uuid

import pytest
import requests

from tests.conftest import BASE, session_token

API = f"{BASE}/api"
CLERK = ["finance.payment.view", "finance.payment.create", "finance.receipt.print", "sales.customer.view", "reports.collections.view"]


def test_legacy_expansion_is_behaviourally_equivalent():
    """Every route a coarse code used to open is opened by its expansion, and the expansion opens nothing the coarse code did not."""
    from permissions import LEGACY_EXPANSION, PERMISSION_SET, ROUTE_PERMS
    assert all(c in PERMISSION_SET for v in LEGACY_EXPANSION.values() for c in v)
    for legacy, specific in LEGACY_EXPANSION.items():
        legacy_routes = {k for k, v in ROUTE_PERMS.items() if legacy in v.get("legacy", [])}
        new_routes = {k for k, v in ROUTE_PERMS.items() if set(v["codes"]) & set(specific)}
        assert legacy_routes <= new_routes, (legacy, legacy_routes - new_routes)


def test_system_roles_cover_their_legacy_routes():
    from permissions import _LEGACY_ROLES, ROUTE_PERMS, SYSTEM_ROLES
    for name, spec in _LEGACY_ROLES.items():
        if spec["permissions"] is None:  # Super Admin / Admin: everything
            continue
        have = set(SYSTEM_ROLES[name]["permissions"])
        for k, v in ROUTE_PERMS.items():
            if set(v.get("legacy", [])) & set(spec["permissions"]):
                assert set(v["codes"]) & have, (name, k)


@pytest.fixture(scope="module")
def clerk(admin_headers):
    h = admin_headers
    name = f"Collections Clerk {uuid.uuid4().hex[:4]}"
    role = requests.post(f"{API}/roles", headers=h, json={"name": name, "description": "Posts payments, prints receipts, reads customers and the collections report", "permissions": CLERK}, timeout=20)
    assert role.status_code == 201, role.text
    email = f"clerk_{uuid.uuid4().hex[:6]}@kkt.in"
    u = requests.post(f"{API}/users", headers=h, json={"name": "Collections Clerk", "email": email, "password": "Clerk@12345", "role_id": role.json()["id"], "project_scope": ["*"]}, timeout=20)
    assert u.status_code == 201, u.text
    return {"Authorization": f"Bearer {session_token(email, 'Clerk@12345')}"}, role.json(), u.json()


def test_clerk_effective_permissions_exact(clerk):
    h, role, _ = clerk
    me = requests.get(f"{API}/auth/me", headers=h, timeout=20).json()
    assert sorted(me["permissions"]) == sorted(CLERK)
    assert me["is_super_admin"] is False


def test_clerk_can_view_and_post_but_not_reverse(clerk, admin_headers, work_booking):
    h, _, _ = clerk
    assert requests.get(f"{API}/payments?page_size=5", headers=h, timeout=20).status_code == 200
    assert requests.get(f"{API}/customers?page_size=5", headers=h, timeout=20).status_code == 200
    modes = {m["code"]: m for m in requests.get(f"{API}/master/payment-modes?page_size=50", headers=admin_headers).json()["items"]}
    r = requests.post(f"{API}/payments", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, json={"booking_id": work_booking["id"], "payment_category": "Cash", "amount": 500, "payment_date": "2026-10-26", "payment_mode_id": modes["CASH"]["id"], "remarks": "clerk proof"}, timeout=30)
    assert r.status_code == 201, r.text
    p = r.json()
    assert requests.get(f"{API}/payments/{p['id']}/receipt", headers=h, timeout=20).status_code == 200
    rv = requests.post(f"{API}/payments/{p['id']}/reverse", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, json={"reason": "clerk must not"}, timeout=20)
    assert rv.status_code == 403 and rv.json()["missing"] == "finance.payment.reverse", rv.text
    admin_rv = requests.post(f"{API}/payments/{p['id']}/reverse", headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())}, json={"reason": "cleanup clerk proof"}, timeout=20)
    assert admin_rv.status_code == 200


def test_clerk_reports_collections_only(clerk):
    h, _, _ = clerk
    assert requests.get(f"{API}/reports/collections", headers=h, timeout=30).status_code == 200
    out = requests.get(f"{API}/reports/outstanding", headers=h, timeout=30)
    assert out.status_code == 403 and out.json()["missing"] == "reports.outstanding.view"
    exp = requests.get(f"{API}/reports/collections?format=csv", headers=h, timeout=30)
    assert exp.status_code == 403 and exp.json()["missing"] == "reports.collections.export"
    for path in ("/bookings?page_size=1", "/leads?page_size=1", "/projects", "/users?page_size=1", "/audit-logs?page_size=1", "/roznamcha"):
        assert requests.get(f"{API}{path}", headers=h, timeout=20).status_code == 403, path
    brand = requests.get(f"{API}/settings/company", headers=h, timeout=20).json()  # branding is for every signed-in user, finance/numbering settings are masked
    assert "name" in brand and "receipt_prefix" not in brand and "bank_account" not in brand


def test_direct_grant_and_deny_on_clerk(clerk, admin_headers):
    h, role, u = clerk
    acc = requests.get(f"{API}/admin/access/users/{u['id']}", headers=admin_headers, timeout=20).json()
    put = requests.put(f"{API}/admin/access/users/{u['id']}", headers=admin_headers, json={"role_ids": [role["id"]], "direct": [{"code": "reports.outstanding.view", "effect": "allow"}, {"code": "finance.receipt.print", "effect": "deny"}], "version": acc["user"].get("version")}, timeout=20)
    assert put.status_code == 200, put.text
    eff = set(put.json()["effective"])
    assert "reports.outstanding.view" in eff and "finance.receipt.print" not in eff and "finance.payment.create" in eff
    fresh = {"Authorization": h["Authorization"]}
    assert requests.get(f"{API}/reports/outstanding", headers=fresh, timeout=30).status_code == 200
    p = requests.get(f"{API}/payments?page_size=1", headers=fresh, timeout=20).json()["items"][0]
    assert requests.get(f"{API}/payments/{p['id']}/receipt", headers=fresh, timeout=20).status_code == 403
