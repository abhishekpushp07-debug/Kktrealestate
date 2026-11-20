"""F-44 nightly demo refresh guards (REQ-52/53, Q-10): never on production / without the flag, never on top of a rebuild."""

import fcntl
import os

import pytest
import requests

from routers import demo_refresh as dr

PREVIEW = "kkt-homes-1--6y56mq2x.preview.emergentagent.com"


def test_guard_flag_absent_is_disabled(monkeypatch):
    monkeypatch.delenv("DEMO_AUTO_REFRESH", raising=False)
    assert dr.guard([PREVIEW]).startswith("disabled:")
    monkeypatch.setenv("DEMO_AUTO_REFRESH", "false")
    assert dr.guard([PREVIEW]).startswith("disabled:")


def test_guard_production_host_is_disabled_even_with_flag(monkeypatch):
    monkeypatch.setenv("DEMO_AUTO_REFRESH", "true")
    assert dr.guard(["billpe.com"]) == "disabled: billpe.com is not a demo host"
    assert dr.guard([PREVIEW, "billpe.com"]) == "disabled: billpe.com is not a demo host"
    assert dr.guard(["kkt.emergent.host"]).startswith("disabled:")
    assert dr.guard([]).startswith("disabled:")


def test_guard_preview_with_flag_is_allowed(monkeypatch):
    monkeypatch.setenv("DEMO_AUTO_REFRESH", "true")
    assert dr.guard([PREVIEW]) is None
    assert dr.guard([PREVIEW, "localhost"]) is None


@pytest.mark.load_sensitive  # holds the cross-process reseed lock for a moment
def test_busy_skips_while_a_reseed_or_snapshot_runs():
    for path, why in (
        (dr.RESEED_LOCK, "skipped: reseed running"),
        (dr.SNAPSHOT_LOCK, "skipped: test snapshot running"),
    ):
        with open(path, "a+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                assert dr.busy() == why
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)


def test_run_now_on_production_host_is_disabled_and_changes_nothing(base_url, admin_headers):
    from pymongo import MongoClient

    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]  # the snapshot DB of the private backend

    def counts():
        return {c: db[c].count_documents({}) for c in ("bookings", "payments", "demands", "flats")}

    before = counts()
    r = requests.post(
        f"{base_url}/api/admin/demo-refresh/run", json={"check_host": "billpe.com"}, headers=admin_headers, timeout=30
    )
    assert r.status_code == 200, r.text[:300]
    assert r.json()["outcome"].startswith("disabled:"), r.json()
    st = requests.get(f"{base_url}/api/admin/demo-refresh", headers=admin_headers, timeout=30).json()
    assert st["last"]["outcome"] == r.json()["outcome"] and not st["running"]
    assert counts() == before


def test_run_now_needs_its_permission(base_url):
    from tests.conftest import session_token

    tok = session_token("accounts@kkt.in", os.environ["TEST_PASSWORD"])
    r = requests.post(
        f"{base_url}/api/admin/demo-refresh/run", json={}, headers={"Authorization": f"Bearer {tok}"}, timeout=30
    )
    assert r.status_code == 403, r.text[:200]


class _Runs:
    """In-memory job_runs (find_one / insert_one) so the catch-up rule is tested without touching any DB."""

    def __init__(self, rows):
        self.rows = list(rows)

    @staticmethod
    def _hit(r, q):
        import re

        for k, v in q.items():
            if isinstance(v, dict) and "$regex" in v:
                if not re.search(v["$regex"], r.get(k) or ""):
                    return False
            elif isinstance(v, dict) and "$not" in v:
                if re.search(v["$not"]["$regex"], r.get(k) or ""):
                    return False
            elif isinstance(v, dict) and "$in" in v:
                if r.get(k) not in v["$in"]:
                    return False
            elif r.get(k) != v:
                return False
        return True

    async def find_one(self, q, *a, **k):
        return next((r for r in self.rows if self._hit(r, q)), None)

    async def insert_one(self, doc):
        self.rows.append(doc)

    async def count_documents(self, q):
        return sum(1 for r in self.rows if self._hit(r, q))

    async def replace_one(self, q, doc, upsert=False):
        self.rows = [r for r in self.rows if not self._hit(r, q)] + [doc]

    async def update_many(self, q, upd):
        import types

        hit = [r for r in self.rows if self._hit(r, q)]
        for r in hit:
            r.update(upd["$set"])
        return types.SimpleNamespace(modified_count=len(hit))


