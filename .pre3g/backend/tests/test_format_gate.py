"""Phase 1 F-1 format gate: ruff format + import order (backend), Prettier (frontend/src), no source line > 160 chars."""

import os
import subprocess
import sys
import tempfile

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(BACKEND, "..", "frontend")
PRETTIER = os.path.join(FRONTEND, "node_modules", ".bin", "prettier")
MAX_LINE = 160
VENDOR = ("frontend/build/", "node_modules/", "e1_tests/")  # e1_tests: tester-owned (same exclusion as ruff.toml)


def _run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def _tracked(cwd, *patterns):
    out = _run(["git", "ls-files", *patterns], cwd).stdout.split()
    return [os.path.join(cwd, p) for p in out if not any(v in p for v in VENDOR)]


def test_backend_ruff_format_clean():
    r = _run([sys.executable, "-m", "ruff", "format", "--check", "."], BACKEND)
    assert r.returncode == 0, r.stdout[-2000:]


def test_backend_imports_sorted():
    r = _run([sys.executable, "-m", "ruff", "check", "--select", "I", "--output-format", "concise", "."], BACKEND)
    assert r.returncode == 0, r.stdout[-2000:]


def test_frontend_prettier_clean():
    r = _run([PRETTIER, "--check", "src"], FRONTEND)
    assert r.returncode == 0, (r.stdout + r.stderr)[-2000:]


def test_no_source_line_over_160_chars():
    files = _tracked(BACKEND, "*.py") + [
        f for f in _tracked(FRONTEND, "src") if f.endswith((".js", ".jsx", ".ts", ".tsx", ".css"))
    ]
    long = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            long += [
                f"{os.path.relpath(f, BACKEND)}:{i}" for i, ln in enumerate(fh, 1) if len(ln.rstrip("\n")) > MAX_LINE
            ]
    assert not long, f"{len(long)} lines > {MAX_LINE} chars: {long[:20]}"


def test_no_stray_file_names():
    """A `sed 's#…#…  # written …#'` once wrote `backend/ritten by …#` via sed's `w` flag; tracked names stay shell-safe."""
    import re

    names = _run(["git", "ls-files", "--", ".."], BACKEND).stdout.splitlines()
    bad = [n for n in names if not re.fullmatch(r"[A-Za-z0-9_./@+\-\[\]]+", n)]
    assert not bad, bad


def test_gate_fails_on_unformatted_files():
    with tempfile.TemporaryDirectory() as d:
        py, js = os.path.join(d, "bad.py"), os.path.join(d, "bad.js")
        with open(py, "w") as fh:
            fh.write("x = {  'a':1 }\n")
        with open(js, "w") as fh:
            fh.write("const  x = {a:1}\n")
        assert _run([sys.executable, "-m", "ruff", "format", "--check", py], BACKEND).returncode != 0
        assert _run([PRETTIER, "--check", js], FRONTEND).returncode != 0
