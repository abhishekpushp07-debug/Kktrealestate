"""Parity rehearsal: reseed the story on the isolated kkt_test backend (spawned by tests.conftest), then run the headline test against it. Never touches the preview DB."""
import os
import subprocess
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests import conftest  # noqa: E402  (starts the private backend on kkt_test)

BASE = conftest.BASE
assert "8021" in BASE, BASE
H = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
tok = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=H, timeout=30).json()["access_token"]
A = {**H, "Authorization": f"Bearer {tok}"}
as_of = sys.argv[1] if len(sys.argv) > 1 else "2026-10-26"
r = requests.post(f"{BASE}/api/admin/reseed", json={"confirm": "RESEED", "story": True, "as_of": as_of}, headers=A, timeout=600)
print("reseed", r.status_code, r.text[:200])
env = {**os.environ, "STORY_BASE_URL": BASE, "LOGIN_RATE_LIMIT_BYPASS_TOKEN": "kkt-test-bypass-local"}
p = subprocess.run([sys.executable, "tools/story_seed.py", "--as-of", as_of, "--base", BASE], env=env, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True)
print(p.stdout[-600:], p.stderr[-800:])
tok = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, headers=H, timeout=30).json()["access_token"]
A = {**H, "Authorization": f"Bearer {tok}"}
print("marker", requests.get(f"{BASE}/api/admin/story-marker", headers=A, timeout=30).json())
t = subprocess.run([sys.executable, "-m", "pytest", "tests/test_story_headline.py", "tests/test_ledger_example.py", "tests/test_whole_rupee.py", "-q", "-p", "no:cacheprovider", "--no-header", "-rfEs"], env={**os.environ, "KKT_TEST_EXTERNAL": "1", "REACT_APP_BACKEND_URL": BASE, "DB_NAME": "kkt_test", "LOGIN_RATE_LIMIT_BYPASS_TOKEN": "kkt-test-bypass-local"}, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True)
print(t.stdout[-2500:])
