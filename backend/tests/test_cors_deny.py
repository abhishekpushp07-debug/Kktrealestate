"""D0: ERP is same-origin — with CORS_ORIGINS unset/empty the API must not emit any Access-Control-* header."""
import os

import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def test_no_cors_headers_for_foreign_origin():
    if "localhost" not in BASE:
        import pytest
        pytest.skip("platform ingress adds its own CORS headers; app-level deny is asserted against the local backend")
    r = requests.get(f"{BASE}/api/health", headers={"Origin": "https://evil.example"}, timeout=10)
    assert r.status_code == 200
    assert not [h for h in r.headers if h.lower().startswith("access-control-")], dict(r.headers)
    p = requests.options(f"{BASE}/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}, timeout=10)
    assert "access-control-allow-origin" not in {k.lower() for k in p.headers}
