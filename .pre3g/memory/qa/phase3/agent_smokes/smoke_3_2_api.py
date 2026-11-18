# Chunk 3-2 API smoke (read-only): masters usage/active, typed-value, catalogues usage. Run: python smoke_3_2_api.py
import os, requests, json
BASE = "https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"})
assert r.status_code == 200, r.text
tok = r.json().get("access_token") or r.json().get("token")
s.headers["Authorization"] = f"Bearer {tok}"
kinds = ["flat-types", "construction-stages", "charge-types", "parking-slot-types", "payment-modes", "bank-accounts",
         "document-types", "hold-reasons", "allocation-categories"]
for k in kinds:
    r = s.get(f"{BASE}/master/{k}", params={"page_size": 100, "include_usage": "true"})
    if r.status_code != 200:
        print("FAIL", k, r.status_code, r.text[:200]); continue
    items = r.json().get("items", r.json() if isinstance(r.json(), list) else [])
    miss = [i.get("name") for i in items if "usage_count" not in i]
    print(f"{k}: {len(items)} items, missing usage_count={len(miss)}, sample={[(i.get('name'), i.get('usage_count'), i.get('is_active')) for i in items[:3]]}")
for c in ["lead_source", "lost_reason", "bank"]:
    r = s.get(f"{BASE}/catalogues/{c}")
    d = r.json()
    items = d.get("items", d) if isinstance(d, dict) else d
    print(c, r.status_code, "items", len(items) if isinstance(items, list) else type(items),
          [(i.get("label"), i.get("usage_count")) for i in (items[:4] if isinstance(items, list) else [])])
    r = s.get(f"{BASE}/catalogues/{c}/typed-value", params={"value": "TEST_nothing_zz"})
    print("  typed-value", r.status_code, r.json())
r = s.get(f"{BASE}/catalogues/xyz/typed-value", params={"value": "a"}); print("bad list", r.status_code, r.json())
r = s.get(f"{BASE}/catalogues/lead_source/typed-value", params={"value": "   "}); print("blank", r.status_code, r.json())
# regex injection check
r = s.get(f"{BASE}/catalogues/lead_source/typed-value", params={"value": ".*"}); print("regex", r.status_code, r.json())
for t in ["floor-templates", "tower-templates", "stage-plan-templates", "payment-plan-templates"]:
    for path in [f"/templates/{t}", f"/master/{t}", f"/{t}"]:
        r = s.get(BASE + path)
        if r.status_code == 200:
            d = r.json(); items = d.get("items", d) if isinstance(d, dict) else d
            print(t, path, len(items), [(i.get("name"), i.get("usage_count"), i.get("is_active")) for i in items[:3]]); break
    else:
        print(t, "not found at guessed paths")
