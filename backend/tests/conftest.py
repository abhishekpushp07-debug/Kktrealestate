"""Shared test session: ONE login per account per session (avoids the 10/60s login rate limit) — transparently applied to every test
that calls `requests.post(.../auth/login)` or `requests.post(.../portal/auth/login)` by caching the first successful response."""

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

from tests.story_anchors import bk

# The app's business day is IST (services.clock); tests that say "today" (date.today()) must mean the same day, also
# between 00:00 and 05:30 IST when the container's UTC date is still yesterday. Inherited by xdist workers + private backend.
os.environ["TZ"] = "Asia/Kolkata"
time.tzset()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
if "REACT_APP_BACKEND_URL" not in os.environ:
    fe = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
    if os.path.exists(fe):
        for line in Path(fe).read_text().splitlines(True):
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
TEST_PASSWORD = (
    os.environ.get("TEST_PASSWORD") or os.environ["DEMO_PASSWORD"]
)  # seeded-user password (backend/.env); never a literal in source
# ---------------------------------------------------------------------------------------------------------------------------------
# R0d — TEST DB ISOLATION. The suite NEVER runs against the preview database. The controller process snapshots the preview story DB
# into `kkt_test` (deterministic story output == fixture), starts a private backend on :8011 bound to it, and points every test there.
# Opt-outs: KKT_TEST_EXTERNAL=1 (public preview URL, read-only smoke) · KKT_TEST_USE_PREVIEW=1 (legacy, forbidden in CI).
# CI: `cd backend && python -m pytest -q` (conftest does the rest; needs mongod + LOGIN_RATE_LIMIT_BYPASS_TOKEN in the process env).
# ---------------------------------------------------------------------------------------------------------------------------------
PREVIEW_DB = os.environ.get("KKT_PREVIEW_DB") or os.environ["DB_NAME"]
os.environ["KKT_PREVIEW_DB"] = (
    PREVIEW_DB  # workers inherit DB_NAME=kkt_test; remember the real preview name for the never-touch assertion
)
TEST_DB = os.environ.get("KKT_TEST_DB", "kkt_test")
TEST_PORT = int(os.environ.get("KKT_TEST_PORT", "8021"))
_server_proc = None


def _raise_mongod_fd_limit():
    """Local-box guard: mongod ships with a 1024 soft nofile limit; three WiredTiger DBs (~320 files each) + the suite's
    connections cross it and mongod fasserts (TooManyFilesOpen → 'connection closed' flakes). Best effort, root only."""
    try:
        for pid in subprocess.run(["pgrep", "-x", "mongod"], capture_output=True, text=True).stdout.split():
            cur = [ln for ln in Path(f"/proc/{pid}/limits").read_text().splitlines() if ln.startswith("Max open files")]
            if cur and int(cur[0].split()[3]) < 8192:
                subprocess.run(["prlimit", "--pid", pid, "--nofile=65536:1048576"], check=False)
    except Exception as e:  # noqa: BLE001
        print("mongod fd limit guard skipped:", e)


