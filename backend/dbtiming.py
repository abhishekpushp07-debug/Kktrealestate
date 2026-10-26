"""Per-request Mongo time (for the Server-Timing header) via a pymongo CommandListener + contextvar."""
from contextvars import ContextVar

from pymongo import monitoring

DB_MS: ContextVar[list] = ContextVar("db_ms", default=None)


class DbTimingListener(monitoring.CommandListener):
    def started(self, event):
        pass

    def succeeded(self, event):
        acc = DB_MS.get()
        if acc is not None:
            acc[0] += event.duration_micros / 1000
            acc[1] += 1

    def failed(self, event):
        self.succeeded(event)


POOL_STATS = {"checked_out": 0, "created": 0, "closed": 0, "checkout_failed": 0, "wait_queue_timeouts": 0}


class PoolListener(monitoring.ConnectionPoolListener):
    """Live pool counters for /api/admin/ops."""

    def connection_created(self, event):
        POOL_STATS["created"] += 1

    def connection_closed(self, event):
        POOL_STATS["closed"] += 1

    def connection_checked_out(self, event):
        POOL_STATS["checked_out"] += 1

    def connection_checked_in(self, event):
        POOL_STATS["checked_out"] = max(0, POOL_STATS["checked_out"] - 1)

    def connection_check_out_failed(self, event):
        POOL_STATS["checkout_failed"] += 1
        if "timeout" in str(getattr(event, "reason", "")).lower():
            POOL_STATS["wait_queue_timeouts"] += 1

    def pool_created(self, event):
        pass

    def pool_ready(self, event):
        pass

    def pool_cleared(self, event):
        pass

    def pool_closed(self, event):
        pass

    def connection_ready(self, event):
        pass

    def connection_check_out_started(self, event):
        pass
