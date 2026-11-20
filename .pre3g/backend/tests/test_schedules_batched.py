"""H1: upcoming-dues / Home widget schedules — bounded query count (no per-booking block/demand queries), same rows as the naive loop."""

import asyncio
import math

import services.dues_engine as de


class _Cur:
    def __init__(self, rows):
        self.rows = rows

    def batch_size(self, _n):
        return self

    def __aiter__(self):
        self._it = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None


class _Coll:
    def __init__(self, rows, key, calls, name):
        self.rows, self.key, self.calls, self.name = rows, key, calls, name

    def find(self, q=None, _proj=None):
        self.calls[self.name] = self.calls.get(self.name, 0) + 1
        q = q or {}
        if self.key in q and isinstance(q[self.key], dict):
            want = set(q[self.key]["$in"])
            return _Cur([r for r in self.rows if r[self.key] in want])
        return _Cur(list(self.rows))

    async def find_one(self, *_a, **_k):
        raise AssertionError(f"per-row find_one on {self.name}")


def _fixture(n_bookings=1201, n_blocks=3):
    plan = {
        "installments": [
            {"seq": 1, "name": "Booking", "percent": 10, "trigger_type": "ON_BOOKING", "trigger_days": 0},
            {"seq": 2, "name": "Plinth", "percent": 20, "trigger_type": "ON_STAGE", "trigger_stage_id": "st1"},
            {"seq": 3, "name": "Possession", "percent": 70, "trigger_type": "ON_POSSESSION"},
        ]
    }
    bookings = [
        {
            "id": f"bk{i}",
            "block_id": f"blk{i % n_blocks}",
            "booking_date": "2026-01-01",
            "payment_plan_snapshot": plan,
            "cash_agreed_paise": 1_000_000,
            "account_agreed_paise": 2_000_000,
        }
        for i in range(n_bookings)
    ]
    blocks = [
        {
            "id": f"blk{j}",
            "construction_stages": [
                {"stage_id": "st1", "name": "Plinth", "planned_date": f"2026-0{j + 2}-01", "status": "Pending"},
                {"stage_id": "st9", "name": "Handover", "is_possession": True, "planned_date": "2027-03-01"},
            ],
        }
        for j in range(n_blocks)
    ]
    demands = [
        {
            "id": f"d{i}",
            "booking_id": f"bk{i}",
            "installment_seq": 1,
            "status": "Paid",
            "due_date": "2026-01-10",
            "demand_date": "2026-01-01",
            "demand_number": f"DM-{i}",
            "cash_demand_paise": 100_000,
            "account_demand_paise": 200_000,
            "total_demand_paise": 300_000,
            "paid_paise": 300_000,
        }
        for i in range(0, n_bookings, 2)
    ]
    return bookings, blocks, demands


def test_schedules_for_batches_queries_and_matches_naive(monkeypatch):
    bookings, blocks, demands = _fixture()
    calls = {}

    class _Db:
        pass

    fake = _Db()
    fake.bookings = _Coll(bookings, "id", calls, "bookings")
    fake.blocks = _Coll(blocks, "id", calls, "blocks")
    fake.demands = _Coll(demands, "booking_id", calls, "demands")
    monkeypatch.setattr(de, "db", fake)

    async def run():
        return [(b["id"], rows) async for b, rows in de.schedules_for({})]

    got = asyncio.run(run())
    chunks = math.ceil(len(bookings) / 500)
    assert calls["bookings"] == 1
    assert calls["demands"] == chunks, calls  # one batched demand query per 500 bookings, not one per booking
    assert calls["blocks"] <= chunks, calls  # each block fetched once (cached across chunks)
    blk = {b["id"]: b for b in blocks}
    naive = [
        (b["id"], de.schedule(b, blk[b["block_id"]], [d for d in demands if d["booking_id"] == b["id"]]))
        for b in bookings
    ]
    assert got == naive
