"""Shared test session: ONE login per account per session (avoids the 10/60s login rate limit) — transparently applied to every test
that calls `requests.post(.../auth/login)` or `requests.post(.../portal/auth/login)` by caching the first successful response."""
import os
import time
import sys

import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
if "REACT_APP_BACKEND_URL" not in os.environ:
    fe = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
    if os.path.exists(fe):
        for line in open(fe):
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
# ---------------------------------------------------------------------------------------------------------------------------------
# R0d — TEST DB ISOLATION. The suite NEVER runs against the preview database. The controller process snapshots the preview story DB
# into `kkt_test` (deterministic story output == fixture), starts a private backend on :8011 bound to it, and points every test there.
# Opt-outs: KKT_TEST_EXTERNAL=1 (public preview URL, read-only smoke) · KKT_TEST_USE_PREVIEW=1 (legacy, forbidden in CI).
# CI: `cd backend && python -m pytest -q` (conftest does the rest; needs mongod + LOGIN_RATE_LIMIT_BYPASS_TOKEN in the process env).
# ---------------------------------------------------------------------------------------------------------------------------------
PREVIEW_DB = os.environ.get("KKT_PREVIEW_DB") or os.environ["DB_NAME"]
os.environ["KKT_PREVIEW_DB"] = PREVIEW_DB  # workers inherit DB_NAME=kkt_test; remember the real preview name for the never-touch assertion
TEST_DB = os.environ.get("KKT_TEST_DB", "kkt_test")
TEST_PORT = int(os.environ.get("KKT_TEST_PORT", "8021"))
_server_proc = None


def _raise_mongod_fd_limit():
    """Local-box guard: mongod ships with a 1024 soft nofile limit; three WiredTiger DBs (~320 files each) + the suite's
    connections cross it and mongod fasserts (TooManyFilesOpen → 'connection closed' flakes). Best effort, root only."""
    try:
        for pid in subprocess.run(["pgrep", "-x", "mongod"], capture_output=True, text=True).stdout.split():
            cur = [ln for ln in open(f"/proc/{pid}/limits") if ln.startswith("Max open files")]
            if cur and int(cur[0].split()[3]) < 8192:
                subprocess.run(["prlimit", "--pid", pid, "--nofile=65536:1048576"], check=False)
    except Exception as e:  # noqa: BLE001
        print("mongod fd limit guard skipped:", e)


def _snapshot_preview_into_test_db():
    _raise_mongod_fd_limit()
    from pymongo import MongoClient
    cli = MongoClient(os.environ["MONGO_URL"])
    src, dst = cli[PREVIEW_DB], cli[TEST_DB]
    cli.drop_database(TEST_DB)
    for name in src.list_collection_names():
        docs = list(src[name].find({}))
        if docs:
            dst[name].insert_many(docs, ordered=False)
        for ix in src[name].list_indexes():
            if ix["name"] != "_id_":
                opts = {k: v for k, v in ix.items() if k not in ("key", "v", "ns", "name")}
                dst[name].create_index(list(ix["key"].items()), name=ix["name"], **opts)
    for info in src.list_collections():  # schema validators travel with the snapshot
        v = (info.get("options") or {}).get("validator")
        if v:
            if info["name"] not in dst.list_collection_names():
                dst.create_collection(info["name"])
            dst.command("collMod", info["name"], validator=v, validationLevel=info["options"].get("validationLevel", "strict"), validationAction=info["options"].get("validationAction", "error"))
    dst.leases.delete_many({})  # let the private backend run its own (idempotent) startup on the copy
    dst.settings.update_one({"key": "test_db_marker"}, {"$set": {"value": True, "source": PREVIEW_DB, "at": time.time()}}, upsert=True)


def _start_private_backend():
    import atexit
    import subprocess
    global _server_proc
    env = {**os.environ, "DB_NAME": TEST_DB, "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS_TOKEN, "SEEDER_AS_OF_ENABLED": "true", "KKT_ROLE": "test"}
    log = open("/tmp/kkt_test_backend.log", "w")
    _server_proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(TEST_PORT), "--log-level", "warning"], cwd=os.path.join(os.path.dirname(__file__), ".."), env=env, stdout=log, stderr=subprocess.STDOUT)
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
    if not os.environ.get("PYTEST_XDIST_WORKER") and os.environ.get("DB_NAME") != TEST_DB:  # controller: snapshot + start once
        _snapshot_preview_into_test_db()
        _start_private_backend()
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
        self.adapters = _POOL.adapters  # share one keep-alive pool: this pod has ~1k ephemeral ports and TIME_WAIT lasts 60 s
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


NO_CACHE_FILES = ("test_phase_1_5.py", "test_phase_5.py", "test_phase_11a.py", "test_owner_bootstrap.py", "test_story_behaviours.py")  # MFA / refresh-rotation / session-revocation / host-gating tests need real logins


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
        import json, time
        d = json.load(open(_TOKEN_FILE))
        e = d.get("|".join(map(str, key)))
        if e and time.time() - e["at"] < 600:
            return e["body"]
    except Exception:
        return None


def _file_put(key, body):
    try:
        import json, time
        try:
            d = json.load(open(_TOKEN_FILE))
        except Exception:
            d = {}
        d["|".join(map(str, key))] = {"at": time.time(), "body": body}
        json.dump(d, open(_TOKEN_FILE, "w"))
    except Exception:
        pass


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
        d.customers.delete_many({"full_name": {"$regex": "^(TEST |Idem Test|Playwright)"}, "id": {"$nin": list(booked)}})
        d.users.update_many({"mfa_enabled": True}, {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": "", "mfa_recovery_codes": ""}})
    except Exception as e:  # never block the run
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
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', 'Kkt@12345')}"}


@pytest.fixture(scope="session")
def anchor_booking(admin_headers):
    r = requests.get(f"{BASE}/api/bookings", params={"page_size": 50}, headers=admin_headers).json()
    items = r["items"] if isinstance(r, dict) else r
    anchor = "BK-2526-0014" if _story_mode() else "BK-2526-0001"  # Phase H story anchor
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
        return bool(db.settings.find_one({"key": "story_mode", "value": True}))
    except Exception:
        return False




@pytest.fixture(scope="session")
def work_booking(admin_headers, anchor_booking):
    """An Active story booking that is NOT a headline anchor — tests may post/reverse money against it without disturbing anchor assertions."""
    r = requests.get(f"{BASE}/api/bookings", params={"status": "Active", "page_size": 50}, headers=admin_headers).json()
    items = r["items"] if isinstance(r, dict) else r
    return next(b for b in sorted(items, key=lambda x: x["booking_number"], reverse=True) if b["booking_number"] not in (anchor_booking["booking_number"], "BK-2526-0009", "BK-2526-0013"))
