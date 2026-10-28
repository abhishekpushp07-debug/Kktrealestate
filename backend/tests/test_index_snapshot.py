"""CR-2 C9: ensure_indexes() is split into per-group helpers — the resulting index set must stay identical to docs/index_snapshot.json.
Regenerate deliberately with: python -m tools.index_snapshot --write"""
import asyncio
import json
import os

from tools.index_snapshot import SNAPSHOT, build


def test_index_set_matches_snapshot():
    assert os.path.exists(SNAPSHOT), "run: python -m tools.index_snapshot --write"
    expected = json.load(open(SNAPSHOT))
    actual = asyncio.run(build())
    missing = {k: v for k, v in expected.items() if actual.get(k) != v}
    extra = {k: v for k, v in actual.items() if k not in expected}
    assert not missing and not extra, {"changed_or_missing": list(missing)[:10], "extra": list(extra)[:10]}
