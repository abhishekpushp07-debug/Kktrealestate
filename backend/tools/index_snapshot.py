"""Dump the index set produced by db.ensure_indexes() on a scratch database → docs/index_snapshot.json (CR-2 C9 refactor guard)."""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
SNAPSHOT = os.path.join(os.path.dirname(__file__), "..", "docs", "index_snapshot.json")
SCRATCH = "kkt_index_snapshot_scratch"


async def build() -> dict:
    import db as dbmod
    client = dbmod.client
    await client.drop_database(SCRATCH)
    real = dbmod.db
    dbmod.db = client[SCRATCH]
    try:
        await dbmod.ensure_indexes()
        out = {}
        for name in sorted(await dbmod.db.list_collection_names()):
            info = await dbmod.db[name].index_information()
            for iname, spec in sorted(info.items()):
                if iname == "_id_":
                    continue
                out[f"{name}.{iname}"] = {"key": [[k, v if isinstance(v, (int, str)) else str(v)] for k, v in spec["key"]],
                                          **{k: spec[k] for k in ("unique", "expireAfterSeconds", "partialFilterExpression", "sparse") if k in spec}}
        return out
    finally:
        dbmod.db = real
        await client.drop_database(SCRATCH)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    snap = asyncio.run(build())
    if "--write" in sys.argv:
        json.dump(snap, open(SNAPSHOT, "w"), indent=1, sort_keys=True)
        print("wrote", SNAPSHOT, len(snap), "indexes")
    else:
        print(json.dumps(snap, indent=1, sort_keys=True)[:2000])
