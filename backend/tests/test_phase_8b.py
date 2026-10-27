"""Phase 8B backend sanity tests: public API, pagination guard, milestones legacy next_seq."""
import os

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-realty-hub-2.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


def test_health():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200, r.text


def test_public_home():
    r = requests.get(f"{BASE_URL}/api/public/home")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)


def test_flats_page_size_too_large_returns_422(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/api/flats?page_size=500", headers=h)
    assert r.status_code == 422, f"got {r.status_code}: {r.text[:200]}"


def test_milestones_legacy_has_next_seq(admin_token):
    # need a block id first
    h = {"Authorization": f"Bearer {admin_token}"}
    blocks = requests.get(f"{BASE_URL}/api/blocks", headers=h)
    assert blocks.status_code == 200, blocks.text
    items = blocks.json().get("items") or blocks.json()
    assert len(items) > 0
    block_id = items[0]["id"]
    r = requests.get(f"{BASE_URL}/api/blocks/{block_id}/milestones", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "next_seq" in body, f"next_seq missing from legacy response keys={list(body.keys())}"
    assert isinstance(body["next_seq"], int)
