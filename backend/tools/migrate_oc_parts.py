"""CLI: back-fill other-charge parts with bill + due dates (REQ-210). Run: python tools/migrate_oc_parts.py [--dry-run]"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from services.oc_parts_migration import migrate  # noqa: E402

if __name__ == "__main__":
    out = asyncio.run(migrate(dry_run="--dry-run" in sys.argv))
    print({k: (len(v) if isinstance(v, list) else v) for k, v in out.items()})
