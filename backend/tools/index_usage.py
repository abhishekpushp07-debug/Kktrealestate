"""3I M-05 (read-only): list prefix-duplicate indexes and indexes with 0 uses since the last mongod restart ($indexStats).
Lists only — never drops (owner: drop after a 7-day window on live).  python tools/index_usage.py test_database OUT.md"""

import os
import sys

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URL"])[sys.argv[1]]
lines = [
    f"# Index usage — {sys.argv[1]} (list only, nothing dropped)",
    "",
    "| Collection | Index | Uses | Note |",
    "|---|---|---|---|",
]
for c in sorted(db.list_collection_names()):
    if c.startswith("system."):
        continue
    stats = {s["name"]: s["accesses"]["ops"] for s in db[c].aggregate([{"$indexStats": {}}])}
    info = db[c].index_information()
    keys = {n: [k for k, _ in v["key"]] for n, v in info.items()}
    for n, k in keys.items():
        if n == "_id_":
            continue
        dup = [
            m
            for m, mk in keys.items()
            if m != n and mk[: len(k)] == k and len(mk) > len(k) and not info[n].get("unique")
        ]
        note = f"prefix of {dup[0]}" if dup else ""
        if stats.get(n, 0) == 0 or dup:
            lines.append(f"| {c} | {n} | {stats.get(n, 0)} | {note or 'unused since restart'} |")
open(sys.argv[2], "w").write("\n".join(lines) + "\n")
print(len(lines) - 4, "indexes listed")
