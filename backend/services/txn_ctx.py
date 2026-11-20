"""3I REQ-379: session discipline by construction. While a transaction is open, the active session lives in a
contextvar and every motor collection call made in that context gets it automatically (reads and writes: counters,
audit, read-model marks, money_rev, leases …) — no call site has to remember `session=`.
Not attached: handles with a non-primary read preference (derived read models; a transaction reads primary only) and
anything running after the transaction ended (background tasks that inherited the context).
Strict mode (KKT_TXN_STRICT=1, used by the replica-set suite): a call that explicitly passes session=None inside an open
transaction raises TxnSessionError instead of silently writing outside it."""

import os
from contextvars import ContextVar

SESSION: ContextVar = ContextVar("kkt_txn_session", default=None)
STRICT = os.environ.get("KKT_TXN_STRICT") == "1"
OPS = (
    "insert_one", "insert_many", "update_one", "update_many", "replace_one", "delete_one", "delete_many",
    "find_one_and_update", "find_one_and_replace", "find_one_and_delete", "bulk_write", "find_one", "find",
    "aggregate", "count_documents", "distinct",
)  # fmt: skip


class TxnSessionError(RuntimeError):
    code = "TXN_SESSION"


def active():
    s = SESSION.get()
    return s if s is not None and s.in_transaction else None


def _wrap(fn, name):
    def call(self, *a, **k):
        s = active()
        if s is not None and self.read_preference.mode == 0:
            if "session" not in k:
                k["session"] = s
            elif k["session"] is None and STRICT:
                raise TxnSessionError(f"{self.name}.{name} inside a transaction without its session")
        return fn(self, *a, **k)

    call.__name__ = name
    call.__wrapped__ = fn
    return call


def install():
    from motor.motor_asyncio import AsyncIOMotorCollection as C

    if getattr(C, "_kkt_txn_session", False):
        return
    for name in OPS:
        setattr(C, name, _wrap(getattr(C, name), name))
    C._kkt_txn_session = True
