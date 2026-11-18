"""Q1 (P2-2): one browser tab never shows a previous user's data. Static guard on the client cache wiring; the
behavioural proof is frontend/scripts/session_switch_e2e.py (Owner → Sales → Accounts in one tab, no reload)."""

import os
import re

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


def _read(rel):
    return open(os.path.join(SRC, rel)).read()


def test_every_cached_read_is_keyed_by_the_signed_in_user():
    s = _read("hooks/useList.js")
    assert 'queryKey: ["list", sessionUid(), path, params]' in s
    assert 'export const fetchKey = (path, uid = sessionUid(), deps = []) => ["fetch", uid, path, ...deps];' in s
    for root, _, files in os.walk(SRC):
        for f in files:
            if f.endswith((".js", ".jsx")):
                body = open(os.path.join(root, f)).read()
                assert not re.search(r'queryKey: \["(fetch|list)", "', body), f"{f}: cache key without the user id"


def test_logout_and_every_sign_in_switch_the_session():
    s = _read("context/AuthContext.jsx")
    assert s.count("switchSession(qc, null)") >= 2  # logout + forced logout handler
    assert "switchSession(qc, data.user?.id" in s  # login and MFA login share signIn
    assert "switchSession(qc, uidFromToken(tokens.access))" in s  # restored session


def test_session_switch_wipes_user_caches():
    s = _read("lib/session.js")
    for needle in ("qc.clear()", "resets.forEach", "kkt_recent_choices", "bootstrap_v1", "sessionStorage"):
        assert needle in s, needle
    for rel in ("lib/bootstrapCache.js", "hooks/useCatalogues.js"):
        assert "onSessionReset(" in _read(rel), rel


def test_no_module_level_user_state_left_in_home():
    assert not re.search(r"^let customizeOpened", _read("pages/v2/Home.jsx"), re.M)
