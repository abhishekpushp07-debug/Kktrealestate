"""Audit retention: old rows move to audit_logs_archive (never deleted), archive is read-only and searchable via include_archive."""
import os
import uuid
from datetime import timedelta, date

import pytest
import requests
from pymongo import MongoClient

from tests.conftest import BASE

API = f"{BASE}/api"


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_archive_moves_only_rows_older_than_retention(admin, mongo):
    st = requests.get(f"{API}/admin/audit/archive/status", headers=admin, timeout=20).json()
    assert st["retention_months"] == 24
    old_id, new_id = f"arch-old-{uuid.uuid4().hex[:8]}", f"arch-new-{uuid.uuid4().hex[:8]}"
    cid = mongo.companies.find_one({}, {"id": 1})["id"]
    old_at = (date.today() - timedelta(days=30 * 30)).isoformat() + "T10:00:00+00:00"
    base = {"company_id": cid, "actor_id": "t", "actor_name": "test", "action": "flat.update", "entity_type": "flat", "before": None, "after": {"x": 1}, "changed_fields": [], "ip": None}
    mongo.audit_logs.insert_many([{**base, "id": old_id, "entity_id": "e-old", "created_at": old_at}, {**base, "id": new_id, "entity_id": "e-new", "created_at": date.today().isoformat() + "T10:00:00+00:00"}])
    hot_before = mongo.audit_logs.count_documents({})
    res = requests.post(f"{API}/admin/audit/archive", headers=admin, timeout=60).json()
    assert res["moved"] >= 1
    assert mongo.audit_logs.find_one({"id": old_id}) is None and mongo.audit_logs.find_one({"id": new_id}) is not None
    arch = mongo.audit_logs_archive.find_one({"id": old_id})
    assert arch and arch["after"] == {"x": 1} and arch["archived_at"]
    assert mongo.audit_logs.count_documents({}) + res["moved"] == hot_before + 1  # +1: the archive run itself is audited; nothing is deleted
    # archive is searchable through the central page toggle, hot default excludes it
    hot = requests.get(f"{API}/audit", headers=admin, params={"entity_type": "flat", "entity_id": "e-old"}, timeout=20).json()
    assert all(i["id"] != old_id for i in hot["items"])
    ar = requests.get(f"{API}/audit", headers=admin, params={"entity_type": "flat", "entity_id": "e-old", "include_archive": "true"}, timeout=20).json()
    assert any(i["id"] == old_id for i in ar["items"])
    hist = requests.get(f"{API}/audit/entity/flat/e-old", headers=admin, params={"include_archive": "true"}, timeout=20).json()
    assert any(i["id"] == old_id for i in hist["items"])


def test_archive_is_idempotent_and_indexed(admin, mongo):
    before = mongo.audit_logs_archive.count_documents({})
    res = requests.post(f"{API}/admin/audit/archive", headers=admin, timeout=60).json()
    assert res["moved"] == 0 and mongo.audit_logs_archive.count_documents({}) == before
    idx = {tuple(k for k, _ in v["key"]) for v in mongo.audit_logs_archive.index_information().values()}
    assert ("company_id", "created_at") in idx and ("entity_type", "entity_id", "created_at") in idx


def test_retention_is_configurable(admin):
    c = requests.get(f"{API}/settings/company", headers=admin, timeout=20).json()
    r = requests.patch(f"{API}/settings/company", headers=admin, json={"audit_retention_months": 36, "version": c["version"]}, timeout=20)
    assert r.status_code == 200, r.text
    assert requests.get(f"{API}/admin/audit/archive/status", headers=admin, timeout=20).json()["retention_months"] == 36
    c = requests.get(f"{API}/settings/company", headers=admin, timeout=20).json()
    requests.patch(f"{API}/settings/company", headers=admin, json={"audit_retention_months": 24, "version": c["version"]}, timeout=20)


def test_archive_has_no_delete_route():
    r = requests.get(f"{API}/openapi.json", timeout=20).json()
    assert not [p for p, ops in r["paths"].items() if "archive" in p and "delete" in ops]
