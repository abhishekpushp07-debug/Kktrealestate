"""Nightly refresh runs at 03:00 IST: 'today' demo items must not be stamped in the future (10:30 IST)."""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from story_seed import cap_future  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))


def test_today_capped_at_run_time_before_1030():
    run = datetime(2026, 11, 17, 3, 0, tzinfo=IST)
    out = cap_future("2026-11-17", run)
    assert out.startswith("2026-11-17T03:00:00")
    assert datetime.fromisoformat(out) <= run


def test_past_days_and_after_1030_unchanged():
    assert cap_future("2026-11-16", datetime(2026, 11, 17, 3, 0, tzinfo=IST)) == "2026-11-16"
    assert cap_future("2026-11-17", datetime(2026, 11, 17, 11, 0, tzinfo=IST)) == "2026-11-17"
    assert (
        cap_future("2026-11-17T02:00:00+05:30", datetime(2026, 11, 17, 3, 0, tzinfo=IST)) == "2026-11-17T02:00:00+05:30"
    )


def test_full_timestamp_as_of_is_capped_too():
    """E: '2026-11-17T05:00:00+00:00' (10:30 IST) at a 03:00 IST run is stamped at the run time, not 7½ h ahead."""
    run = datetime(2026, 11, 17, 3, 0, tzinfo=IST)
    assert cap_future("2026-11-17T05:00:00+00:00", run) == run.isoformat()
    assert cap_future("2026-11-16T05:00:00+00:00", run) == "2026-11-16T05:00:00+00:00"
