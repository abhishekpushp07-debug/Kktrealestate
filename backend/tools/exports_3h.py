"""REQ-350 export proof: every report on the sheet exports to Excel and PDF (200, real file), and no money / date /
flat-code cell wraps in any PDF (tools/pdf_nowrap.py meter). Usage: python tools/exports_3h.py --base URL --out file.md"""

import argparse
import os
import sys
import tempfile

import httpx

sys.path.insert(0, "/app/backend")
from tools.pdf_nowrap import offenders  # noqa: E402


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--base", default="http://localhost:8001")
    a.add_argument("--out", required=True)
    x = a.parse_args()
    cl = httpx.Client(
        base_url=x.base + "/api",
        timeout=300,
        headers={"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")},
    )
    tok = cl.post("/auth/login", json={"email": "admin@kkt.in", "password": os.environ["DEMO_PASSWORD"]}).json()[
        "access_token"
    ]
    cl.headers["Authorization"] = f"Bearer {tok}"
    keys = [t["key"] for s in cl.get("/reports/v3").json()["segments"] for t in s["tiles"]]
    lines = ["| Report | Excel | PDF | PDF pages wrapped cells |", "|---|---|---|---:|"]
    bad = 0
    for k in keys:
        cells = []
        for fmt in ("xlsx", "pdf"):
            r = cl.get(f"/reports/v3/{k}/export.{fmt}")
            ok = r.status_code == 200 and len(r.content) > 500
            bad += not ok
            cells.append(f"{r.status_code} · {len(r.content) // 1024} KB")
            if fmt == "pdf" and ok:
                with tempfile.NamedTemporaryFile(suffix=".pdf") as fh:
                    fh.write(r.content)
                    fh.flush()
                    w = len(offenders(fh.name))
                bad += bool(w)
                cells.append(str(w))
        lines.append(f"| {k} | " + " | ".join(cells) + " |")
    head = [
        f"# Exports — {len(keys)} reports · `{os.environ.get('DB_NAME')}`",
        "",
        f"**{'PASS' if not bad else 'FAIL'}** — {bad} problems",
        "",
    ]
    open(x.out, "w").write("\n".join(head + lines) + "\n")
    print("\n".join(head))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
