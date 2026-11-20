"""Phase 1 F-6: demo chronology (REQ-36) and number safety (REQ-28) guards."""

import json
import re
from pathlib import Path

STORY_LOGIC_FILE = "/tmp/kkt_story_logic.json"

ROOT = Path(__file__).resolve().parents[1]


def _snapshot_result():
    with open(STORY_LOGIC_FILE) as fh:
        return json.load(fh)


def test_story_chronology_zero_problems():
    problems = _snapshot_result()["chronology"]
    assert not problems, problems[:10]


def test_no_code_path_deletes_or_resets_counters():
    bad = []
    for f in (
        list(ROOT.glob("routers/*.py"))
        + list(ROOT.glob("services/**/*.py"))
        + list(ROOT.glob("tools/*.py"))
        + [ROOT / "server.py"]
    ):
        for i, ln in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(
                r"counters\.(delete_many|delete_one|drop|replace_one)|counters\.update_\w+\([^)]*\"\$set\": \{\"seq\"",
                ln,
            ):
                bad.append(f"{f.relative_to(ROOT)}:{i}")
    assert not bad, bad
    src = (ROOT / "routers" / "admin.py").read_text(encoding="utf-8")
    assert re.search(r'keep = \{[^}]*"counters"', src), "full reseed wipe must keep the counters collection"


def test_story_sequences_have_no_gaps_inside_one_rebuild():
    assert not _snapshot_result()["gaps"]


def test_story_due_window_coverage_every_band_non_empty():
    """REQ-46/47, Q-11: Not due and every overdue band hold ₹ > 0 and ≥ 1 booking as of the story's own as-of date."""
    res = _snapshot_result()
    assert not res["bands"], (res["bands"], res["band_totals"])


def test_story_has_followups_due_on_the_as_of_day():
    """REQ-65 / JRN-33: the rebuilt story has follow-ups due on or before its as-of business day."""
    res = _snapshot_result()
    assert not res["followups"] and res["followups_count"] > 0, res


def test_followup_check_fails_when_none_due_on_a_db_copy():
    """REQ-66: a DB whose only follow-up is due tomorrow (IST) fails with 'follow-ups due today is empty'."""
    import os
    from datetime import datetime, time, timedelta

    from pymongo import MongoClient

    from services import clock
    from tools.story_logic_check import followups

    name = f"kkt_fucheck_{os.getpid()}_scratch"
    cli = MongoClient(os.environ["MONGO_URL"])
    db = cli[name]
    try:
        today = clock.today()
        tomorrow = datetime.combine(today + timedelta(days=1), time(0, 30), tzinfo=clock.business_tz())
        db.leads.insert_one({"status": "Contacted", "next_follow_up_at": clock.to_utc_iso(tomorrow)})
        assert followups(db, today.isoformat()) == (["follow-ups due today is empty"], 0)
        late = datetime.combine(today, time(23, 30), tzinfo=clock.business_tz())  # last half hour of the IST day
        db.leads.insert_one({"status": "Contacted", "next_follow_up_at": clock.to_utc_iso(late)})
        assert followups(db, today.isoformat()) == ([], 1)
    finally:
        cli.drop_database(name)


def test_story_has_a_next_billing_stage(base_url, admin_headers):
    """REQ-48: some tower's next pending stage shows bookings affected + expected bill ₹ in the real preview."""
    import requests

    res = _snapshot_result()
    assert not res["next_stage"], res["next_stage"]
    hits = []
    for s in res["next_stages"]:
        r = requests.get(
            f"{base_url}/api/blocks/{s['block_id']}/stages/{s['stage_id']}/preview", headers=admin_headers, timeout=30
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        if body["bookings_count"] and body["total_paise"] > 0:
            hits.append(s["tower"])
    assert hits, res["next_stages"]


def test_band_check_fails_with_band_is_empty_on_a_db_copy():
    """JRN-29: on a DB where every open bill is 90+ overdue, the check names each empty band."""
    import os
    from datetime import date, timedelta

    from pymongo import MongoClient

    from tools.story_logic_check import bands

    name = f"kkt_bandcheck_{os.getpid()}_scratch"
    cli = MongoClient(os.environ["MONGO_URL"])
    db = cli[name]
    try:
        db.bookings.insert_one(
            {
                "id": "b1",
                "status": "Active",
                "summary": {"account_due_paise": 100000},
                "other_charges": [],
            }
        )
        old = (date.today() - timedelta(days=200)).isoformat()
        db.demands.insert_one(
            {
                "booking_id": "b1",
                "due_date": old,
                "cash_demand_paise": 0,
                "account_demand_paise": 100000,
                "status": "Open",
            }
        )
        problems, totals = bands(db, date.today().isoformat())
        empty = {p.split(" is empty")[0] for p in problems}
        assert {"Not due", "0-30", "31-60", "61-90"} <= empty, problems
        assert all(" is empty" in p for p in problems)
    finally:
        cli.drop_database(name)
