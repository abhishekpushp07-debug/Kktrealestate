"""REQ-28: a reseed never deletes or lowers a number counter (behavioural, on a scratch copy of the test DB)."""

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from pymongo import MongoClient

from tools._env import DEMO_PASSWORD

BACKEND = Path(__file__).resolve().parents[1]
SCRATCH = os.environ["DB_NAME"] + "_ctrtest"
PORT = 8032
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")


def _copy_db(url, src):
    dump = subprocess.Popen(["mongodump", "--uri", url, "--db", src, "--archive", "--quiet"], stdout=subprocess.PIPE)
    subprocess.run(
        ["mongorestore", "--uri", url, "--archive", "--drop", "--quiet", f"--nsFrom={src}.*", f"--nsTo={SCRATCH}.*"],
        stdin=dump.stdout,
        check=True,
    )
    dump.wait()


def _start():
    env = {**os.environ, "DB_NAME": SCRATCH, "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS, "BACKUP_ENABLED": "0"}
    env.pop("KKT_SELF_BASE", None)
    with open("/tmp/kkt_ctrtest_backend.log", "w") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT)],
            cwd=BACKEND,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    for _ in range(120):
        try:
            if httpx.get(f"http://127.0.0.1:{PORT}/api/health", timeout=2).json().get("startup", {}).get("done"):
                return proc
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1)
    proc.kill()
    raise RuntimeError("scratch backend did not start: see /tmp/kkt_ctrtest_backend.log")


def _counters(db):
    return {f"{c['scope']}:{c['key']}": c["seq"] for c in db.counters.find({}, {"_id": 0})}


@pytest.mark.load_sensitive
def test_reseed_leaves_every_counter_at_or_above_previous():
    url = os.environ["MONGO_URL"]
    cli = MongoClient(url)
    _copy_db(url, os.environ["DB_NAME"])
    db = cli[SCRATCH]
    db.leases.delete_many({})
    db.counters.update_one({"scope": "booking_number", "key": "9999"}, {"$set": {"seq": 4242}}, upsert=True)
    before = _counters(db)
    proc = _start()
    try:
        base = f"http://127.0.0.1:{PORT}"
        tok = httpx.post(
            f"{base}/api/auth/login",
            json={"email": "admin@kkt.in", "password": DEMO_PASSWORD},
            headers={"X-Rate-Limit-Bypass": BYPASS},
            timeout=30,
        ).json()["access_token"]
        r = httpx.post(
            f"{base}/api/admin/reseed",
            json={"confirm": "RESEED"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=600,
        )
        assert r.status_code == 200, r.text
        after = _counters(db)
        lowered = {k: (v, after.get(k)) for k, v in before.items() if (after.get(k) or 0) < v}
        assert not lowered, f"counters lowered or deleted by reseed: {lowered}"
    finally:
        proc.terminate()
        proc.wait(timeout=30)
        cli.drop_database(SCRATCH)
