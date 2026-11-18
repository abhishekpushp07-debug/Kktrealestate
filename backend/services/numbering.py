from datetime import date

from db import db
from services import clock
from utils import next_number

DEFAULT_FORMATS = {
    "booking": "BK-{FY}-{SEQ}",
    "refund": "RF-{FY}-{SEQ}",
    "receipt": "{PREFIX}/{FY}/{SEQ}",
    "customer": "CUST-{FY}-{SEQ}",
    "demand": "DM-{FY}-{SEQ}",
    "lead": "LD-{FY}-{SEQ}",
    "waiver": "WV-{FY}-{SEQ}",
    "credit_note": "CN-{FY}-{SEQ}",
}


def financial_year(d: date | None = None, start_month: int = 4) -> str:
    d = d or clock.today()
    y = d.year if d.month >= start_month else d.year - 1
    return f"{str(y)[-2:]}{str(y + 1)[-2:]}"


async def company_settings(company_id: str) -> dict:
    return await db.companies.find_one({"id": company_id}, {"_id": 0}) or {}


def _fmt(kind: str, company: dict, fy: str, seq: int, pad: int) -> str:
    fmt = company.get(f"{kind}_number_format") or DEFAULT_FORMATS[kind]
    return (
        fmt.replace("{FY}", fy)
        .replace("{PREFIX}", company.get("receipt_prefix") or "RC")
        .replace("{SEQ}", str(seq).zfill(pad))
    )


async def generate_number(kind: str, company: dict, on: date | None = None, pad: int = 4) -> str:
    fy = financial_year(on, company.get("financial_year_start_month") or 4)
    return _fmt(kind, company, fy, await next_number(f"{kind}_number", fy), pad)


async def generate_numbers(kind: str, company: dict, dates: list[date], pad: int = 4) -> list[str]:
    """The numbers len(dates) generate_number calls in this order would give, with one counter write per FY (REQ-211)."""
    fys = [financial_year(d, company.get("financial_year_start_month") or 4) for d in dates]
    nxt = {}
    for fy in dict.fromkeys(fys):
        n = fys.count(fy)
        nxt[fy] = await next_number(f"{kind}_number", fy, n) - n + 1
    out = []
    for fy in fys:
        out.append(_fmt(kind, company, fy, nxt[fy], pad))
        nxt[fy] += 1
    return out
