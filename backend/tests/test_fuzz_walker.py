"""Fuzz walker: every POST/PATCH/PUT route from the OpenAPI spec receives hostile payloads and must answer 4xx — never 5xx."""
import requests

PAYLOADS = [
    {},
    "not-json-object",
    {"amount": -1, "amount_paise": -10**12, "percent": 10**9, "name": "x" * 10000, "phone": "x" * 10000, "unknown_field_zz": 1, "id": "../../etc/passwd", "version": "abc"},
    {"amount_paise": 1.5, "cash_agreed_paise": "1e9", "booking_date": "not-a-date", "email": 12345, "items": [None, 1, "x"]},
]


def _fill_path(path: str) -> str:
    out = path
    while "{" in out:
        a = out.index("{"); b = out.index("}", a)
        out = out[:a] + "00000000-0000-0000-0000-000000000000" + out[b + 1:]
    return out


def test_write_routes_never_500(base_url, admin_headers):
    spec = requests.get(f"{base_url}/api/openapi.json", headers=admin_headers).json()
    failures = []
    walked = 0
    for path, methods in spec["paths"].items():
        for method in methods:
            if method.upper() not in ("POST", "PATCH", "PUT"):
                continue
            if "/auth/login" in path or "/admin/reseed" in path or "/admin/backup" in path or "/docs/regenerate" in path or "/admin/integrity/repair" in path:
                continue  # destructive / rate-limited by design
            url = base_url + _fill_path(path)
            for body in PAYLOADS:
                walked += 1
                headers = {**admin_headers, "Idempotency-Key": f"fuzz-{abs(hash((path, method, str(body))))}"}
                r = requests.request(method.upper(), url, json=body, headers=headers, timeout=20) if body != "not-json-object" else requests.request(method.upper(), url, data=body, headers={**headers, "Content-Type": "application/json"}, timeout=20)
                if r.status_code >= 500:
                    failures.append((method.upper(), path, body if not isinstance(body, dict) else list(body)[:2], r.status_code, r.text[:120]))
                    break
    assert walked > 200, walked
    assert not failures, "\n".join(map(str, failures))


def test_error_envelope_uniform(base_url, admin_headers):
    cases = [
        requests.get(f"{base_url}/api/bookings/00000000-0000-0000-0000-000000000000", headers=admin_headers),       # 404
        requests.post(f"{base_url}/api/customers", json={"full_name": 1}, headers=admin_headers),                  # 422
        requests.get(f"{base_url}/api/bookings"),                                                                  # 401
        requests.post(f"{base_url}/api/payments", json={}, headers=admin_headers),                                 # 400 idempotency / 422
    ]
    for r in cases:
        assert 400 <= r.status_code < 500, (r.status_code, r.text)
        j = r.json()
        assert set(j["error"]) >= {"code", "message", "details", "request_id"}, j
        assert j["error"]["code"] == j["code"] and j["error"]["message"] == j["detail"], j
