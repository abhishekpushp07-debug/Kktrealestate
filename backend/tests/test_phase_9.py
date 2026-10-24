"""Phase 9 — brochure lead gate + site visit scheduler."""
import os
import time
import uuid

import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
PWD = "Kkt@12345"
_TOK = {}


def tok(email="admin@kkt.in"):
    if email not in _TOK:
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PWD}, timeout=15)
        assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
        _TOK[email] = r.json()["access_token"]
    return {"Authorization": f"Bearer {_TOK[email]}"}


def phone():
    return "98" + str(int(time.time() * 1000))[-8:]


def test_brochure_gate_flow():
    ph = phone()
    body = {"project_slug": "shree-ganesh-heights", "name": "P9 Brochure", "phone": ph, "consent": True}
    r = requests.post(f"{BASE}/public/brochure-requests", json=body, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["new_lead"] is True and d["download_url"].startswith("/api/public/brochure/")
    dl = requests.get(f"{BASE.rsplit('/api', 1)[0]}{d['download_url']}", timeout=20)
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("application/pdf")
    assert "attachment" in dl.headers.get("content-disposition", "")
    assert dl.content[:4] == b"%PDF"
    # second request: same lead, extra activity
    r2 = requests.post(f"{BASE}/public/brochure-requests", json=body, timeout=15)
    assert r2.status_code == 200 and r2.json()["new_lead"] is False and r2.json()["reference"] == d["reference"]
    leads = requests.get(f"{BASE}/leads", headers=tok(), params={"search": ph, "page_size": 5}, timeout=15).json()["items"]
    assert len(leads) == 1 and leads[0]["source"] == "Brochure"
    lead = requests.get(f"{BASE}/leads/{leads[0]['id']}", headers=tok(), timeout=15).json()
    assert [a["type"] for a in lead["activities"]].count("brochure_downloaded") == 2
    # invalid phone
    assert requests.post(f"{BASE}/public/brochure-requests", json={**body, "phone": "12345"}, timeout=15).status_code == 422
    # honeypot → 200, no lead
    hp = phone()
    r3 = requests.post(f"{BASE}/public/brochure-requests", json={**body, "phone": hp, "website": "spam"}, timeout=15)
    assert r3.status_code == 200 and r3.json()["download_url"] is None
    assert requests.get(f"{BASE}/leads", headers=tok(), params={"search": hp}, timeout=15).json()["total"] == 0
    # forged token
    assert requests.get(f"{BASE}/public/brochure/eyJ0IjoiYnJvY2h1cmUifQ.000000000000000000000000", timeout=15).status_code == 404


def test_brochure_rate_limit():
    time.sleep(61)
    codes = [requests.post(f"{BASE}/public/brochure-requests", json={"project_slug": "shree-ganesh-heights", "name": "RL", "phone": phone(), "consent": True, "website": "x"}, timeout=15).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429, codes
    time.sleep(61)


def _first_slot(slug="shree-ganesh-heights"):
    av = requests.get(f"{BASE}/public/site-visits/availability", params={"project_slug": slug}, timeout=15).json()
    for d in av["days"]:
        if d["slots"]:
            return d["date"], d["slots"][-1]
    raise AssertionError("no slots")


def test_availability_from_param():
    import datetime as dt
    start = (dt.date.today() + dt.timedelta(days=5)).isoformat()
    av = requests.get(f"{BASE}/public/site-visits/availability", params={"project_slug": "shree-ganesh-heights", "from": start, "to": start}, timeout=15).json()
    assert [d["date"] for d in av["days"]] == [start]


def test_cancel_reverts_lead_stage():
    date, slot = _first_slot()
    r = requests.post(f"{BASE}/public/site-visits", json={"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": "P9 Revert", "phone": phone(), "visitors_count": 1, "consent": True}, timeout=15)
    assert r.status_code == 201, r.text
    v = r.json()
    H = tok()
    erp_v = requests.get(f"{BASE}/site-visits", headers=H, params={"search": v["visit_number"]}, timeout=15).json()["items"][0]
    assert requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()["status"] == "Site Visit Scheduled"
    assert requests.post(f"{BASE}/public/site-visits/{v['token']}/cancel", json={}, timeout=15).status_code == 200
    lead = requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()
    assert lead["status"] == "New" and any(a["type"] == "stage_reverted" for a in lead["activities"])


def test_availability_rules():
    av = requests.get(f"{BASE}/public/site-visits/availability", params={"project_slug": "ganesh-green-villas"}, timeout=15).json()
    assert av["project"]["enabled"] is True
    import datetime as dt
    for d in av["days"]:
        wd = dt.date.fromisoformat(d["date"]).weekday()
        if wd not in (5, 6):
            assert d["slots"] == [], d  # GGV: weekends only
        for s in d["slots"]:
            assert "10:00" <= s["start"] < "16:00" and s["available_count"] >= 1


def test_booking_capacity_ics_cancel_and_erp_outcome():
    date, slot = _first_slot()
    H = tok()
    # fill the slot to capacity, then one more → 409 SLOT_FULL
    ok = []
    for i in range(slot["available_count"]):
        r = requests.post(f"{BASE}/public/site-visits", json={"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": f"P9 Visitor {i}", "phone": phone(), "visitors_count": 1, "consent": True}, timeout=15)
        assert r.status_code == 201, r.text
        ok.append(r.json())
    r = requests.post(f"{BASE}/public/site-visits", json={"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": "Overflow", "phone": phone(), "visitors_count": 1, "consent": True}, timeout=15)
    assert r.status_code == 409 and r.json()["code"] == "SLOT_FULL", r.text
    v = ok[0]
    assert v["visit_number"].startswith("SV-") and v["ics_url"].endswith(".ics")
    ics = requests.get(f"{BASE.rsplit('/api', 1)[0]}{v['ics_url']}", timeout=15)
    assert ics.status_code == 200 and f"DTSTART;TZID=Asia/Kolkata:{date.replace('-', '')}T{slot['start'].replace(':', '')}00" in ics.text and "LOCATION:" in ics.text
    # ERP: visit visible, lead stage moved
    lst = requests.get(f"{BASE}/site-visits", headers=H, params={"search": v["visit_number"]}, timeout=15).json()
    assert lst["total"] == 1
    erp_v = lst["items"][0]
    lead = requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()
    assert lead["status"] == "Site Visit Scheduled" and lead["source"] == "Site Visit"
    assert any(a["type"] == "site_visit_booked" for a in lead["activities"])
    # notification for assignee
    if erp_v.get("assigned_to"):
        n = requests.get(f"{BASE}/notifications", headers=H, timeout=15)
        assert n.status_code == 200
    # visitor cancels via signed link
    c = requests.post(f"{BASE}/public/site-visits/{v['token']}/cancel", json={"reason": "plans changed"}, timeout=15)
    assert c.status_code == 200 and c.json()["status"] == "Cancelled"
    lead = requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()
    assert any(a["type"] == "site_visit_cancelled" for a in lead["activities"])
    # slot frees one seat; ERP reschedule of another visit into it respects capacity
    other = requests.get(f"{BASE}/site-visits", headers=H, params={"search": ok[1]["visit_number"]}, timeout=15).json()["items"][0]
    rs = requests.post(f"{BASE}/site-visits/{other['id']}/reschedule", headers=H, json={"date": date, "slot_start": slot["start"]}, timeout=15)
    assert rs.status_code == 200 and rs.json()["status"] == "Rescheduled"
    # complete → lead stage Site Visit Done
    done = requests.post(f"{BASE}/site-visits/{other['id']}/complete", headers=H, json={"note": "visited"}, timeout=15)
    assert done.status_code == 200 and done.json()["status"] == "Completed"
    lead2 = requests.get(f"{BASE}/leads/{other['lead_id']}", headers=H, timeout=15).json()
    assert lead2["status"] == "Site Visit Done"
    # today widget + export
    assert requests.get(f"{BASE}/site-visits/today", headers=H, timeout=15).status_code == 200
    ex = requests.get(f"{BASE}/site-visits/export", headers=H, timeout=15)
    assert ex.status_code == 200 and "visit_number" in ex.text
    # forged visit token
    assert requests.get(f"{BASE}/public/site-visits/abc.def", timeout=15).status_code == 404


def test_brochure_stats_and_portal_leak_free():
    s = requests.get(f"{BASE}/site-visits/brochure-stats", headers=tok(), timeout=15).json()
    assert len(s["series"]) == 30 and "brochure_leads_week" in s
    # visits endpoint requires permission
    assert requests.get(f"{BASE}/site-visits", timeout=15).status_code == 401
