"""Phase K.14: the committed OpenAPI snapshot must be current and no breaking diff may slip in.
Regenerate after an intentional API change:  cd /app/backend && python -m tools.openapi_snapshot --write"""
import json
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402
from tools.openapi_snapshot import PATH, breaking_diff, stale  # noqa: E402


def _live():
    spec = requests.get(f"{BASE}/api/openapi.json").json()
    spec.pop("servers", None)
    return spec


def test_snapshot_exists_and_not_stale():
    assert os.path.exists(PATH), "missing backend/docs/openapi/v1.json — run: python -m tools.openapi_snapshot --write"
    old, live = json.load(open(PATH)), _live()
    assert not breaking_diff(old, live), breaking_diff(old, live)
    assert not stale(old, live), "OpenAPI snapshot stale — run: cd /app/backend && python -m tools.openapi_snapshot --write"


def test_breaking_diff_detects_removed_path_and_type_change():
    old = {"paths": {"/api/a": {"get": {}}, "/api/b": {"post": {}}}, "components": {"schemas": {"X": {"properties": {"f": {"type": "integer"}, "g": {"type": "string"}}}}}}
    new = {"paths": {"/api/a": {"get": {}}}, "components": {"schemas": {"X": {"properties": {"f": {"type": "string"}, "h": {"type": "string"}}}}}}
    issues = breaking_diff(old, new)
    assert any("removed path /api/b" in i for i in issues) and any("type change X.f" in i for i in issues) and any("removed field X.g" in i for i in issues)
    assert breaking_diff(old, old) == []
