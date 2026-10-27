"""Phase J.2 P0: memory must not scale with data size. Boots a worker against kkt_scale (6.6 M rows) and asserts idle RSS ≤ 250 MB after startup completes.
Skipped when kkt_scale is absent. Production limit is 512 MB."""
import os
import socket
import subprocess
import sys
import time

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

LIMIT_MB = 250


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def test_idle_rss_on_kkt_scale_under_limit():
    from pymongo import MongoClient
    cli = MongoClient(os.environ["MONGO_URL"])
    if "kkt_scale" not in cli.list_database_names() or cli["kkt_scale"].payments.estimated_document_count() < 500_000:
        pytest.skip("kkt_scale fixture absent (python tools/scale_seed.py)")
    port = _free_port()
    env = {**os.environ, "DB_NAME": "kkt_scale", "BACKUP_ENABLED": "0"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(port)], cwd=os.path.join(os.path.dirname(__file__), ".."), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 240
        phase = None
        while time.time() < deadline:
            try:
                j = requests.get(f"http://127.0.0.1:{port}/api/health", timeout=5).json()
                st = j.get("startup") or {}
                phase = st.get("phase") if isinstance(st, dict) else None
                if isinstance(st, dict) and st.get("done"):
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(3)
        time.sleep(5)
        rss_mb = int(open(f"/proc/{proc.pid}/statm").read().split()[1]) * 4096 / 1048576
        print(f"idle RSS on kkt_scale: {rss_mb:.0f} MB (phase={phase})")
        assert rss_mb <= LIMIT_MB, f"idle RSS {rss_mb:.0f} MB > {LIMIT_MB} MB on kkt_scale"
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