def _refuse_snapshot_mid_rebuild(src):
    """A snapshot taken while a story rebuild runs has wiped/half-seeded collections (pytest_run1: no seeded tower templates)."""
    import fcntl

    try:
        with open("/tmp/kkt_reseed.lock", "a+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fh, fcntl.LOCK_UN)
    except BlockingIOError:
        raise RuntimeError(
            "a reseed is running on the preview DB — wait for it to finish, then run the suite"
        ) from None
    story = src.settings.find_one({"key": "story"}, {"_id": 0, "value": 1})
    if story is not None and not story.get("value"):
        raise RuntimeError("preview story rebuild has not finished (settings.story marker unset) — wait, then rerun")


_SNAP_LOCK: list = []


def _snapshot_preview_into_test_db():
    _raise_mongod_fd_limit()
    import fcntl

    from pymongo import MongoClient

    cli = MongoClient(os.environ["MONGO_URL"])
    src, dst = cli[PREVIEW_DB], cli[TEST_DB]
    _refuse_snapshot_mid_rebuild(src)
    snap_lock = open("/tmp/kkt_test_snapshot.lock", "a+")  # noqa: SIM115 — the nightly demo refresh skips while held
    fcntl.flock(snap_lock, fcntl.LOCK_EX)
    _SNAP_LOCK.append(snap_lock)
    cli.drop_database(TEST_DB)
    for name in src.list_collection_names():
        batch = []  # streamed in bounded batches: audit_logs alone is > 500 MB (a whole-collection list OOM-killed the pod)
        for doc in src[name].find({}).batch_size(1000):
            batch.append(doc)
            if len(batch) == 1000:
                dst[name].insert_many(batch, ordered=False)
                batch = []
        if batch:
            dst[name].insert_many(batch, ordered=False)
        for ix in src[name].list_indexes():
            if ix["name"] != "_id_":
                opts = {k: v for k, v in ix.items() if k not in ("key", "v", "ns", "name")}
                dst[name].create_index(list(ix["key"].items()), name=ix["name"], **opts)
    for info in src.list_collections():  # schema validators travel with the snapshot
        v = (info.get("options") or {}).get("validator")
        if v:
            if info["name"] not in dst.list_collection_names():
                dst.create_collection(info["name"])
            dst.command(
                "collMod",
                info["name"],
                validator=v,
                validationLevel=info["options"].get("validationLevel", "strict"),
                validationAction=info["options"].get("validationAction", "error"),
            )
    dst.leases.delete_many({})  # let the private backend run its own (idempotent) startup on the copy
    dst.settings.update_one(
        {"key": "test_db_marker"}, {"$set": {"value": True, "source": PREVIEW_DB, "at": time.time()}}, upsert=True
    )
    while _SNAP_LOCK:
        _SNAP_LOCK.pop().close()


STORY_LOGIC_FILE = "/tmp/kkt_story_logic.json"


def _story_logic_on_snapshot():
    """REQ-36/38 checks run on the untouched snapshot (tests create back-dated/partial records later)."""
    import json

    from pymongo import MongoClient

    from services import clock
    from tools.story_logic_check import bands, check, followups, gaps, next_stage

    db = MongoClient(os.environ["MONGO_URL"])[TEST_DB]
    as_of = ((db.settings.find_one({"key": "story"}) or {}).get("value") or {}).get("as_of") or clock.today_iso()
    band_problems, band_totals = bands(db, as_of)  # REQ-58: expectations follow the story's own as-of date
    stage_problems, stages = next_stage(db)
    fu_problems, fu_count = followups(db, as_of)
    result = {
        "followups": fu_problems,
        "followups_count": fu_count,
        "chronology": check(db, clock.today_iso()),
        "gaps": gaps(db),
        "as_of": as_of,
        "bands": band_problems,
        "band_totals": band_totals,
        "next_stage": stage_problems,
        "next_stages": stages,
    }
    with open(STORY_LOGIC_FILE, "w") as fh:
        json.dump(result, fh)


PURGE_SCAN_FILE = "/tmp/kkt_purge_scan.json"


def _purge_scan_on_snapshot():
    """Q-4: hard-purge dry run on the untouched snapshot, before any test creates QA data."""
    import json

    hb = {"X-Rate-Limit-Bypass": BYPASS_TOKEN}
    login = requests.post(
        f"http://127.0.0.1:{TEST_PORT}/api/auth/login",
        json={"email": "admin@kkt.in", "password": TEST_PASSWORD},
        headers=hb,
        timeout=30,
    )
    login.raise_for_status()
    r = requests.post(
        f"http://127.0.0.1:{TEST_PORT}/api/admin/hard-purge",
        json={"dry_run": True},
        headers={**hb, "Authorization": f"Bearer {login.json()['access_token']}"},
        timeout=120,
    )
    r.raise_for_status()
    with open(PURGE_SCAN_FILE, "w") as fh:
        json.dump(r.json(), fh)


def _start_private_backend():
    import atexit
    import subprocess

    global _server_proc
    env = {
        **os.environ,
        "DB_NAME": TEST_DB,
        "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS_TOKEN,
        "SEEDER_AS_OF_ENABLED": "true",
        "KKT_ROLE": "test",
        "KKT_SELF_BASE": f"http://127.0.0.1:{TEST_PORT}",
        "BACKUP_ENABLED": "0",
        "KKT_JOB_SETTLE_S": "0",  # tests expect the scheduler at once
        "DEMO_AUTO_REFRESH": "false",  # the private test backend never rebuilds its snapshot DB at 03:00 IST
        "ACCESS_TOKEN_MINUTES": "60",  # one cached login per account per session must outlive a slow full run
    }  # test servers never mongodump (filled the shared volume once)
    with open("/tmp/kkt_test_backend.log", "w") as log:  # the child keeps its own dup of the fd
        _server_proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "server:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(TEST_PORT),
                "--log-level",
                "warning",
                "--timeout-keep-alive",
                "120",
            ],
            cwd=os.path.join(os.path.dirname(__file__), ".."),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    atexit.register(lambda: _server_proc and _server_proc.kill())
    for _ in range(90):
        try:
            if requests.get(f"http://127.0.0.1:{TEST_PORT}/api/health", timeout=2).status_code == 200:
                return
        except requests.exceptions.RequestException:
            pass
        if _server_proc.poll() is not None:
            raise RuntimeError("private test backend died: see /tmp/kkt_test_backend.log")
        time.sleep(1)
    raise RuntimeError("private test backend did not become healthy")


