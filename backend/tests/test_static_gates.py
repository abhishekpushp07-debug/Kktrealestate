"""Static quality gates run as part of the suite (Phase CR-4/CR-9): ruff F821/F841/B (undefined/unused/bugbear) and C901 complexity ≤ 25
on runtime code; eval/exec/pickle/yaml.load/md5 never reappear."""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RUNTIME = ["server.py", "deps.py", "utils.py", "events.py", "infra.py", "db.py", "core", "routers", "services", "security", "permissions.py",
           "event_registry.py", "uow.py", "storage.py", "crypto.py", "dbtiming.py", "errors.py", "migrate_phase7.py", "migrate_phase_g.py", "seed.py"]


def _ruff(*args) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "ruff", "check", "--output-format", "concise", *args], cwd=ROOT, capture_output=True, text=True)


def test_ruff_undefined_unused_bugbear_whole_backend():
    r = _ruff("--select", "F821,F841,F811,B002,B006,B015,B018,B020,B023,B032", ".")
    assert r.returncode == 0, r.stdout[-3000:]


def test_ruff_complexity_runtime_code():
    r = _ruff("--select", "C901", "--config", "lint.mccabe.max-complexity=25", *RUNTIME)
    assert r.returncode == 0, r.stdout[-3000:]


def test_no_dynamic_code_execution_or_weak_hash():
    pat = re.compile(r"(?<![\w.])(eval|exec)\(|pickle\.loads|yaml\.load\(|hashlib\.md5|\bmd5\(")
    hits = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in ("tests", "venv", ".venv", "__pycache__", "node_modules")]
        for f in fn:
            if f.endswith(".py"):
                p = os.path.join(dp, f)
                with open(p) as fh:
                    for i, line in enumerate(fh, 1):
                        if pat.search(line):
                            hits.append(f"{os.path.relpath(p, ROOT)}:{i}: {line.strip()[:100]}")
    assert hits == [], hits
