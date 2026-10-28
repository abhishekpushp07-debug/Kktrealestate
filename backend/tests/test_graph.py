"""Phase X.4 — graph endpoint: shape, batching sanity, Sales masking (no real status / booking_id via graph), 403 for zero-access."""
import os

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email, pw_env="ADMIN_PASSWORD"):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ.get(pw_env) or "Kkt@12345"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def _sgh(H):
    return next(p for p in requests.get(f"{BASE}/api/projects?page_size=50", headers=H, timeout=30).json()["items"] if p.get("code") == "SGH")["id"]


def test_graph_project_booking_customer_shapes():
    H = _hdr("admin@kkt.in")
    pid = _sgh(H)
    g = requests.get(f"{BASE}/api/graph/project/{pid}", headers=H, timeout=60)
    assert g.status_code == 200
    s = g.json()["sections"]
    assert {"towers", "flats", "bookings", "demands", "payments", "payment_plans", "stage_plans", "documents"} <= set(s)
    assert s["flats"]["total"] >= s["flats"]["total"] and len(s["flats"]["items"]) <= 25 and s["flats"]["truncated"] == (s["flats"]["total"] > len(s["flats"]["items"]))
    b = s["bookings"]["items"][0]
    gb = requests.get(f"{BASE}/api/graph/booking/{b['id']}", headers=H, timeout=60).json()
    assert {"customer", "project", "tower", "flat", "demands", "payments"} <= set(gb["sections"])
    assert gb["sections"]["flat"]["items"][0]["to"].startswith("/blocks/") and "?flat=" in gb["sections"]["flat"]["items"][0]["to"]
    cust = gb["sections"]["customer"]["items"][0]
    gc = requests.get(f"{BASE}/api/graph/customer/{cust['id']}", headers=H, timeout=60).json()
    assert any(i["id"] == b["id"] for i in gc["sections"]["bookings"]["items"])
    assert requests.get(f"{BASE}/api/graph/tower/{gb['sections']['tower']['items'][0]['id']}", headers=H, timeout=60).status_code == 200


def test_graph_masks_for_sales_and_hides_privileged_sections():
    A = _hdr("admin@kkt.in")
    pid = _sgh(A)
    S = _hdr("sales@kkt.in", "SALES_PASSWORD")
    gp = requests.get(f"{BASE}/api/graph/project/{pid}", headers=S, timeout=60)
    assert gp.status_code == 200
    sec = gp.json()["sections"]
    assert sec["flats"]["masked"] is True
    for it in sec["flats"]["items"]:
        assert set(it) == {"kind", "id", "label", "status", "to"}  # no booking_id / inventory_state / display_override
    booked = next(f for f in requests.get(f"{BASE}/api/flats?project_id={pid}&status=Booked&page_size=1", headers=A, timeout=30).json()["items"])
    gf = requests.get(f"{BASE}/api/graph/flat/{booked['id']}", headers=S, timeout=60)
    assert gf.status_code == 200
    fs = gf.json()
    assert "bookings" not in fs["sections"] and "demands" not in fs["sections"] and "payments" not in fs["sections"]
    assert fs["entity"]["status"] in ("Sold", "Available", "Hold")  # display layer, never the real "Booked"
    assert "booking_id" not in fs["entity"]


def test_graph_zero_access_403_and_unknown_entity_422():
    E = _hdr("employee@kkt.in", "EMPLOYEE_PASSWORD")
    pid = _sgh(_hdr("admin@kkt.in"))
    assert requests.get(f"{BASE}/api/graph/project/{pid}", headers=E, timeout=30).status_code == 403
    assert requests.get(f"{BASE}/api/graph/widget/{pid}", headers=_hdr("admin@kkt.in"), timeout=30).status_code == 422
