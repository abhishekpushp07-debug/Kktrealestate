"""REQ-148 gate: the owner's story through the real screens on the private test copy; log → memory/qa/phase3/clickthrough.md."""

import os

from story import run


def test_owner_story_clicks_through():
    log = run(
        os.environ["KKT_E2E_BASE"],
        os.environ.get("TEST_PASSWORD") or os.environ["DEMO_PASSWORD"],
    )
    assert len(log) == 14 and all(r[2] == "PASS" for r in log), log
