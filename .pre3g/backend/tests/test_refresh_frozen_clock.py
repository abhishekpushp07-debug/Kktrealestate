"""Frozen-clock proof of the 03:00 IST nightly refresh: the loop wakes exactly at 03:00 business time and runs once."""

import asyncio
from datetime import datetime

import pytest

from routers import demo_refresh as dr
from services import clock


class _Stop(Exception):
    pass


def _frozen(at: datetime):
    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return at.astimezone(tz) if tz else at

    return Frozen


@pytest.mark.parametrize(
    ("frozen", "expected_sleep"),
    [
        (datetime(2026, 11, 17, 2, 59, 58, tzinfo=clock.IST), 2.0),  # 2 s before 03:00 IST → wakes at 03:00 tonight
        (datetime(2026, 11, 17, 3, 0, 1, tzinfo=clock.IST), 86399.0),  # just after → next night's 03:00
    ],
)
def test_nightly_loop_fires_at_3am_ist(monkeypatch, frozen, expected_sleep):
    calls, sleeps = [], []

    async def no_catch_up():
        return None

    async def none():
        return 0

    async def hosts():
        return ["preview.example"]

    async def fake_run(trigger, h):
        calls.append((trigger, h))

    async def fake_sleep(s):
        sleeps.append(s)
        if len(sleeps) > 1:
            raise _Stop

    monkeypatch.setattr(dr, "datetime", _frozen(frozen))
    monkeypatch.setattr(dr, "catch_up", no_catch_up)
    monkeypatch.setattr(dr, "mark_interrupted", none)
    monkeypatch.setattr(dr, "served_hosts", hosts)
    monkeypatch.setattr(dr, "run", fake_run)
    monkeypatch.setattr(dr.asyncio, "sleep", fake_sleep)
    with pytest.raises(_Stop):
        asyncio.run(dr.nightly_loop())
    assert sleeps[0] == pytest.approx(expected_sleep)
    assert calls == [("schedule", ["preview.example"])]  # one scheduled run per wake, through the guarded path
