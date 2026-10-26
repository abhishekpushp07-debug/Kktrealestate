"""Phase R3 — audit coverage: every mutation route writes an audit row; updates carry changed_fields; sensitive fields masked; views never logged."""
import ast
import os
import pathlib

import requests
from pymongo import MongoClient

from services.audit_diff import MASKED, changed_fields, mask

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")}
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ROUTERS = pathlib.Path(__file__).resolve().parents[1] / "routers"
# Mutation routes that do not change a business record: sessions/tokens, exports/previews, searches, read-model refreshes, idempotent ops.
EXEMPT_FILES = {"auth.py", "public.py", "ops.py", "search.py", "pdfs.py", "propagation.py", "bootstrap.py", "dashboard.py", "dashboard_widgets.py", "home.py", "reports.py", "portal.py"}
EXEMPT_ROUTES = {"admin.py": {"reseed", "reseed_status", "recompute_counters", "reconcile", "replay", "refresh_read_models", "rebuild", "story_marker"}, "bookings.py": {"recompute", "cancellation_preview", "preview_cancel", "preview_transfer"}, "notifications.py": {"mark_read", "mark_all_read", "read_all"},
                 "imports.py": {"preview", "preview_import"}, "documents.py": {"download", "presign"}, "support.py": set()}


def _admin():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=BYPASS, timeout=20)
    return {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}


def test_changed_fields_diff_and_masking():
    cf = changed_fields({"price_paise": 500000, "pan": "ABCDE1234F", "status": "Available", "updated_at": 1}, {"price_paise": 550000, "pan": "ZZZZZ9999Z", "status": "Available", "updated_at": 2})
    by = {c["field"]: c for c in cf}
    assert by["price_paise"]["kind"] == "money" and by["price_paise"]["old"] == 500000 and by["price_paise"]["new"] == 550000
    assert by["pan"]["old"] == MASKED and by["pan"]["new"] == MASKED
    assert "status" not in by and "updated_at" not in by
    assert mask({"aadhaar_number": "1234", "bank_account": {"ifsc": "X"}, "name": "ok"}) == {"aadhaar_number": MASKED, "bank_account": MASKED, "name": "ok"}


def test_flat_price_edit_produces_money_diff_row():
    h = _admin()
    f = db.flats.find_one({"status": "Available"}, {"_id": 0, "id": 1, "price_paise": 1, "version": 1})
    r = requests.patch(f"{BASE}/flats/{f['id']}", json={"version": f["version"], "price": (f["price_paise"] + 50000) / 100}, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    row = db.audit_logs.find_one({"entity_type": "flat", "entity_id": f["id"]}, sort=[("created_at", -1)])
    pc = next(c for c in row["changed_fields"] if c["field"] == "price_paise")
    assert pc["kind"] == "money" and pc["new"] - pc["old"] == 50000 and row["module_name"] == "Flat" and row["user_name"] and row["request_id"]
    hist = requests.get(f"{BASE}/audit-logs/entity/flat/{f['id']}", headers=h, timeout=20).json()
    assert any(c["field"] == "price_paise" for c in hist["items"][0]["changed_fields"])
    central = requests.get(f"{BASE}/audit-logs", params={"record": f["id"], "limit": 5}, headers=h, timeout=20).json()
    assert any(x["id"] == row["id"] for x in central["items"])
    csv = requests.get(f"{BASE}/audit-logs/export.csv", params={"record": f["id"]}, headers=h, timeout=20)
    assert csv.status_code == 200 and "price" in csv.text.lower()
    requests.patch(f"{BASE}/flats/{f['id']}", json={"version": f["version"] + 1, "price": f["price_paise"] / 100}, headers=h, timeout=20)


def test_no_sensitive_values_in_audit_log():
    bad = db.audit_logs.count_documents({"$or": [{"after.pan": {"$regex": "^[A-Z]{5}[0-9]{4}[A-Z]$"}}, {"before.pan": {"$regex": "^[A-Z]{5}[0-9]{4}[A-Z]$"}}, {"after.password_hash": {"$exists": True}}, {"after.aadhaar": {"$regex": "^[0-9]{12}$"}}]})
    assert bad == 0


def test_views_are_never_logged():
    assert db.audit_logs.count_documents({"action": {"$regex": "\\.(view|read|list|get)$"}}) == 0


def _audits(fn: ast.AST, helpers: set[str]) -> bool:
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            name = n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", "")
            if name == "write_audit" or name in helpers:
                return True
    return False


def test_every_mutation_route_writes_audit_or_is_exempt():
    """Static walk of every router: each POST/PATCH/PUT/DELETE handler must call write_audit (directly or via an auditing service helper) or be an exempt non-record route."""
    helpers = set()
    for p in (ROUTERS.parent / "services").glob("*.py"):
        tree = ast.parse(p.read_text())
        for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
            if _audits(fn, set()):
                helpers.add(fn.name)
    for _ in range(2):  # transitive: router-local helpers that call auditing helpers
        for p in ROUTERS.glob("*.py"):
            for fn in [n for n in ast.walk(ast.parse(p.read_text())) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
                if _audits(fn, helpers):
                    helpers.add(fn.name)
    missing = []
    for p in sorted(ROUTERS.glob("*.py")):
        if p.name in EXEMPT_FILES:
            continue
        for fn in [n for n in ast.walk(ast.parse(p.read_text())) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
            methods = [d.func.attr for d in fn.decorator_list if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("post", "patch", "put", "delete")]
            if not methods or fn.name in EXEMPT_ROUTES.get(p.name, set()):
                continue
            if not _audits(fn, helpers):
                missing.append(f"{p.name}:{fn.name}")
    assert not missing, missing
