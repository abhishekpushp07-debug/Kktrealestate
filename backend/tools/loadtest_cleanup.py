"""Phase L3 — purge load-test lineage via the guarded endpoint.  python tools/loadtest_cleanup.py --base https://<host> --confirm PURGE [--dry-run]"""
import argparse
import json
import os
import sys

import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--confirm", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--email", default=os.environ.get("LT_ADMIN_EMAIL", "admin@kkt.in"))
    ap.add_argument("--password", default=os.environ.get("LT_ADMIN_PASSWORD", "Kkt@12345"))
    a = ap.parse_args()
    if a.confirm != "PURGE":
        sys.exit("refusing: --confirm PURGE required")
    base = a.base.rstrip("/")
    s = requests.Session()
    s.headers["X-Rate-Limit-Bypass"] = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")
    r = s.post(f"{base}/api/auth/login", json={"email": a.email, "password": a.password}, timeout=30)
    r.raise_for_status()
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    lin = s.get(f"{base}/api/admin/load-test/lineage", timeout=60).json()
    print("lineage:", json.dumps(lin))
    r = s.post(f"{base}/api/admin/load-test/purge", json={"confirm": "PURGE", "dry_run": a.dry_run}, timeout=600)
    print(f"purge → {r.status_code}", json.dumps(r.json(), indent=1)[:1500])
    r.raise_for_status()
    if not a.dry_run:
        ir = s.get(f"{base}/api/admin/integrity-report?fresh=1", timeout=300).json()
        print("integrity ok:", ir.get("ok"), ir.get("counts"))
        after = s.get(f"{base}/api/admin/load-test/lineage", timeout=60).json()
        print("lineage after:", json.dumps(after))
        sys.exit(0 if ir.get("ok") and after["projects"] == 0 else 1)


if __name__ == "__main__":
    main()
