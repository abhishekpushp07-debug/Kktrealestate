"""CLI: back-fill Discount given (REQ-242) — exact only where the booking's own flat_snapshot list price exists, else
"discount not recorded". Idempotent; writes memory/qa/backfill_discount.md. Run: python tools/backfill_discount.py [--dry-run]"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from services.discount import backfill  # noqa: E402


async def main(dry: bool):
    cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
    name = os.environ["DB_NAME"]
    d = cl[name]
    money = ["agreement_value_paise", "cash_agreed_paise", "account_agreed_paise"]
    fp = lambda: d.bookings.aggregate(  # noqa: E731
        [{"$group": {"_id": None, **{k: {"$sum": f"${k}"} for k in money}, "n": {"$sum": 1}}}]
    ).to_list(1)
    before = await fp()
    out = await backfill(d, write=not dry)
    after = await fp()
    out["money_identical"] = before == after
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "memory/qa/backfill_discount.md"
    )
    with open(path, "a") as fh:
        fh.write(f"\n## {name}{' (dry run)' if dry else ''}\n\n{out}\n")
    print(out)


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
