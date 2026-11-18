"""JRN-100 / REQ-226: on a QA project, per-weekday slot hours + a holiday + a closed weekday are enforced the same
way on the public website (availability + booking) and in the ERP (availability + booking)."""

import random
import uuid
from datetime import date, timedelta

import requests

from tests.conftest import BASE
from tools.connection_matrix import Api, _today


def _phone():
    return f"+9198{random.randint(10_000_000, 99_999_999)}"


def test_weekday_slots_holiday_and_closed_day_enforced_on_website_and_erp(admin_headers):
    api = Api(BASE, admin_headers)
    tag = uuid.uuid4().hex[:5].upper()
    p = api.post(
        "/projects",
        {"name": f"QA Visits {tag}", "code": f"QV{tag}", "description": "QA visit hours", "address": {"city": "Patna"}},
    )
    today = date.fromisoformat(_today(api))
    d1, hol, closed = (today + timedelta(days=n) for n in (3, 4, 5))  # three different weekdays
    slug = f"qa-visits-{tag.lower()}"
    api.call(
        "PATCH",
        f"/cms/projects/{p['id']}/website",
        {
            "slug": slug,
            "is_published": True,
            "hero_images": ["https://example.com/qa.jpg"],
            "site_visits": {
                "enabled": True,
                "visit_days": [d for d in range(7) if d != closed.weekday()],
                "start_time": "10:00",
                "end_time": "18:00",
                "slot_minutes": 60,
                "capacity_per_slot": 3,
                "min_lead_hours": 0,
                "max_days_ahead": 30,
                "blackout_dates": [hol.isoformat()],
                "day_slots": {
                    str(d1.weekday()): {
                        "start_time": "11:00",
                        "end_time": "13:00",
                        "slot_minutes": 30,
                        "capacity_per_slot": 1,
                    }
                },
            },
        },
    )

    # website availability
    pub = requests.get(
        f"{BASE}/api/public/site-visits/availability",
        params={"project_slug": slug, "from": d1.isoformat(), "to": closed.isoformat()},
        timeout=30,
    ).json()
    days = {d["date"]: [s["start"] for s in d["slots"]] for d in pub["days"]}
    assert days[d1.isoformat()] == ["11:00", "11:30", "12:00", "12:30"], days  # weekday's own hours
    assert days.get(hol.isoformat(), []) == [] and days.get(closed.isoformat(), []) == [], days
    # ERP availability says the same
    erp = api.get("/site-visits/availability", project_id=p["id"], date_from=d1.isoformat(), date_to=closed.isoformat())
    assert {d["date"]: [s["start"] for s in d["slots"]] for d in erp["days"]} == days

    def web(d, s):
        return requests.post(
            f"{BASE}/api/public/site-visits",
            json={
                "project_slug": slug,
                "date": d.isoformat(),
                "slot_start": s,
                "name": "QA Visitor",
                "phone": _phone(),
                "consent": True,
            },
            timeout=30,
        )

    def erp_book(d, s):
        return requests.post(
            f"{BASE}/api/site-visits",
            json={
                "project_id": p["id"],
                "date": d.isoformat(),
                "slot_start": s,
                "name": "QA Visitor",
                "phone": _phone(),
            },
            headers=admin_headers,
            timeout=30,
        )

    # holiday, closed weekday and the project-default hour (overridden that weekday) are refused on both channels
    for d, s in ((hol, "10:00"), (closed, "10:00"), (d1, "10:00")):
        for r in (web(d, s), erp_book(d, s)):
            assert r.status_code == 409 and r.json()["code"] == "SLOT_UNAVAILABLE", (d, s, r.text)
    # the weekday's own slots book, and its own capacity (1) is enforced across channels
    assert erp_book(d1, "11:00").status_code == 201
    r = web(d1, "11:00")
    assert r.status_code == 409 and r.json()["code"] == "SLOT_FULL", r.text
    assert web(d1, "11:30").status_code == 201
