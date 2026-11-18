"""Private test copy for the click-through: own DB (kkt_e2e) + own backend (:8031), both removed at the end."""

import os
import subprocess
import sys

BACKEND = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "backend")
)
sys.path.insert(0, os.path.dirname(__file__))


def _other_pytest():
    mine = {os.getpid(), os.getppid()}
    pids = subprocess.run(
        ["pgrep", "-f", "pytest"], capture_output=True, text=True, check=False
    ).stdout.split()
    return [p for p in pids if int(p) not in mine]


busy = _other_pytest()
assert not busy, (
    f"memory-safe gate: another pytest is running (pids {busy}); run the click-through on its own"
)
os.environ["KKT_TEST_DB"] = "kkt_e2e"
os.environ["KKT_TEST_PORT"] = "8031"
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)
import tests.conftest as _c

os.environ["KKT_E2E_BASE"] = _c.BASE


def pytest_sessionfinish(session, exitstatus):
    from pymongo import MongoClient

    if _c._server_proc:
        _c._server_proc.kill()
    assert _c.TEST_DB != _c.PREVIEW_DB
    MongoClient(os.environ["MONGO_URL"]).drop_database(_c.TEST_DB)
