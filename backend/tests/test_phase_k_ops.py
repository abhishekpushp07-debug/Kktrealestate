"""Phase K.12/13 proofs: backup + restore drill end-to-end on the test DB; alert rules with synthetic snapshots."""
import asyncio
import os
import sys
import tempfile

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402



def test_backup_manifest_and_restore_drill_records_job_run():
    from tools.backup import run_backup
    out = tempfile.mkdtemp()
    m = run_backup(out)
    assert m["sha256"] and m["bytes"] > 1000 and os.path.exists(os.path.join(out, m["archive"]))
    import json
    import subprocess
    proc = subprocess.run([sys.executable, "-c", f"import asyncio, json, sys\nsys.path.insert(0, '.')\nfrom tools.restore_drill import drill_job\nprint(json.dumps(asyncio.run(drill_job({os.path.join(out, m['archive'])!r}, scratch='kkt_restore_drill_test')), default=str))"],
                          cwd=os.path.join(os.path.dirname(__file__), ".."), capture_output=True, text=True, timeout=240, env={**os.environ})
    assert proc.returncode == 0, proc.stderr[-2000:]
    run = json.loads(proc.stdout.strip().splitlines()[-1])
    assert run["status"] == "OK", run
    assert run["result"]["verify"]["ledger_totals_match"] is True
    assert run["result"]["verify"]["mismatches"] == []
    from pymongo import MongoClient
    MongoClient(os.environ["MONGO_URL"]).drop_database("kkt_restore_drill_test")


def test_ops_has_backup_and_alerts_cards(admin_headers):
    j = requests.get(f"{BASE}/api/admin/ops", headers=admin_headers).json()
    assert "backup" in j and "stale" in j["backup"] and "alerts" in j and "firing" in j["alerts"]


def test_each_alert_rule_fires_on_synthetic_data():
    from services.alerts import evaluate, load_rules
    rules = load_rules()
    quiet = {"uptime_s": 100, "requests": 100, "rate_5xx": 0.0, "p95_ms": 50, "shed_total": 0, "login_failures_15m": 0, "jobs_failed_24h": [], "jobs_stale": [], "integrity_findings": 0, "backup_age_h": 1.0, "db_ok": True}
    assert evaluate(rules, quiet) == []
    triggers = {"api_down": {"requests": 0, "uptime_s": 1000}, "http_5xx_rate": {"rate_5xx": 0.05}, "p95_latency": {"p95_ms": 900}, "load_shedding": {"shed_total": 3},
                "login_failure_spike": {"login_failures_15m": 40}, "job_failed": {"jobs_failed_24h": ["DAILY_DUES"]}, "job_stale": {"jobs_stale": ["DAILY_DUES"]},
                "integrity_findings": {"integrity_findings": 2}, "backup_stale": {"backup_age_h": 30}, "db_down": {"db_ok": False}}
    assert {r["id"] for r in rules} == set(triggers)
    for rid, patch in triggers.items():
        firing = {f["id"] for f in evaluate(rules, {**quiet, **patch})}
        assert firing == {rid}, (rid, firing)
    assert {f["id"] for f in evaluate(rules, {**quiet, "backup_age_h": None})} == {"backup_stale"}
