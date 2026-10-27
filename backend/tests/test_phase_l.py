"""Phase L: load_test lineage tagging + guarded purge."""
import os
import sys
import uuid

import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def test_load_test_tagging_and_purge(admin_headers):
    H = {**admin_headers, "Idempotency-Key": str(uuid.uuid4())}
    before_projects = mongo.projects.count_documents({})
    lin0 = requests.get(f"{BASE}/api/admin/load-test/lineage", headers=admin_headers).json()
    tag = uuid.uuid4().hex[:5].upper()
    p = requests.post(f"{BASE}/api/projects", json={"name": f"LT test {tag}", "code": f"LT{tag}", "load_test": True, "address": {"line1": "x", "city": "Patna", "state": "Bihar", "pincode": "800001"}}, headers=H)
    assert p.status_code == 201 and p.json()["load_test"] is True, p.text
    bt = next(b for b in requests.get(f"{BASE}/api/master/block-types", params={"page_size": 50}, headers=admin_headers).json()["items"] if b["name"].lower().startswith("tower"))
    ft = requests.get(f"{BASE}/api/master/flat-types", params={"page_size": 50}, headers=admin_headers).json()["items"][0]
    b = requests.post(f"{BASE}/api/blocks", json={"project_id": p.json()["id"], "block_type_id": bt["id"], "name": "LT T", "code": "LT", "floors": 2, "flats_per_floor": 2, "numbering_pattern": "{block}-{floor}{pos2}",
                                                 "position_flat_types": [{"position": 1, "flat_type_id": ft["id"]}, {"position": 2, "flat_type_id": ft["id"]}]}, headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())})
    assert b.status_code == 201, b.text
    c = requests.post(f"{BASE}/api/customers", json={"full_name": "LT Cust", "phone": "+919000000001", "tags": ["load_test"]}, headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())})
    assert c.status_code == 201, c.text
    lin = requests.get(f"{BASE}/api/admin/load-test/lineage", headers=admin_headers).json()
    assert lin["projects"] == lin0["projects"] + 1 and lin["bids"] == lin0["bids"] + 1 and lin["customers"] >= 1 and lin["foreign_bookings"] == 0
    # a load-test customer owning a REAL booking → purge refused
    real = mongo.bookings.find_one({"status": "Active"}, {"id": 1, "customer_id": 1})
    mongo.bookings.update_one({"id": real["id"]}, {"$set": {"customer_id": c.json()["id"]}})
    try:
        r = requests.post(f"{BASE}/api/admin/load-test/purge", json={"confirm": "PURGE"}, headers=admin_headers)
        assert r.status_code == 409 and r.json()["code"] == "LINEAGE_CONFLICT"
    finally:
        mongo.bookings.update_one({"id": real["id"]}, {"$set": {"customer_id": real["customer_id"]}})
    assert requests.post(f"{BASE}/api/admin/load-test/purge", json={"confirm": "nope"}, headers=admin_headers).status_code == 400
    dry = requests.post(f"{BASE}/api/admin/load-test/purge", json={"confirm": "PURGE", "dry_run": True}, headers=admin_headers).json()
    assert dry["dry_run"] and dry["would_remove"]["projects"] == lin0["projects"] + 1 and dry["would_remove"]["flats"] >= 4
    r = requests.post(f"{BASE}/api/admin/load-test/purge", json={"confirm": "PURGE"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["removed"]["projects"] == lin0["projects"] + 1 and r.json()["removed"]["customers"] >= 1
    assert mongo.projects.count_documents({}) == before_projects - lin0["projects"]
    assert mongo.flats.count_documents({"project_id": p.json()["id"]}) == 0
    assert mongo.audit_logs.count_documents({"entity_id": p.json()["id"], "load_test": True}) >= 1
    assert requests.get(f"{BASE}/api/admin/load-test/lineage", headers=admin_headers).json()["projects"] == 0
    assert requests.get(f"{BASE}/api/admin/integrity-report", params={"fresh": 1}, headers=admin_headers).json()["ok"] is True
