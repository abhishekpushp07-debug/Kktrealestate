"""3I same-figures proof (read-only): dump every v3 report over a filter matrix, then diff two dumps.
python tools/equiv_3i.py dump kkt_volume out.json     (run once on the old code, once on the new)
python tools/equiv_3i.py diff a.json b.json"""

import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DROP = {"generated_at", "stamp", "took_ms", "request_id", "hours_left"}  # hours_left moves with the clock


def matrix(spec: dict, projects: list[str]) -> list[dict]:
    out = [{}]
    keys = {f["key"] for f in spec["filters"]}
    if spec.get("date_mode") == "as_of":
        out += [{"as_of": d} for d in ("2026-06-30", "2026-09-30", "2026-10-31")]
    if spec.get("date_mode") == "period" or "period" in keys:
        out += [
            {"period_from": "2026-04-01", "period_to": "2026-06-30"},
            {"period_from": "2025-04-01", "period_to": "2026-03-31"},
        ]
    if "include_cancelled" in keys:
        out += [{"include_cancelled": "true"}]
    out += [{"project": p} for p in projects[:2]] if "project" in keys else []
    for lv in [g["key"] for g in spec.get("groups", [])][:5]:
        out.append({"group": lv})
    return out


def clean(o):
    if isinstance(o, dict):  # rows compare as a set: rows tied on the sort key may come in either order
        return {
            k: sorted((clean(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, default=str))
            if k == "rows" and isinstance(v, list)
            else clean(v)
            for k, v in o.items()
            if k not in DROP
        }
    if isinstance(o, list):
        return [clean(x) for x in o]
    return o


async def dump(dbname: str, path: str):
    os.environ["DB_NAME"] = dbname
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=False)
    os.environ["DB_NAME"] = dbname
    logging.disable(logging.CRITICAL)
    import httpx

    from db import db
    from deps import create_access_token
    from reports_v3.registry import REGISTRY
    from server import app

    u = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0})
    projects = await db.projects.distinct("id", {"company_id": u["company_id"]})
    h = {"Authorization": f"Bearer {create_access_token(u)}"}
    res = {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://p", timeout=300) as c:
        for k, spec in REGISTRY.items():
            for q in matrix(spec, projects):
                r = await c.get(f"/api/reports/v3/{k}", headers=h, params=q | {"page_size": 100000})
                res[f"{k}?{json.dumps(q, sort_keys=True)}"] = [r.status_code, clean(r.json())]
    json.dump(res, open(path, "w"), default=str)
    print(len(res), "requests dumped")


def diff(a: str, b: str):
    A, B = clean(json.load(open(a))), clean(json.load(open(b)))
    bad = [k for k in sorted(set(A) | set(B)) if A.get(k) != B.get(k)]
    for k in bad[:20]:
        x, y = A.get(k), B.get(k)
        if x and y and isinstance(x[1], dict):
            ks = [f for f in set(x[1]) | set(y[1]) if x[1].get(f) != y[1].get(f)]
            print("DIFF", k, ks[:6])
        else:
            print("DIFF", k, "missing on one side")
    print(f"{len(A)} vs {len(B)} requests · {len(bad)} differences")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if sys.argv[1] == "dump":
        asyncio.run(dump(sys.argv[2], sys.argv[3]))
    else:
        diff(sys.argv[2], sys.argv[3])
