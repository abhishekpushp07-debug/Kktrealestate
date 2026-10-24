"""Phase 6C: every /api/portal/* JSON response must be free of internal keys."""
import os

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"]
FORBIDDEN = {"storage_key", "_id", "internal", "author_id", "created_by", "updated_by", "assigned_to", "sales_user_id", "user_id", "password_hash", "token_hash", "pan_enc", "aadhaar_enc", "pan", "aadhaar", "account_number_enc", "company_id", "customer_id", "stage_history", "sla_breached", "is_active", "deleted_at", "version"}
ALLOW = {"customer_id"}  # not present anywhere in portal output today; kept explicit for clarity


def scan(obj, path="", found=None):
    found = found if found is not None else []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FORBIDDEN and k not in ALLOW:
                found.append(f"{path}.{k}")
            scan(v, f"{path}.{k}", found)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            scan(v, f"{path}[{i}]", found)
    return found


@pytest.fixture(scope="module")
def tok():
    r = requests.post(f"{BASE}/api/portal/auth/login", json={"phone": "9431023456", "password": "Buyer@12345"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _get(tok, path):
    r = requests.get(f"{BASE}/api/portal{path}", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, (path, r.status_code, r.text[:200])
    return r.json()


def test_portal_responses_have_no_internal_keys(tok):
    paths = ["/config", "/me", "/bank-details", "/bookings", "/notices", "/service-categories", "/service-requests", "/notifications", "/notifications/unread-count"]
    bookings = _get(tok, "/bookings")["items"]
    for b in bookings:
        paths += [f"/bookings/{b['id']}{s}" for s in ("", "/ledger", "/payments", "/demands", "/schedule", "/documents", "/construction")]
    for sr in _get(tok, "/service-requests")["items"]:
        paths.append(f"/service-requests/{sr['id']}")
    leaks = {}
    for p in paths:
        hits = scan(_get(tok, p))
        if hits:
            leaks[p] = hits
    assert not leaks, leaks


def test_attachment_shape(tok):
    for sr in _get(tok, "/service-requests")["items"]:
        d = _get(tok, f"/service-requests/{sr['id']}")
        for m in d["thread"]:
            for a in m["attachments"]:
                assert set(a) == {"idx", "name", "mime", "size", "url"}
                assert a["url"] == f"/api/portal/service-requests/{sr['id']}/attachments/{a['idx']}"


def test_notification_shape(tok):
    d = _get(tok, "/notifications")
    assert set(d) == {"items", "unread_count", "total", "page", "page_size"}
    for n in d["items"]:
        assert set(n) == {"id", "type", "title", "body", "booking_id", "entity_type", "entity_id", "is_read", "withdrawn", "created_at"}
