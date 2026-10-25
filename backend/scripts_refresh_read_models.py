import asyncio
import sys
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from db import db
from services import read_models as rm


async def main():
    for p in await db.projects.find({}, {"_id": 0, "id": 1}).to_list(None):
        await rm.refresh_project(p["id"])
    await rm.refresh_dashboards()
    print("read models refreshed")

asyncio.run(main())
