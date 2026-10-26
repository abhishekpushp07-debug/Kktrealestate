"""Phase K: every error code used in source must be in errors.ERRORS with a matching HTTP status."""
import glob
import re

from errors import ERRORS

ROOT = "/app/backend"
PAT_API = re.compile(r'ApiError\(\s*(\d{3})\s*,\s*(?:f?"[^"]*"|[^,]+),\s*"([A-Z_]+)"')
PAT_ENV = re.compile(r'status_code=(\d{3}),\s*content=\{"detail":[^}]*?"code":\s*"([A-Z_]+)"')


def _scan():
    found = {}
    for f in glob.glob(f"{ROOT}/routers/*.py") + glob.glob(f"{ROOT}/services/*.py") + [f"{ROOT}/{n}" for n in ("utils.py", "deps.py", "infra.py", "server.py")]:
        s = open(f).read()
        for st, code in PAT_API.findall(s) + PAT_ENV.findall(s):
            found.setdefault(code, set()).add(int(st))
    return found


def test_every_code_registered_with_matching_status():
    found = _scan()
    assert found, "scanner found nothing — pattern broken"
    unregistered = sorted(c for c in found if c not in ERRORS)
    mismatched = sorted(f"{c}: used {sorted(found[c])} registered {ERRORS[c]}" for c in found if c in ERRORS and not found[c] <= set(ERRORS[c]))
    assert not unregistered, f"unregistered error codes: {unregistered} (add to errors.py)"
    assert not mismatched, f"status mismatch: {mismatched}"


def test_registry_codes_are_upper_snake_and_statuses_valid():
    for code, sts in ERRORS.items():
        assert re.fullmatch(r"[A-Z][A-Z0-9_]+", code), code
        assert all(100 <= s <= 599 for s in sts), (code, sts)
