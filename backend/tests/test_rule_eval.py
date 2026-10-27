"""Safe alert-rule evaluator: whitelist grammar, injection attempts rejected at compile time, real rules file compiles."""
import os
import sys

import pytest
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.rule_eval import RuleSyntaxError, compile_rule

SNAP = {"requests": 50, "uptime_s": 1000, "rate_5xx": 0.03, "p95_ms": None, "shed_total": 0, "jobs_failed_24h": ["x"], "backup_age_h": None, "db_ok": True}


@pytest.mark.parametrize("expr,expected", [
    ("snap['requests'] == 0 and snap['uptime_s'] > 900", False),
    ("snap['requests'] >= 20 and snap['rate_5xx'] > 0.02", True),
    ("snap['requests'] >= 20 and (snap['p95_ms'] or 0) > 300", False),
    ("len(snap['jobs_failed_24h']) > 0", True),
    ("snap['backup_age_h'] is None or snap['backup_age_h'] > 26", True),
    ("not snap['db_ok']", False),
    ("snap.requests * 2 - 10 >= 90", True),
    ("max(snap['shed_total'], 1) == 1", True),
    ("'x' in snap['jobs_failed_24h']", True),
])
def test_allowed_grammar(expr, expected):
    assert compile_rule(expr)(SNAP) is expected


@pytest.mark.parametrize("expr", [
    "__import__('os').system('id')",
    "().__class__.__bases__[0].__subclasses__()",
    "snap.__class__",
    "open('/etc/passwd')",
    "[x for x in snap]",
    "lambda: 1",
    "snap['a'] if True else 2",
    "f'{snap}'",
    "len(snap, key=1)",
    "other['x'] > 1",
    "snap[1:2]",
    "snap['requests'] ** 10",
    "exec('1')",
    "import os",
    "",
])
def test_injection_rejected_at_compile(expr):
    with pytest.raises(RuleSyntaxError):
        compile_rule(expr)


def test_real_rules_compile_and_module_has_no_eval():
    with open(os.path.join(os.path.dirname(__file__), "..", "ops", "alerts.yaml")) as f:
        rules = yaml.safe_load(f)["rules"]
    assert rules
    for r in rules:
        compile_rule(r["condition"])
    with open(os.path.join(os.path.dirname(__file__), "..", "services", "alerts.py")) as fh:
        src = fh.read()
    assert "eval(" not in src and "exec(" not in src


def test_evaluate_reports_rule_error_not_crash():
    from services.alerts import evaluate
    out = evaluate([{"id": "bad", "severity": "critical", "source": "t", "message": "m", "condition": "snap['missing'] > 1"},
                    {"id": "inj", "severity": "critical", "source": "t", "message": "m", "condition": "__import__('os')"}], SNAP)
    assert [o["id"] for o in out] == ["bad", "inj"] and all(o["message"].startswith("rule error") for o in out)