BYPASS_TOKEN = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")
if os.environ.get("KKT_TEST_EXTERNAL"):
    pass  # read-only smoke against the public URL (no DB assertions possible)
elif os.environ.get("KKT_TEST_USE_PREVIEW"):
    try:
        if requests.get("http://localhost:8001/api/health", timeout=2).status_code == 200:
            BASE = "http://localhost:8001"
    except requests.exceptions.RequestException:
        pass
else:
    if (
        not os.environ.get("PYTEST_XDIST_WORKER") and os.environ.get("DB_NAME") != TEST_DB
    ):  # controller: snapshot + start once
        _snapshot_preview_into_test_db()
        _story_logic_on_snapshot()
        _start_private_backend()
        _purge_scan_on_snapshot()
    os.environ.setdefault("KKT_TEST_SESSION", str(time.time()))  # flat_claims scope, inherited by xdist workers
    os.environ["DB_NAME"] = TEST_DB  # inherited by xdist workers (spawned after this import)
    BASE = f"http://127.0.0.1:{TEST_PORT}"
    assert os.environ["DB_NAME"] != PREVIEW_DB, "tests must never target the preview DB"
os.environ["REACT_APP_BACKEND_URL"] = BASE
# Test-only rate-limit bypass: the token lives in the test process + local supervisor env only (asserted absent from .env in test_hardening).
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")
_orig_request = requests.Session.request


def _bypass_request(self, method, url, **kwargs):
    if isinstance(url, str) and "/api/" in url:
        h = dict(kwargs.get("headers") or {})
        h.setdefault("X-Rate-Limit-Bypass", BYPASS)
        kwargs["headers"] = h
    if "_POOL" in globals() and self is not _POOL and self.adapters is not _POOL.adapters:
        self.adapters = (
            _POOL.adapters
        )  # share one keep-alive pool: this pod has ~1k ephemeral ports and TIME_WAIT lasts 60 s
    for attempt in range(3):  # preview ingress occasionally drops a TCP connect; retry only connect-level failures
        try:
            return _orig_request(self, method, url, **kwargs)
        except requests.exceptions.ConnectTimeout:
            if attempt == 2:
                raise
            time.sleep(2)


