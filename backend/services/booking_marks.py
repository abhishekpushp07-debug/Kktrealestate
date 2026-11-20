"""3I REQ-355: a booking's change marker, kept by every save — the ledger rebuild moves `ledger_rev`, every bill write
outside it moves `money_rev`, every booking update moves `version` / `updated_at`. A per-booking figure computed
while the marker was M is still right while the marker is M, on every server (the marker lives in the database)."""

from collections import OrderedDict

PROJ = {"_id": 0, "id": 1, "ledger_rev": 1, "money_rev": 1, "version": 1, "updated_at": 1}


def mark(b: dict) -> tuple:
    return (b.get("ledger_rev"), b.get("money_rev"), b.get("version"), b.get("updated_at"))


class Memo:
    """Bounded per-process {key: (marker, value)}; a value is reused only under the very marker it was computed at."""

    def __init__(self, max_entries: int = 50000):
        self._d: OrderedDict = OrderedDict()
        self._max = max_entries

    def get(self, key, marker):
        hit = self._d.get(key)
        return hit[1] if hit is not None and hit[0] == marker else None

    def put(self, key, marker, value):
        self._d[key] = (marker, value)
        self._d.move_to_end(key)
        while len(self._d) > self._max:
            self._d.popitem(last=False)

    def clear(self):
        self._d.clear()
