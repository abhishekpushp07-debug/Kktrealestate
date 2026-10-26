"""Phase C: public website + customer portal APIs are parked behind PUBLIC_SURFACES_ENABLED (default false)."""
import os

import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
TOK = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")


def _plain(path):
    # explicit header so the conftest test-token is not attached: the request looks like real public traffic
    return requests.get(f"{BASE}{path}", headers={"X-Rate-Limit-Bypass": "not-the-token"}, timeout=15)


def test_public_and_portal_are_404_envelopes_when_parked():
    for p in ("/api/public/projects", "/api/portal/config", "/api/public/site-visits/availability?project_slug=x"):
        r = _plain(p)
        assert r.status_code == 404, (p, r.status_code, r.text[:200])
        body = r.json()
        assert body["error"]["code"] == "NOT_FOUND" and body["error"]["request_id"] and body["code"] == "NOT_FOUND", body


def test_public_and_portal_answer_when_surfaces_enabled_for_test_process():
    os.environ["PUBLIC_SURFACES_ENABLED"] = "true"  # the backend sees the same effect through the process-env test token header
    h = {"X-Rate-Limit-Bypass": TOK}
    assert requests.get(f"{BASE}/api/public/projects", headers=h, timeout=15).status_code == 200
    assert requests.get(f"{BASE}/api/portal/config", headers=h, timeout=15).status_code == 200


def test_bootstrap_reports_surfaces(admin_headers):
    r = requests.get(f"{BASE}/api/bootstrap", headers=admin_headers, timeout=15).json()
    assert set(r["surfaces"]) == {"public_website", "customer_portal"}
    assert r["company"]["name"] == "KKT Constructions" and r["company"]["tagline"]