requests.Session.request = _bypass_request
# One keep-alive pool for all module-level requests.* calls (fresh connection per call exhausts ephemeral ports against localhost).
_POOL = requests.Session()
_POOL.mount("http://", requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=50))
_POOL.mount("https://", requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=50))


def _pooled_request(method, url, **kwargs):
    return _POOL.request(method=method, url=url, **kwargs)


requests.api.request = _pooled_request
_orig_close = requests.Session.close
requests.Session.close = lambda self: None if self.adapters is _POOL.adapters else _orig_close(self)
try:
    import httpx as _hx

    _orig_hx = _hx.Client.request
    _HX_POOL = _hx.Client(timeout=30)

    def _bypass_hx(self, method, url, **kwargs):
        h = dict(kwargs.get("headers") or {})
        h.setdefault("X-Rate-Limit-Bypass", BYPASS)
        kwargs["headers"] = h
        return _orig_hx(self, method, url, **kwargs)

    _hx.Client.request = _bypass_hx

    def _hx_pooled(method, url, **kwargs):
        for k in ("trust_env", "verify", "cert", "proxy", "proxies"):
            kwargs.pop(k, None)
        return _HX_POOL.request(method, url, **kwargs)

    _hx._api.request = _hx_pooled
except ImportError:
    pass
_LOGIN_CACHE: dict[tuple, requests.Response] = {}
_real_post = requests.post
_real_session_post = requests.Session.post


NO_CACHE_FILES = (
    "test_phase_1_5.py",
    "test_phase_5.py",
    "test_phase_11a.py",
    "test_owner_bootstrap.py",
    "test_story_behaviours.py",
)  # MFA / refresh-rotation / session-revocation / host-gating tests need real logins


def _cache_key(url, kwargs):
    if not isinstance(url, str) or not url.rstrip("/").endswith(("/api/auth/login", "/api/portal/auth/login")):
        return None
    import traceback

    if any(f in frame.filename for frame in traceback.extract_stack() for f in NO_CACHE_FILES):
        return None
    body = kwargs.get("json")
    if not isinstance(body, dict):
        return None
    return (url.rstrip("/"), body.get("email") or body.get("phone"), body.get("password"))


_TOKEN_FILE = "/tmp/kkt_test_tokens.json"


def _file_get(key):
    """Cross-process (xdist) token share so the whole suite needs ≤1 real login per account."""
    try:
        import json
        import time

        d = json.loads(Path(_TOKEN_FILE).read_text())
        e = d.get("|".join(map(str, key)))
        if e and time.time() - e["at"] < 600:
            return e["body"]
    except Exception:
        logging.getLogger(__name__).debug("handled error", exc_info=True)
        return None


def _file_put(key, body):
    try:
        import json
        import time

        try:
            d = json.loads(Path(_TOKEN_FILE).read_text())
        except Exception:
            logging.getLogger(__name__).debug("handled error", exc_info=True)
            d = {}
        d["|".join(map(str, key))] = {"at": time.time(), "body": body}
        Path(_TOKEN_FILE).write_text(json.dumps(d))
    except Exception:
        logging.getLogger(__name__).debug("ignored non-fatal error", exc_info=True)


def _fake_requests_response(body):
    import json

    r = requests.Response()
    r.status_code = 200
    r._content = json.dumps(body).encode()
    r.headers["content-type"] = "application/json"
    return r


def _cached_post(url, *args, **kwargs):
    key = _cache_key(url, kwargs)
    if key and key in _LOGIN_CACHE:
        return _LOGIN_CACHE[key]
    if key:
        shared = _file_get(key)
        if shared:
            _LOGIN_CACHE[key] = _fake_requests_response(shared)
            return _LOGIN_CACHE[key]
    r = _real_post(url, *args, **kwargs)
    if key and r.status_code == 200:
        _LOGIN_CACHE[key] = r
        _file_put(key, r.json())
    return r


