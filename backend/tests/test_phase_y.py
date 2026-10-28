"""Phase Y — tower sales chart masking + booking-wizard co-applicants (linked, on allotment letter, idempotent retry)."""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ["TEST_PASSWORD"]}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def _sgh(H):
    return next(p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=H, timeout=30).json()["items"] if p.get("code") == "SGH")["id"]


def test_tower_sales_real_vs_display_masking():
    A = _hdr("admin@kkt.in")
    pid = _sgh(A)
    real = requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": "real"}, headers=A, timeout=60).json()
    assert real["view"] == "real" and real["can_toggle"] is True and set(real["categories"]) == {"sold", "available", "hold", "landowner", "blocked"}
    for t in real["towers"]:
        assert t["total"] == sum(t[c] for c in real["categories"])
    assert real["total"]["total"] == sum(t["total"] for t in real["towers"])
    S = _hdr("sales@kkt.in")
    disp = requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": "real"}, headers=S, timeout=60).json()
    assert disp["view"] == "display" and disp["can_toggle"] is False
    assert set(disp["categories"]) == {"sold", "available", "hold"}
    for t in disp["towers"]:
        assert "landowner" not in t and "blocked" not in t and t["total"] == t["sold"] + t["available"] + t["hold"]
    assert requests.get(f"{BASE}/api/projects/{pid}/tower-sales", headers=_hdr("employee@kkt.in"), timeout=30).status_code == 403
    admin_disp = requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": "display"}, headers=A, timeout=60).json()
    strip = lambda d: {k: v for k, v in d.items() if k != "can_toggle"}  # noqa: E731
    assert strip(admin_disp) == strip(disp), "admin view=display must be byte-for-byte the Sales payload"


def test_wizard_co_applicants_linked_on_letter_and_idempotent():
    A = _hdr("admin@kkt.in")
    pid = _sgh(A)
    sold_blocks = {t["block_id"] for t in requests.get(f"{BASE}/api/projects/{pid}/tower-sales", params={"view": "real"}, headers=A, timeout=60).json()["towers"] if t["sold"] > 0}
    flats = requests.get(f"{BASE}/api/flats?project_id={pid}&status=Available&page_size=200", headers=A, timeout=30).json()["items"]
    flat = next(f for f in flats if f.get("bookable") is not False and f["block_id"] in sold_blocks)  # a tower that already sells → no side effects on setup/plan tests
    tag = uuid.uuid4().hex[:6]
    cust = requests.post(f"{BASE}/api/customers", json={"full_name": f"Y2 Buyer {tag}", "phone": f"9{tag.encode().hex()[:9]}"}, headers=A, timeout=30)
    assert cust.status_code == 201, cust.text
    cid = cust.json()["id"]
    plans = requests.get(f"{BASE}/api/projects/{pid}/blocks/{flat['block_id']}/payment-plans", headers=A, timeout=30).json()["items"]
    body = {"flat_id": flat["id"], "customer_id": cid, "booking_date": "2026-10-28", "agreement_value": 2500000, "cash_agreed": 500000, "account_agreed": 2000000,
            "payment_plan_id": plans[0]["id"] if plans else None, "co_applicants": [{"name": f"Co One {tag}", "relation": "Spouse", "phone": "9876500001"}, {"name": f"Co Two {tag}", "relation": "Father"}]}
    key = str(uuid.uuid4())
    r1 = requests.post(f"{BASE}/api/bookings", json=body, headers={**A, "Idempotency-Key": key}, timeout=60)
    assert r1.status_code == 201, r1.text
    bid = r1.json()["id"]
    c360 = requests.get(f"{BASE}/api/customers/{cid}", headers=A, timeout=30).json()
    names = [c["name"] for c in c360["co_applicants"]]
    assert names == [f"Co One {tag}", f"Co Two {tag}"]
    det = requests.get(f"{BASE}/api/bookings/{bid}", headers=A, timeout=30).json()
    assert [c["name"] for c in det["customer"]["co_applicants"]] == names
    pdf = requests.get(f"{BASE}/api/bookings/{bid}/allotment.pdf", headers=A, timeout=120)
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
    from pypdf import PdfReader
    import io
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    assert f"Co One {tag}" in text and f"Co Two {tag}" in text
    # retry with the same idempotency key → replay, still exactly 2
    r2 = requests.post(f"{BASE}/api/bookings", json=body, headers={**A, "Idempotency-Key": key}, timeout=60)
    assert r2.status_code in (200, 201) and r2.json()["id"] == bid
    assert len(requests.get(f"{BASE}/api/customers/{cid}", headers=A, timeout=30).json()["co_applicants"]) == 2
    g = requests.get(f"{BASE}/api/graph/customer/{cid}", headers=A, timeout=30).json()
    assert g["sections"]["bookings"]["total"] == 1
    requests.post(f"{BASE}/api/bookings/{bid}/cancel", json={"reason": "Y.2 test artefact", "deduction": 0, "refund": 0}, headers={**A, "Idempotency-Key": str(uuid.uuid4())}, timeout=60)
