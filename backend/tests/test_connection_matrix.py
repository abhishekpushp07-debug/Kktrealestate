"""F-42 gate (REQ-67…73): every action × every surface on the private test copy; the grid is saved for the record."""

import os

import pytest

from tests.conftest import BASE
from tools import connection_matrix as cm

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "memory", "qa", "phase2", "connection_matrix.md")


@pytest.mark.load_sensitive  # company-wide surfaces (Home, Roznamcha, cheque register) must only move by this action
def test_connection_matrix_all_green(admin_headers):
    cells = cm.run(
        BASE, admin_headers, (os.environ.get("MATRIX_ONLY") or None) and os.environ["MATRIX_ONLY"].split(",")
    )
    if not os.environ.get("MATRIX_ONLY"):
        with open(OUT, "w") as fh:
            fh.write(cm.report(cells))
    reds = [f"{a} × {s}: {'; '.join(bad)}" for a, s, st, _t, _b, _a, bad in cells if st == "red"]
    assert not reds, "\n".join(reds)