def _cached_session_post(self, url, *args, **kwargs):
    key = _cache_key(url, kwargs)
    if key and key in _LOGIN_CACHE:
        return _LOGIN_CACHE[key]
    if key:
        shared = _file_get(key)
        if shared:
            _LOGIN_CACHE[key] = _fake_requests_response(shared)
            return _LOGIN_CACHE[key]
    r = _real_session_post(self, url, *args, **kwargs)
    if key and r.status_code == 200:
        _LOGIN_CACHE[key] = r
        _file_put(key, r.json())
    return r


requests.post = _cached_post
requests.Session.post = _cached_session_post

try:  # several older suites use httpx for logins
    import httpx

    _real_httpx_post = httpx.post

    def _cached_httpx_post(url, *args, **kwargs):
        key = _cache_key(str(url), kwargs)
        if key and key in _LOGIN_CACHE:
            return _LOGIN_CACHE[key]
        if key:
            shared = _file_get(key)
            if shared:
                _LOGIN_CACHE[key] = httpx.Response(200, json=shared, request=httpx.Request("POST", str(url)))
                return _LOGIN_CACHE[key]
        r = _real_httpx_post(url, *args, **kwargs)
        if key and r.status_code == 200:
            _LOGIN_CACHE[key] = r
            _file_put(key, r.json())
        return r

    httpx.post = _cached_httpx_post
except ImportError:
    pass


