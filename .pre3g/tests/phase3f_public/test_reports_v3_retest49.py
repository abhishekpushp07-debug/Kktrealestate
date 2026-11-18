"""Iteration 49 retest: 422 param validation, final status hint, shared views ownership."""
import datetime as dt
import pytest
import requests

B = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
URL = f"{B}/api/reports/v3/customer-status"


def tok(email):
    r = requests.post(f"{B}/api/auth/login", json={"email": email, "password": "Kkt@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def adm():
    return tok("admin@kkt.in")


# Param validation → 422
@pytest.mark.parametrize("q", [
    "page=abc", "page_size=x", "overdue_days=abc", "dues_min=abc", "dues_max=zz",
    "booked_from=nope", "booked_to=2026-13-45", "as_of=2099-01-01", "as_of=garbage",
])
def test_bad_params_422(adm, q):
    r = requests.get(f"{URL}?{q}", headers=adm)
    assert r.status_code == 422, (q, r.status_code, r.text[:200])


# Edge numbers that float() accepts but int() cannot
@pytest.mark.parametrize("q", ["page=inf", "page=nan", "page_size=1e400", "page=-5", "page_size=0"])
def test_edge_numbers_not_500(adm, q):
    r = requests.get(f"{URL}?{q}", headers=adm)
    assert r.status_code != 500, (q, r.text[:200])


@pytest.mark.parametrize("fmt", ["export.xlsx", "export.pdf"])
def test_export_bad_params_422(adm, fmt):
    r = requests.get(f"{URL}/{fmt}?page=abc", headers=adm)
    assert r.status_code == 422


def test_as_of_today_ok(adm):
    r = requests.get(f"{URL}?as_of={dt.date.today().isoformat()}", headers=adm)
    assert r.status_code in (200, 422)  # server tz IST may differ by a day
    assert r.status_code != 500


# Final status hint "· other charges"
def test_final_status_other_charges(adm):
    r = requests.get(f"{URL}?page_size=500", headers=adm)
    assert r.status_code == 200
    rows = r.json()["rows"]
    hinted = [x for x in rows if "other charges" in (x.get("final_status") or "")]
    print("hinted:", [(x.get("booking_no"), x["final_status"]) for x in hinted][:5])
    for x in rows:
        fs = x.get("final_status") or ""
        if ("Overdue" in fs or fs.startswith("Due")) and x.get("account_dues", 0) + x.get("cash_dues", 0) == 0:
            assert "other charges" in fs, x
    for x in hinted:
        assert x.get("account_dues", 0) + x.get("cash_dues", 0) == 0


# Shared view by accounts: admin sees it, cannot delete/patch
def test_shared_view_ownership(adm):
    acc = tok("accounts@kkt.in")
    r = requests.post(f"{B}/api/reports/presets", headers=acc,
                      json={"report_key": "customer-status", "name": "QA shared by accounts", "filters": {}, "shared": True})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    try:
        items = requests.get(f"{B}/api/reports/presets?report_key=customer-status", headers=adm).json()["items"]
        v = next(i for i in items if i["id"] == pid)
        assert v["created_by_name"]
        assert requests.delete(f"{B}/api/reports/presets/{pid}", headers=adm).status_code == 404
    finally:
        assert requests.delete(f"{B}/api/reports/presets/{pid}", headers=acc).status_code == 200
