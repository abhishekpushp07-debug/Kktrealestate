"""Build the MEDIUM data profile: a private copy of the demo DB (story personas — cancellations, transfers, swaps,
bounces, every waiver state, discounts, holds, parking, other-charge parts, leads/visits/follow-ups) topped up through the
real API by the volume seeder to ~500 live bookings. Never touches the demo DB itself or project YE.
Run: python tools/medium_profile.py   (copies, starts a private backend on :8002, seeds, runs integrity)"""

import os
import subprocess
import sys
import time

import httpx
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
SRC, DST, PORT = os.environ["DB_NAME"], "kkt_medium", 8002


def copy():
    """Streams mongodump → mongorestore (the old find()-into-RAM copy died on 400k audit rows and left a partial DB)."""
    url = os.environ["MONGO_URL"]
    MongoClient(url).drop_database(DST)
    dump = subprocess.Popen(["mongodump", f"--uri={url}", f"--db={SRC}", "--archive", "--quiet"], stdout=subprocess.PIPE)
    subprocess.run(["mongorestore", f"--uri={url}", "--archive", f"--nsFrom={SRC}.*", f"--nsTo={DST}.*", "--quiet"], stdin=dump.stdout, check=True)
    dump.wait()
    print("copied", SRC, "→", DST, len(MongoClient(url)[DST].list_collection_names()), "collections")


def main():
    copy()
    env = {**os.environ, "DB_NAME": DST}
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--port", str(PORT), "--log-level", "warning"], cwd=here, env=env)
    try:
        for _ in range(90):
            try:
                if httpx.get(f"http://127.0.0.1:{PORT}/api/health", timeout=2).status_code < 500:
                    break
            except httpx.HTTPError:
                time.sleep(1)
        r = subprocess.run([sys.executable, "tools/volume_seed.py", "--base", f"http://127.0.0.1:{PORT}", "--db", DST, "--scale", "0.33", "--skip-projects", "YE"], cwd=here, env=env)
        print("seed rc", r.returncode)
    finally:
        proc.kill()
    db = MongoClient(os.environ["MONGO_URL"])[DST]
    print("medium:", {k: db[k].count_documents(q) for k, q in (("bookings", {"status": {"$in": ["Active", "Completed"]}}), ("payments", {}), ("leads", {}), ("site_visits", {}))})


if __name__ == "__main__":
    main()
