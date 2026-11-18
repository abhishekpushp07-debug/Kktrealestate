"""Request-scoped 'as-of' clock. Normally real time; the story seeder (Super Admin + SEEDER_AS_OF_ENABLED=true + X-As-Of header)
replays history so timestamps, due dates, ageing and numbering are historically correct. Every audit row written under an
as-of carries `as_of` so the replay is auditable.

Business day (REQ-60…64): every server-side "today" / as-of / default entry date comes from `today()` in the company time zone
(`companies.time_zone`, default Asia/Kolkata; the calendar day changes at 00:00 local). Stored timestamps stay UTC; use
`day_of()` to read their business date and `day_start_utc()` / `day_end_utc()` / `day_range()` to filter them by day."""

import os
from contextvars import ContextVar
from datetime import UTC, date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_TZ = "Asia/Kolkata"
_BUSINESS_TZ = {"tz": ZoneInfo(DEFAULT_TZ)}
AS_OF: ContextVar[datetime | None] = ContextVar("as_of", default=None)
REQ_CTX: ContextVar[dict | None] = ContextVar("req_ctx", default=None)


def enabled() -> bool:
    return os.environ.get("SEEDER_AS_OF_ENABLED", "false").lower() in ("1", "true", "yes")


def set_business_tz(name: str | None) -> None:
    """Company time zone (one company today; Phase 4 makes this per company)."""
    _BUSINESS_TZ["tz"] = ZoneInfo(name or DEFAULT_TZ)


def business_tz() -> ZoneInfo:
    return _BUSINESS_TZ["tz"]


def set_as_of(value: str | None):
    if not value:
        return AS_OF.set(None)
    v = value.strip()
    dt = datetime.fromisoformat(v) if "T" in v else datetime.combine(date.fromisoformat(v), time(10, 30), tzinfo=IST)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return AS_OF.set(dt.astimezone(UTC))


def now(tz=UTC) -> datetime:
    a = AS_OF.get()
    return (a or datetime.now(UTC)).astimezone(tz) if tz is not None else (a or datetime.now(UTC)).replace(tzinfo=None)


def today() -> date:
    """The business day: the company-time-zone calendar date of now (or of the as-of)."""
    return now(business_tz()).date()


def today_iso() -> str:
    return today().isoformat()


def _as_date(d: date | str | None) -> date:
    if d is None:
        return today()
    return date.fromisoformat(d[:10]) if isinstance(d, str) else d


def day_of(ts: str | datetime | None) -> str | None:
    """Business date (YYYY-MM-DD) of a stored timestamp; a plain date string is returned unchanged."""
    if not ts:
        return None
    if isinstance(ts, str):
        if len(ts) <= 10:
            return ts
        ts = datetime.fromisoformat(ts)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(business_tz()).date().isoformat()


def day_start_utc(d: date | str | None = None) -> str:
    """UTC ISO timestamp of 00:00 business time on day d (inclusive lower bound for stored UTC timestamps)."""
    return datetime.combine(_as_date(d), time(0), tzinfo=business_tz()).astimezone(UTC).isoformat()


def day_end_utc(d: date | str | None = None) -> str:
    """UTC ISO timestamp of the last microsecond of business day d (inclusive upper bound)."""
    nxt = datetime.combine(_as_date(d) + timedelta(days=1), time(0), tzinfo=business_tz()).astimezone(UTC)
    return (nxt - timedelta(microseconds=1)).isoformat()


def day_range(d1: date | str | None, d2: date | str | None = None) -> dict:
    """Mongo range over a stored UTC timestamp field covering business days d1…d2 (each side optional)."""
    rng = {}
    if d1:
        rng["$gte"] = day_start_utc(d1)
    if d2 or d1:
        rng["$lte"] = day_end_utc(d2 or d1)
    return rng


def to_utc_iso(dt: datetime | None) -> str | None:
    """A user-supplied instant stored as UTC ISO (a naive value is read as business time)."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=business_tz())).astimezone(UTC).isoformat()


def as_of_iso() -> str | None:
    a = AS_OF.get()
    return a.isoformat() if a else None
