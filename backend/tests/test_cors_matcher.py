"""CORS allow-list matcher: explicit origins + single-level wildcard; '*' and other wildcard shapes are ignored (deny by default)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.cors import origin_allowed, parse_cors_origins  # noqa: E402

RAW = "https://billpe.com, https://www.billpe.com,https://*.emergent.host,https://royal-realty-hub-2.preview.emergentagent.com"


def test_parse_explicit_and_single_level_wildcard():
    explicit, regex = parse_cors_origins(RAW)
    assert explicit == ["https://billpe.com", "https://www.billpe.com", "https://royal-realty-hub-2.preview.emergentagent.com"]
    assert regex == r"^(?:https://[a-z0-9-]+\.emergent\.host)$"


def test_matcher_allows_only_intended_origins():
    explicit, regex = parse_cors_origins(RAW)
    for ok in ("https://billpe.com", "https://www.billpe.com", "https://kkt-erp.emergent.host", "https://a1-b2.emergent.host", "https://royal-realty-hub-2.preview.emergentagent.com"):
        assert origin_allowed(ok, explicit, regex), ok
    for bad in ("https://evil.example", "https://x.emergent.host.evil.com", "https://evil.com/https://kkt.emergent.host", "http://kkt-erp.emergent.host", "https://a.b.emergent.host", "https://emergent.host",
                "https://kkt-erp.emergent.host:8443", "https://billpe.com.evil.com", "https://xbillpe.com", "null"):
        assert not origin_allowed(bad, explicit, regex), bad


def test_star_and_other_wildcards_are_ignored_fail_closed():
    assert parse_cors_origins("*") == ([], None)
    assert parse_cors_origins("https://*") == ([], None)
    assert parse_cors_origins("https://*.*.emergent.host") == ([], None)
    assert parse_cors_origins("https://api-*.emergent.host") == ([], None)
    assert parse_cors_origins("*,https://billpe.com") == (["https://billpe.com"], None)
    assert parse_cors_origins("") == ([], None) and parse_cors_origins(None) == ([], None)
