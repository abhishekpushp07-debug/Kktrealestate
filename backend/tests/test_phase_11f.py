"""Phase 11F regression: catalogue-driven customer profile, project default split, cancel booking."""
import os, time, requests, pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN = {"email": "admin@kkt.in", "password": "Kkt@12345"}


@pytest.fixture(scope="session")
def H():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def cats(H):
    r = requests.get(f"{BASE}/api/catalogues", headers=H, timeout=20)
    assert r.status_code == 200
    return r.json()["types"]


def first(cats, t, parent=None):
    items = cats[t] if isinstance(cats[t], list) else cats[t].get("items", [])
    items = [i for i in items if parent is None or i.get("parent_id") == parent]
    assert items, f"no catalogue items for {t}"
    return items[0]


def test_customer_create_with_every_dropdown_persists(H, cats):
    loc = first(cats, "locality"); city = next(i for i in cats["city"] if i["id"] == loc["parent_id"]); st = next(i for i in cats["state"] if i["id"] == city["parent_id"])
    inc, occ, res, src = first(cats, "income_band"), first(cats, "occupation"), first(cats, "residency"), first(cats, "lead_source")
    seg = first(cats, "customer_segment"); bhk = first(cats, "bhk_preference"); fac = first(cats, "facing")
    ph = f"9{int(time.time()) % 10**9:09d}"
    # exactly what the UI sends: catalogue labels for legacy fields (not the old literals)
    body = {"salutation": first(cats, "salutation")["label"], "full_name": "QA Dropdown Test", "phone": ph, "email": f"qa.{ph}@kkt.in",
            "occupation": occ["label"], "annual_income_band": inc["label"], "source": src["label"],
            "address_current": {"line1": "1 Test Rd", "city": city["label"], "state": st["label"], "pincode": "800001"}}
    r = requests.post(f"{BASE}/api/customers", json=body, headers=H, timeout=20)
    assert r.status_code in (200, 201), r.text
    c = r.json()
    prof = {"version": c.get("version", 0), "residency_id": res["id"], "occupation_id": occ["id"], "income_band_id": inc["id"], "source_id": src["id"],
            "state_id": st["id"], "city_id": city["id"], "locality_id": loc["id"], "segment_ids": [seg["id"]],
            "preferences": {"bhk_ids": [bhk["id"]], "facing_ids": [fac["id"]]}, "consent": {"marketing": True, "whatsapp": True}}
    r = requests.patch(f"{BASE}/api/customers/{c['id']}/profile", json=prof, headers=H, timeout=20)
    assert r.status_code == 200, r.text
    g = requests.get(f"{BASE}/api/customers/{c['id']}", headers=H, timeout=20).json()
    for k in ("residency_id", "occupation_id", "income_band_id", "source_id", "state_id", "city_id", "locality_id"):
        assert g.get(k) == prof[k], (k, g.get(k))
    assert g["segment_ids"] == [seg["id"]] and g["preferences"]["bhk_ids"] == [bhk["id"]] and g["consent"]["whatsapp"] is True
    assert g["annual_income_band"] == inc["label"] and g["source"] == src["label"]
    # dependent filtering: locality belongs to the city, city to the state
    assert loc["parent_id"] == city["id"] and city["parent_id"] == st["id"]


def test_profile_rejects_unknown_catalogue_id(H, cats):
    c = requests.get(f"{BASE}/api/customers?page_size=1", headers=H, timeout=20).json()["items"][0]
    r = requests.patch(f"{BASE}/api/customers/{c['id']}/profile", json={"income_band_id": "nope"}, headers=H, timeout=20)
    assert r.status_code == 422


def test_project_default_cash_percent_seeded(H):
    ps = {p["code"]: p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=H, timeout=20).json()["items"]}
    assert ps["SGH"]["default_cash_percent"] == 60 and ps["GGV"]["default_cash_percent"] == 0


def test_cancel_booking_flow(H):
    bk = requests.get(f"{BASE}/api/bookings?status=Active&page_size=1", headers=H, timeout=20).json()["items"][0]
    b = requests.get(f"{BASE}/api/bookings/{bk['id']}", headers=H, timeout=20).json()
    r = requests.post(f"{BASE}/api/bookings/{b['id']}/cancel", json={"reason": "QA regression cancel", "refund": 0, "deduction": 0, "version": b["version"]}, headers=H, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Cancelled"
