from datetime import UTC, date, datetime

from db import db
from utils import next_number

DEFAULT_FORMATS = {
    "booking": "BK-{FY}-{SEQ}",
    "receipt": "{PREFIX}/{FY}/{SEQ}",
    "customer": "CUST-{FY}-{SEQ}",
    "demand": "DM-{FY}-{SEQ}",
    "lead": "LD-{FY}-{SEQ}",
}


def financial_year(d: date | None = None, start_month: int = 4) -> str:
    d = d or datetime.now(UTC).date()
    y = d.year if d.month >= start_month else d.year - 1
    return f"{str(y)[-2:]}{str(y + 1)[-2:]}"


async def company_settings(company_id: str) -> dict:
    return await db.companies.find_one({"id": company_id}, {"_id": 0}) or {}


async def generate_number(kind: str, company: dict, on: date | None = None, pad: int = 4) -> str:
    fy = financial_year(on, company.get("financial_year_start_month") or 4)
    fmt = company.get(f"{kind}_number_format") or DEFAULT_FORMATS[kind]
    seq = await next_number(f"{kind}_number", fy)
    return fmt.replace("{FY}", fy).replace("{PREFIX}", company.get("receipt_prefix") or "RC").replace("{SEQ}", str(seq).zfill(pad))
