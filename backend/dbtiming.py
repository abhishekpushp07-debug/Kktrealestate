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
