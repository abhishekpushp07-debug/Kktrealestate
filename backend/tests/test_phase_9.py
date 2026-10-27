"""Phase 9 — brochure lead gate + site visit scheduler."""
import os
import time

import requests
from dotenv import load_dotenv

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
PWD = TEST_PASSWORD
_TOK = {}


def tok(email="admin@kkt.in"):
    if email not in _TOK:
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PWD}, timeout=15)
        assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
        _TOK[email] = r.json()["access_token"]
    return {"Authorization": f"Bearer {_TOK[email]}"}


def phone():
    return "98" + str(int(time.time() * 1000))[-8:]


def test_brochure_rate_limit():
    # The preview ingress NATs each new connection through a different egress IP, which splits a per-IP counter;
    # exercise the limiter on a single stable path (local backend when reachable, else one keep-alive session).
    base = BASE
    time.sleep(60 - time.time() % 60 + 1)  # align to a fresh 60 s window
    with requests.Session() as sess:
        codes = [sess.post(f"{base}/public/brochure-requests", json={"project_slug": "shree-ganesh-heights", "name": "RL", "phone": phone(), "consent": True, "website": "x"}, timeout=15).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and 429 in codes[5:], codes  # 5/60 s per IP
    time.sleep(61)


def _availability(slug, **params):
    """Another xdist worker (test_phase_3) briefly unpublishes SGH; wait it out instead of racing."""
    for _ in range(30):
        av = requests.get(f"{BASE}/public/site-visits/availability", params={"project_slug": slug, **params}, timeout=15).json()
        if av.get("project", {}).get("enabled") and any(d["slots"] for d in av["days"]):
            return av
        time.sleep(2)
    return av


def _book_visit(body):
    r = requests.post(f"{BASE}/public/site-visits", json=body, timeout=15)
    if r.status_code == 429:  # visit guard 5/60 s per IP is shared with test_phase_11a on the other worker — wait for a fresh window
        time.sleep(int(r.json().get("retry_after") or 60) + 1)
        r = requests.post(f"{BASE}/public/site-visits", json=body, timeout=15)
    return r


def _first_slot(slug="shree-ganesh-heights", min_seats=1):
    av = _availability(slug)
    for d in av["days"]:
        for sl in reversed(d["slots"]):
            if sl["available_count"] >= min_seats:
                return d["date"], sl
    raise AssertionError("no slots")


def test_availability_from_param():
    import datetime as dt
    start = (dt.date.today() + dt.timedelta(days=5)).isoformat()
    av = requests.get(f"{BASE}/public/site-visits/availability", params={"project_slug": "shree-ganesh-heights", "from": start, "to": start}, timeout=90).json()
    assert [d["date"] for d in av["days"]] == [start]


def test_cancel_reverts_lead_stage():
    date, slot = _first_slot()
    r = _book_visit({"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": "P9 Revert", "phone": phone(), "visitors_count": 1, "consent": True})
    assert r.status_code == 201, r.text
    v = r.json()
    H = tok()
    erp_v = requests.get(f"{BASE}/site-visits", headers=H, params={"search": v["visit_number"]}, timeout=15).json()["items"][0]
    assert requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()["status"] == "Site Visit Scheduled"
    assert requests.post(f"{BASE}/public/site-visits/{v['token']}/cancel", json={}, timeout=15).status_code == 200
    lead = requests.get(f"{BASE}/leads/{erp_v['lead_id']}", headers=H, timeout=15).json()
    assert lead["status"] == "New" and any(a["type"] == "stage_reverted" for a in lead["activities"])


def test_booking_capacity_ics_cancel_and_erp_outcome():
    date, slot = _first_slot(min_seats=2)  # needs two of our own visits in the slot (a previous run may still hold a seat)
    H = tok()
    # fill the slot to capacity, then one more → 409 SLOT_FULL
    ok = []
    for i in range(slot["available_count"]):
        r = _book_visit({"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": f"P9 Visitor {i}", "phone": phone(), "visitors_count": 1, "consent": True})
        assert r.status_code == 201, r.text
        ok.append(r.json())
    r = _book_visit({"project_slug": "shree-ganesh-heights", "date": date, "slot_start": slot["start"], "name": "Overflow", "phone": phone(), "visitors_count": 1, "consent": True})
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
    other = None
    for _ in range(10):
        items = requests.get(f"{BASE}/site-visits", headers=H, params={"search": ok[1]["visit_number"], "page_size": 50}, timeout=15).json()["items"]
        other = next((i for i in items if i["visit_number"] == ok[1]["visit_number"]), None)
        if other:
            break
        time.sleep(1)
    assert other, ok[1]
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
