"""3I: a hung object-storage connection is retried inside the request budget (never held until the 60 s cut-off)."""

import socket
import threading
import time

import pytest
import requests

import storage


def test_small_put_hung_storage_retries_within_request_budget(monkeypatch):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(10)
    conns = []
    threading.Thread(target=lambda: [conns.append(s.accept()) for _ in range(5)], daemon=True).start()
    monkeypatch.setattr(storage, "STORAGE_URL", f"http://127.0.0.1:{s.getsockname()[1]}")
    monkeypatch.setattr(storage, "REQUEST_BUDGET_S", 30.0)
    monkeypatch.setitem(storage._state, "key", "k")
    t = time.monotonic()
    with pytest.raises(requests.Timeout):
        storage._put("a/b.pdf", b"%PDF-1.4\n%EOF", "application/pdf")
    took = time.monotonic() - t
    s.close()
    assert len(conns) == 3, conns
    assert took < 30.0 - 5, took
