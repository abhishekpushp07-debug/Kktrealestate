import logging
from contextlib import asynccontextmanager

from db import client

logger = logging.getLogger("kkt.uow")
STATE = {"transactions": False, "mode": "ordered-writes+compensation"}


async def detect_transaction_support():
    try:
        hello = await client.admin.command("hello")
        STATE["transactions"] = bool(hello.get("setName")) or hello.get("msg") == "isdbgrid"
    except Exception:
        STATE["transactions"] = False
    STATE["mode"] = "multi-document-transaction" if STATE["transactions"] else "ordered-writes+compensation"
    logger.info("UoW mode: %s", STATE["mode"])


class UnitOfWork:
    """Transaction when available; otherwise ordered writes with registered compensations run on failure."""

    def __init__(self):
        self.session = None
        self._compensations = []

    def on_rollback(self, coro_factory):
        self._compensations.append(coro_factory)

    def kw(self) -> dict:
        return {"session": self.session} if self.session else {}

    async def compensate(self):
        for c in reversed(self._compensations):
            try:
                await c()
            except Exception:
                logger.exception("compensation failed")


@asynccontextmanager
async def unit_of_work():
    uow = UnitOfWork()
    if STATE["transactions"]:
        async with await client.start_session() as s:
            uow.session = s
            async with s.start_transaction():
                yield uow
        return
    try:
        yield uow
    except Exception:
        await uow.compensate()
        raise


async def guarded_update(coll, filter_: dict, update: dict, uow: UnitOfWork | None = None):
    """find_one_and_update with precondition filter; returns None when precondition fails."""
    return await coll.find_one_and_update(filter_, update, projection={"_id": 0}, return_document=True, **(uow.kw() if uow else {}))
