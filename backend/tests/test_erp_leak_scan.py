"""ERP leak scan: core-entity GET routes must never expose secrets/internal fields (hashes, encrypted blobs, storage keys, tokens)."""
import requests

FORBIDDEN = {"password_hash", "password", "token_hash", "refresh_token", "mfa_secret", "mfa_recovery_codes", "storage_key", "_id", "secret", "api_key", "encrypted_aadhaar", "encrypted_pan", "aadhaar_encrypted", "pan_encrypted", "otp", "signed_key"}
ROUTES = ["/api/projects", "/api/blocks", "/api/flats", "/api/customers", "/api/bookings", "/api/payments", "/api/demands", "/api/users", "/api/catalogues", "/api/leads", "/api/site-visits", "/api/service-requests", "/api/auth/me", "/api/bootstrap"]


def _walk(o, trail, hits):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in FORBIDDEN or k.startswith("encrypted_") or k.endswith("_hash") or k.endswith("_secret"):
                hits.append(trail + "." + k)
            _walk(v, trail + "." + k, hits)
    elif isinstance(o, list):
        for v in o[:30]:
            _walk(v, trail, hits)


def test_erp_core_routes_do_not_leak_internal_fields(base_url, admin_headers):
    hits = []
    for r in ROUTES:
        resp = requests.get(base_url + r, headers=admin_headers, params={"page_size": 20})
        if resp.status_code == 404:
            continue
        assert resp.status_code == 200, (r, resp.status_code)
        _walk(resp.json(), r, hits)
        body = resp.json()
        items = body.get("items") if isinstance(body, dict) else None
        if items:
            d = requests.get(f"{base_url}{r}/{items[0]['id']}", headers=admin_headers)
            if d.status_code == 200:
                _walk(d.json(), r + "/{id}", hits)
    assert not hits, hits