def pytest_sessionstart(session):
    """Pristine state for one green run: clear QA debris left by interrupted runs (test towers/customers, stray MFA enrolments)."""
    if not hasattr(session.config, "workerinput"):  # controller only
        try:
            os.remove(_TOKEN_FILE)
        except OSError:
            pass
    try:
        from pymongo import MongoClient

        d = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        test_blocks = [b["id"] for b in d.blocks.find({"name": {"$regex": "^TEST_"}}, {"id": 1})]
        if test_blocks:
            d.flats.delete_many({"block_id": {"$in": test_blocks}})
            d.blocks.delete_many({"id": {"$in": test_blocks}})
        booked = {b["customer_id"] for b in d.bookings.find({}, {"customer_id": 1})}
        d.customers.delete_many(
            {"full_name": {"$regex": "^(TEST |Idem Test|Playwright)"}, "id": {"$nin": list(booked)}}
        )
        d.users.update_many(
            {"mfa_enabled": True},
            {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": "", "mfa_recovery_codes": ""}},
        )
    except Exception as e:  # never block the run
        logging.getLogger(__name__).debug("handled error", exc_info=True)
        print("sessionstart cleanup skipped:", e)


def session_token(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def base_url():
    return BASE


@pytest.fixture(scope="session")
def admin_headers():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"}


@pytest.fixture(scope="session")
def anchor_booking(admin_headers):
    r = requests.get(f"{BASE}/api/bookings", params={"page_size": 50}, headers=admin_headers).json()
    items = r["items"] if isinstance(r, dict) else r
    anchor = bk("bounce")  # story anchor by role (numbers only go up across rebuilds)
    r = requests.get(f"{BASE}/api/bookings", params={"search": anchor, "page_size": 5}, headers=admin_headers).json()
    items = r["items"] if isinstance(r, dict) else r
    return next(b for b in items if b["booking_number"] == anchor)


# Phase H: the demo seed (seed_phase2/5/9 fixtures: owner's example BK-2526-0001 table, Tower B "18 %", 6 CMS testimonials,
# pre-switch price snapshot, Priya/Sunita/Santosh portal personas) is retired when the DB is the API-driven story dataset.
# Those tests assert the shape of the old raw-inserted fixtures and are skipped in story mode; the story has its own anchors
# (tests/test_story_headline.py).
def _story_mode() -> bool:
    try:
        from pymongo import MongoClient

        db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        return bool(
            db.settings.find_one({"key": "story_mode", "value": True})
            or db.settings.find_one({"key": "story", "value.as_of": {"$exists": True}})
        )
    except Exception:
        logging.getLogger(__name__).debug("handled error", exc_info=True)
        return False


@pytest.fixture(scope="session")
def work_booking(admin_headers, anchor_booking):
    """A plain `story:ontime` booking from the snapshot (no anchor test reads it) — tests may post/reverse money against it
    without disturbing anchor assertions. Never a booking another test created (those get cancelled by their own cleanup)."""
    from datetime import datetime, timezone

    from pymongo import MongoClient

    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    snap_at = datetime.fromtimestamp(db.settings.find_one({"key": "test_db_marker"})["at"], timezone.utc).isoformat()
    cand = db.bookings.find(
        {"status": "Active", "created_at": {"$lt": snap_at}, "remarks": "story:ontime"},
        {"_id": 0, "id": 1, "booking_number": 1},
    ).sort("booking_number", -1)
    picked = next(b for b in cand if b["booking_number"] != anchor_booking["booking_number"])
    return requests.get(f"{BASE}/api/bookings/{picked['id']}", headers=admin_headers).json()


# Cross-worker reader/writer lock: tests marked `load_sensitive` take an exclusive flock, every other test a shared one,
# so the marked tests run alone (no concurrent load from the other xdist worker) while everything else stays parallel.
_LOCK_PATH = os.path.join(os.path.dirname(__file__), ".load_sensitive.lock")


_LOCK_HELD = [False]  # this process already holds the flock (a test is running) → nested fixture setup must not re-lock


@pytest.fixture(autouse=True)
def _load_sensitive_lock(request):
    import fcntl

    exclusive = request.node.get_closest_marker("load_sensitive") is not None
    with open(_LOCK_PATH, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        _LOCK_HELD[0] = True
        if exclusive:  # other tests' after-commit work (REQ-111) may still be landing once their lock is released
            requests.post(
                f"{BASE}/api/admin/ops/after-commit/drain",
                headers={"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"},
                timeout=60,
            ).raise_for_status()
        try:
            yield
        finally:
            _LOCK_HELD[0] = False
            fcntl.flock(fh, fcntl.LOCK_UN)


@pytest.hookimpl(hookwrapper=True)
def pytest_fixture_setup(fixturedef, request):
    """Module/session fixtures write too (setup runs before the per-test lock): take the shared lock around their setup
    so they never run while the other worker holds the exclusive `load_sensitive` lock."""
    import fcntl

    if fixturedef.scope == "function" or _LOCK_HELD[0]:
        yield
        return
    with open(_LOCK_PATH, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_SH)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    """F3 (opt-in, PYTEST_RSS_LOG=<dir>): one line per test with this worker's RSS before/after, to find growth."""
    out = os.environ.get("PYTEST_RSS_LOG")
    if not out:
        yield
        return
    import psutil

    proc = psutil.Process()
    before = proc.memory_info().rss
    t0 = time.time()
    yield
    after = proc.memory_info().rss
    wid = os.environ.get("PYTEST_XDIST_WORKER", "main")
    with open(Path(out) / f"rss_{wid}.log", "a") as fh:
        fh.write(f"{before >> 20}\t{after >> 20}\t{(after - before) >> 20}\t{time.time() - t0:.1f}\t{item.nodeid}\n")


def pytest_sessionfinish(session, exitstatus):
    """A failed run keeps the private backend's log (next session overwrites /tmp/kkt_test_backend.log)."""
    if session.testsfailed and os.path.exists("/tmp/kkt_test_backend.log"):
        import shutil

        os.makedirs("/app/memory/qa/test_logs", exist_ok=True)
        shutil.copy("/tmp/kkt_test_backend.log", f"/app/memory/qa/test_logs/backend_{int(time.time())}.log")
