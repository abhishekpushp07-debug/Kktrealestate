import asyncio
import functools
import logging
import random
from contextlib import asynccontextmanager
from contextvars import ContextVar

from pymongo.errors import PyMongoError

from db import client
from services import txn_ctx

logger = logging.getLogger("kkt.uow")
STATE = {"transactions": False, "mode": "ordered-writes+compensation"}
TXN_ATTEMPTS = 4
_COMMITTED: ContextVar = ContextVar("kkt_txn_committed", default=None)  # set per transactional() attempt


async def detect_transaction_support():
    try:
        hello = await client.admin.command("hello")
        STATE["transactions"] = bool(hello.get("setName")) or hello.get("msg") == "isdbgrid"
    except Exception:
        logging.getLogger(__name__).debug("handled error", exc_info=True)
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


async def _commit(s):
    """The commit is retried on UnknownTransactionCommitResult (commit is idempotent for the same transaction)."""
    for attempt in range(TXN_ATTEMPTS):
        try:
            await s.commit_transaction()
            return
        except PyMongoError as e:
            if attempt == TXN_ATTEMPTS - 1 or not e.has_error_label("UnknownTransactionCommitResult"):
                raise
            await asyncio.sleep(random.uniform(0.01, 0.05) * (attempt + 1))


@asynccontextmanager
async def unit_of_work():
    uow = UnitOfWork()
    if STATE["transactions"]:
        outer = txn_ctx.active()
        if outer is not None:  # nested: join the open transaction
            uow.session = outer
            yield uow
            return
        async with await client.start_session() as s:
            uow.session = s
            tok = txn_ctx.SESSION.set(s)
            try:
                s.start_transaction()
                try:
                    yield uow
                except BaseException:
                    if s.in_transaction:
                        await s.abort_transaction()
                    raise
                await _commit(s)
                flag = _COMMITTED.get()
                if flag is not None:
                    flag[0] = True
            finally:
                txn_ctx.SESSION.reset(tok)
        return
    try:
        yield uow
    except Exception:
        await uow.compensate()
        raise


def _merge(outer: dict, mine: dict):
    for key, (fn, items) in mine.items():
        prev = outer.pop(key, None)
        outer[key] = (fn, (prev[1] if prev else []) + items)


def transactional(fn):
    """3I REQ-379: the one transaction runner for multi-write flows. The whole callback is retried (bounded, jittered)
    when its transaction aborts on a transient conflict, but never once a transaction of it committed. Follow-up work
    (letters, notifications, snapshots …) queued by an attempt fires only after that attempt succeeded — an aborted
    attempt's queue is dropped, so a retry never doubles anything."""
    from services import after_commit

    @functools.wraps(fn)
    async def run(*a, **k):
        outer = after_commit.PENDING.get()
        for attempt in range(TXN_ATTEMPTS):
            mine, committed = {}, [False]
            ptok, ctok = after_commit.PENDING.set(mine), _COMMITTED.set(committed)
            try:
                res = await fn(*a, **k)
            except PyMongoError as e:
                retry = (
                    attempt < TXN_ATTEMPTS - 1
                    and not committed[0]
                    and txn_ctx.active() is None
                    and e.has_error_label("TransientTransactionError")
                )
                if not retry:
                    raise
                logger.info("transaction conflict in %s, retry %d", fn.__name__, attempt + 1)
                await asyncio.sleep(random.uniform(0.02, 0.06) * (2**attempt))
                continue
            finally:
                after_commit.PENDING.reset(ptok)
                _COMMITTED.reset(ctok)
            if outer is not None:
                _merge(outer, mine)
            else:
                for f, items in mine.values():
                    await f(items)
            return res

    return run


async def guarded_update(coll, filter_: dict, update: dict, uow: UnitOfWork | None = None):
    """find_one_and_update with precondition filter; returns None when precondition fails."""
    return await coll.find_one_and_update(
        filter_, update, projection={"_id": 0}, return_document=True, **(uow.kw() if uow else {})
    )