def _catch_up_env(monkeypatch, rows, flag="true"):
    import types
    from datetime import UTC, datetime, time

    from services import clock

    runs = _Runs(rows)
    monkeypatch.setattr(dr, "db", types.SimpleNamespace(job_runs=runs))
    monkeypatch.setenv("DEMO_AUTO_REFRESH", flag)
    monkeypatch.setattr(dr, "busy", lambda: None)

    async def hosts():
        return [PREVIEW]

    calls = []

    async def rebuild(as_of):
        calls.append(as_of)
        return "done", {"backup": "x.archive.gz"}

    monkeypatch.setattr(dr, "served_hosts", hosts)
    monkeypatch.setattr(dr, "_rebuild", rebuild)
    at = datetime.combine(clock.today(), time(4, 0), tzinfo=clock.business_tz()).astimezone(UTC)
    return runs, calls, at


def _with_clock(at, coro_fn):
    import asyncio

    from services import clock

    async def go():
        tok = clock.AS_OF.set(at)
        try:
            return await coro_fn()
        finally:
            clock.AS_OF.reset(tok)

    return asyncio.run(go())


def test_catch_up_runs_once_after_a_missed_3am(monkeypatch):
    from datetime import timedelta

    from services import clock

    y = (clock.today() - timedelta(days=1)).isoformat()
    runs, calls, at = _catch_up_env(
        monkeypatch, [{"job": dr.JOB, "as_of": y, "outcome": "done", "trigger": "schedule"}]
    )
    first = _with_clock(at, dr.catch_up)
    assert first["outcome"] == "done (catch-up)" and first["trigger"] == "catch-up" and calls == [clock.today_iso()]
    assert _with_clock(at, dr.catch_up) is None and len(calls) == 1, "only once"


def test_catch_up_does_nothing_when_today_is_done_or_before_3am(monkeypatch):
    from services import clock

    runs, calls, at = _catch_up_env(
        monkeypatch, [{"job": dr.JOB, "as_of": clock.today_iso(), "outcome": "done", "trigger": "manual"}]
    )
    assert _with_clock(at, dr.catch_up) is None and not calls
    runs.rows.clear()
    early = at.astimezone(clock.business_tz()).replace(hour=2, minute=0).astimezone(at.tzinfo)
    assert _with_clock(early, dr.catch_up) is None and not calls


@pytest.mark.parametrize("flag,hosts", [("false", [PREVIEW]), ("true", ["billpe.com"])])
def test_catch_up_on_production_or_flag_off_is_disabled(monkeypatch, flag, hosts):
    runs, calls, at = _catch_up_env(monkeypatch, [], flag)

    async def h():
        return hosts

    monkeypatch.setattr(dr, "served_hosts", h)
    rec = _with_clock(at, dr.catch_up)
    assert rec["outcome"].startswith("disabled:") and not calls
    assert _with_clock(at, dr.catch_up) is None, "a disabled attempt is not retried on every restart"


def test_a_run_is_on_record_while_running_and_a_restart_marks_it_interrupted(monkeypatch):
    """E11 (JRN-38): 'running' row at start; on leader start a stale one becomes 'interrupted' and catch-up retries once."""
    from services import clock

    runs, calls, at = _catch_up_env(monkeypatch, [])
    seen = []

    async def rebuild(as_of):
        seen.append([r["outcome"] for r in runs.rows])  # what job history shows mid-run
        raise SystemExit  # the backend dies mid-run: no _record()

    monkeypatch.setattr(dr, "_rebuild", rebuild)
    with pytest.raises(SystemExit):
        _with_clock(at, dr.catch_up)
    assert seen == [["running"]] and runs.rows[0]["trigger"] == "catch-up"
    assert _with_clock(at, dr.mark_interrupted) == 1
    assert runs.rows[0]["outcome"].startswith("interrupted")

    async def ok(as_of):
        calls.append(as_of)
        return "done", {}

    monkeypatch.setattr(dr, "_rebuild", ok)
    again = _with_clock(at, dr.catch_up)  # interrupted ≠ done → retried once, recorded as done (catch-up)
    assert again["outcome"] == "done (catch-up)" and calls == [clock.today_iso()]
    assert _with_clock(at, dr.catch_up) is None


def test_mark_interrupted_leaves_a_live_run_alone(monkeypatch):
    """The lease can be acquired while this process is mid-run: that run is alive, not interrupted."""
    runs, calls, at = _catch_up_env(monkeypatch, [{"job": dr.JOB, "outcome": "running", "trigger": "manual"}])
    monkeypatch.setitem(dr.STATE, "running", True)
    assert _with_clock(at, dr.mark_interrupted) == 0 and runs.rows[0]["outcome"] == "running"
