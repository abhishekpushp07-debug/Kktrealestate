"""Dev helper: snapshot preview → kkt_e2e and keep the private backend on :8031 up until killed."""

import os
import sys
import time

os.environ["KKT_TEST_DB"] = "kkt_e2e"
os.environ["KKT_TEST_PORT"] = "8031"
BACKEND = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "backend")
)
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)
import tests.conftest  # noqa: F401

print("ready", flush=True)
while True:
    time.sleep(60)
