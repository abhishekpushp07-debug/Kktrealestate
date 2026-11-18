"""CR-2 A1: no dynamic code execution in backend source. `asyncio.create_subprocess_exec` (fixed-script subprocess) is allowed."""

import os
import re
from pathlib import Path

ROOT = os.path.join(os.path.dirname(__file__), "..")
CALL = re.compile(r"(?<![\w.])(eval|exec)\s*\(")


def test_no_eval_exec_in_backend():
    hits = []
    for dirpath, dirs, files in os.walk(ROOT):
        dirs[:] = [
            d for d in dirs if d not in ("tests", "e1_tests", "__pycache__", "node_modules", ".git", "venv", ".venv")
        ]
        for f in files:
            if f.endswith(".py"):
                p = os.path.join(dirpath, f)
                for i, line in enumerate(Path(p).read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if CALL.search(line) and "create_subprocess_exec" not in line:
                        hits.append(f"{os.path.relpath(p, ROOT)}:{i}: {line.strip()[:100]}")
    assert hits == [], hits
