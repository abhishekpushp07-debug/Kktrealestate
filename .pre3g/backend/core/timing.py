"""Per-request timing spans, emitted in the Server-Timing header by ObservabilityMiddleware (REQ-111 profiling)."""

import time
from contextlib import contextmanager
from contextvars import ContextVar

SPANS: ContextVar[dict | None] = ContextVar("kkt_spans", default=None)


@contextmanager
def span(name: str):
    acc = SPANS.get()
    if acc is None:
        yield
        return
    t0 = time.perf_counter()
    try:
        yield
    finally:
        acc[name] = acc.get(name, 0.0) + (time.perf_counter() - t0) * 1000


def header(acc: dict) -> str:
    return "".join(f", {k};dur={v:.1f}" for k, v in sorted(acc.items(), key=lambda kv: -kv[1])[:12])


class Laps:
    """Sequential laps: laps("x") records the time since the previous lap as span "<prefix>_x"."""

    def __init__(self, prefix: str):
        self.prefix, self.t = prefix, time.perf_counter()

    def __call__(self, name: str):
        acc, now = SPANS.get(), time.perf_counter()
        if acc is not None:
            k = f"{self.prefix}_{name}"
            acc[k] = acc.get(k, 0.0) + (now - self.t) * 1000
        self.t = now
