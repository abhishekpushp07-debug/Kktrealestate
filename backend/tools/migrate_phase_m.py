"""CLI wrapper for the Phase M stage-plan migration (logic lives in services/stage_plan_migration.py).
Run: python tools/migrate_phase_m.py"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from services.stage_plan_migration import main  # noqa: E402

if __name__ == "__main__":
    asyncio.run(main())
