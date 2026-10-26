"""Request-scoped 'as-of' clock. Normally real time; the story seeder (Super Admin + SEEDER_AS_OF_ENABLED=true + X-As-Of header)
replays history so timestamps, due dates, ageing and numbering are historically correct. Every audit row written under an
as-of carries `as_of` so the replay is auditable."""
import os
from contextvars import ContextVar
from datetime import UTC, date, datetime, time, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
AS_OF: ContextVar[datetime | None] = ContextVar("as_of", default=None)
REQ_CTX: ContextVar[dict | None] = ContextVar("req_ctx", default=None)


def enabled() -> bool:
    return os.environ.get("SEEDER_AS_OF_ENABLED", "false").lower() in ("1", "true", "yes")


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
    return now(IST).date()


def as_of_iso() -> str | None:
    a = AS_OF.get()
    return a.isoformat() if a else None
