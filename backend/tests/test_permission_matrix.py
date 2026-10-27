"""Permission matrix: derived from the FastAPI dependency graph (require(<perm>) / portal_user / public prefix) and asserted at runtime.

Rules: /api/public/* and /api/health|ready → open; /api/portal/* → portal token only (ERP tokens rejected);
everything else → 401 anonymous, 401/403 for a portal token, 403 for roles missing the permission, and never a 5xx."""
import os
import sys

import pytest
import time
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

OPEN_EXACT = {"/api/health", "/api/ready", "/api/auth/login", "/api/auth/login-options", "/api/auth/login/mfa", "/api/auth/refresh", "/api/auth/logout", "/api/openapi.json", "/api/portal/auth/login", "/api/portal/auth/refresh",
              "/api/portal/config", "/api/admin/backups/{backup_id}/download", "/api/exports/{export_id}/download"}  # last two: public branding config; 15-min signed-token download link
ALWAYS_SKIP = ("/api/admin/reseed", "/api/admin/backup", "/api/admin/docs/regenerate", "/api/admin/integrity/repair")


def _route_perms():
    """Walk the app's routes and read the permission each `require()` dependency closes over."""
    from server import app
    out = {}
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/api") or not getattr(r, "methods", None) or not hasattr(r, "dependant"):
            continue
        perms, portal, authed = set(), False, False
        for dep in r.dependant.dependencies:
            fn = dep.call
            name = getattr(fn, "__name__", "")
            if name == "dep" and fn.__closure__:
                for c in fn.__closure__:
                    if isinstance(c.cell_contents, str):
                        perms.add(c.cell_contents)
                    elif isinstance(c.cell_contents, (list, tuple, set, frozenset)) and all(isinstance(x, str) for x in c.cell_contents):
                        perms.update(c.cell_contents)
                authed = True
            elif name in ("portal_user", "portal_booking", "portal_account"):
                portal = True
            elif name in ("get_current_user", "require_super_admin"):
                authed = True
            for sub in dep.dependencies:
                if getattr(sub.call, "__name__", "") in ("portal_user", "portal_account"):
                    portal = True
                if getattr(sub.call, "__name__", "") == "get_current_user":
                    authed = True
        for m in r.methods - {"HEAD", "OPTIONS"}:
            out[(m, path)] = {"perms": perms, "portal": portal, "authed": authed}
    return out


MATRIX = _route_perms()


def _req(m, url, **kw):
    for attempt in range(3):
        try:
            return requests.request(m, url, **kw)
        except requests.exceptions.ConnectionError:
            if attempt == 2:
                raise
            time.sleep(2)


def _fill(path):
    while "{" in path:
        a, b = path.index("{"), path.index("}")
        path = path[:a] + "00000000-0000-0000-0000-000000000000" + path[b + 1:]
    return path


def test_every_non_public_route_is_guarded():
    unguarded = [k for k, v in MATRIX.items() if not (k[1].startswith("/api/public") or k[1] in OPEN_EXACT or v["perms"] or v["portal"] or v["authed"])]
    assert not unguarded, unguarded


def test_matrix_file_matches_runtime(tmp_path):
    """Write the derived matrix next to the code so reviewers can diff it; fail if a tracked copy exists and differs."""
    import json
    target = os.path.join(os.path.dirname(__file__), "..", "security", "permission_matrix.json")
    doc = {f"{m} {p}": sorted(v["perms"]) if v["perms"] else (["<portal>"] if v["portal"] else (["<authenticated>"] if v["authed"] else ["<public>"])) for (m, p), v in sorted(MATRIX.items())}
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        assert json.load(open(target)) == doc, "security/permission_matrix.json is stale — regenerate by deleting it and re-running this test"
    else:
        json.dump(doc, open(target, "w"), indent=1, sort_keys=True)


@pytest.mark.parametrize("who", ["anonymous", "portal"])
def test_anonymous_and_portal_tokens_rejected_everywhere(base_url, who):
    headers = {}
    if who == "portal":
        r = requests.post(f"{base_url}/api/portal/auth/login", json={"phone": "9431023456", "password": "Buyer@12345"})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    bad = []
    for (m, p), v in MATRIX.items():
        if p.startswith("/api/public") or p in OPEN_EXACT or p.startswith(ALWAYS_SKIP) or (who == "portal" and v["portal"]):
            continue
        r = _req(m, base_url + _fill(p), headers=headers, json={} if m in ("POST", "PATCH", "PUT") else None, timeout=20)
        if r.status_code not in (401, 403):
            bad.append((who, m, p, r.status_code))
    assert not bad, bad


ROLE_USERS = {"Sales": ("sales@kkt.in", "Kkt@12345"), "Accounts": ("accounts@kkt.in", "Kkt@12345"), "Employee": ("employee@kkt.in", "Kkt@12345")}


@pytest.mark.parametrize("role", list(ROLE_USERS))
def test_roles_denied_where_permission_missing(base_url, role):
    from permissions import SYSTEM_ROLES
    email, pw = ROLE_USERS[role]
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"{email} not seeded")
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    have = set(SYSTEM_ROLES[role]["permissions"])
    bad = []
    for (m, p), v in MATRIX.items():
        if not v["perms"] or p.startswith(ALWAYS_SKIP) or m != "GET":
            continue
        if v["perms"] & have:
            continue  # allowed by at least one accepted permission
        rr = _req("GET", base_url + _fill(p), headers=headers, timeout=20)
        if rr.status_code != 403:
            bad.append((role, m, p, rr.status_code))
    assert not bad, bad
