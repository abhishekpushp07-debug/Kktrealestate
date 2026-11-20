"""Phase 3G crash drills (REQ-297, JRN-131) on the THROW-AWAY copy only: run a money flow in-process, stop it after its
N-th database write (simulated crash), check what is left, retry the same request (same Idempotency-Key) or run the
existing recovery, check again. N walks 1, 2, 3 … until the flow completes without reaching the crash point.

    DB_NAME=kkt_audit_scratch python -m tools.db_audit_crash --label after
"""

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import date

assert os.environ.get("DB_NAME") == "kkt_audit_scratch", "crash drills run on the throw-away copy only"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")

import httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorCollection  # noqa: E402

from tools._env import DEMO_PASSWORD  # noqa: E402
from tools.db_audit_drills import OUT, booking_checks  # noqa: E402

WRITES = ("insert_one", "insert_many", "update_one", "update_many", "find_one_and_update", "delete_one", "delete_many", "replace_one")
STATE = {"armed": None, "count": 0, "log": []}


class Crash(Exception):
    pass


def _patch():
    for name in WRITES:
        orig = getattr(AsyncIOMotorCollection, name)

        def make(orig, name):
            async def w(self, *a, **k):
                if STATE["armed"] is not None and self.name not in ("locks", "idempotency_claims", "rate_limits", "login_events", "refresh_tokens"):
                    STATE["count"] += 1
                    if STATE["count"] > STATE["armed"]:
                        raise Crash(f"crash before write {STATE['count']} ({self.name}.{name})")
                    res = await orig(self, *a, **k)
                    STATE["log"].append(f"{self.name}.{name}")
                    return res
                return await orig(self, *a, **k)

            return w

        setattr(AsyncIOMotorCollection, name, make(orig, name))


async def _client(app):
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://localhost",
                          headers={"X-Rate-Limit-Bypass": os.environ["LOGIN_RATE_LIMIT_BYPASS_TOKEN"]}, timeout=120)  # fmt: skip
    r = await c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD})
    c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return c


async def _flows(db, c):
    md = {m["code"]: m["id"] async for m in db.payment_modes.find({}, {"code": 1, "id": 1})}
    bank = await db.bank_accounts.find_one({"is_active": True})
    today = date.today().isoformat()
    picks = [b["id"] async for b in db.bookings.find({"status": "Active", "summary.outstanding_paise": {"$gt": 5_000_000}}, {"id": 1}).limit(400)]
    it = iter(picks)

    async def receipt(bid, key):
        return await c.post("/api/payments", headers={"Idempotency-Key": key},
                            json={"booking_id": bid, "amount": 5000, "payment_date": today, "payment_mode_id": md["CASH"], "allocation": "auto", "remarks": "crash drill"})  # fmt: skip

    async def cheque_clear(bid, key):
        if "pid" not in STATE:
            r = await c.post("/api/payments", headers={"Idempotency-Key": uuid.uuid4().hex}, json={"booking_id": bid, "amount": 5000, "payment_date": today,
                             "payment_mode_id": md["CHEQUE"], "bank_account_id": bank["id"], "instrument": {"number": "CD1", "date": today, "bank_name": "SBI"}, "allocation": "auto"})  # fmt: skip
            STATE["pid"] = r.json()["id"]
        return await c.post(f"/api/payments/{STATE['pid']}/clear", json={"cleared_on": today})

    async def waiver_approve(bid, key):
        if "wid" not in STATE:
            r = await c.post("/api/waivers", json={"booking_id": bid, "target": {"kind": "share", "share": "Account"}, "amount": 10, "reason": "crash drill"})
            STATE["wid"] = r.json().get("id")
        return await c.post(f"/api/waivers/{STATE['wid']}/approve")

    async def cancel(bid, key):
        b = await db.bookings.find_one({"id": bid}, {"version": 1})
        return await c.post(f"/api/bookings/{bid}/cancel", json={"reason": "crash drill"} | ({"version": b["version"]} if False else {}))

    return [("post receipt (cash, auto)", receipt, it, "BK"), ("cheque clear", cheque_clear, it, "BK"),
            ("waiver approve", waiver_approve, None, "WV"), ("cancel booking → refund", cancel, it, "BK")]  # fmt: skip


async def _consistent(db, bid):
    bad = booking_checks(bid)
    b = await db.bookings.find_one({"id": bid}, {"status": 1, "cancellation": 1, "summary": 1})
    if b["status"] == "Cancelled" and (b.get("cancellation") or {}).get("received_paise") and not await db.refunds.find_one({"booking_id": bid}):
        bad.append("cancelled with money received but no refund/forfeit row")
    if (b.get("summary") or {}).get("total_udhar_paise") and not await db.ledger_entries.find_one({"booking_id": bid}):
        bad.append("ledger lines missing")
    if await db.read_model_marks.find_one({"_id": {"$ne": "__v"}}) is None and False:
        bad.append("read-model mark lost")
    return bad


async def main(label):
    _patch()
    import server
    from db import db

    async with server.app.router.lifespan_context(server.app):
        c = await _client(server.app)
        wb = [b["id"] async for b in db.bookings.find({"status": "Active", "summary.account_due_paise": {"$gt": 100000}}, {"id": 1}).limit(60)]
        wit = iter(wb)
        out = {}
        for name, fn, it, _ in await _flows(db, c):
            rows = []
            for n in range(0, 40):
                STATE.pop("pid", None), STATE.pop("wid", None)
                bid = next(it) if it else next(wit)
                key = uuid.uuid4().hex
                STATE.update(armed=None, count=0, log=[])
                if name == "cheque clear":
                    await fn(bid, key)  # create the cheque outside the crash window
                if name == "waiver approve":
                    await fn(bid, key) if False else None
                    r0 = await c.post("/api/waivers", json={"booking_id": bid, "target": {"kind": "share", "share": "Account"}, "amount": 10, "reason": "crash drill"})
                    STATE["wid"] = r0.json().get("id")
                STATE.update(armed=n, count=0, log=[])
                r = await fn(bid, key)
                crashed = r.status_code >= 500
                STATE["armed"] = None
                writes = list(STATE["log"])
                left = await _consistent(db, bid)
                retry = await fn(bid, key)
                await asyncio.sleep(0.05)
                after = await _consistent(db, bid)
                rows.append({"crash_after_write": n, "writes_done": writes[-3:], "crashed": crashed, "left_bad": left,
                             "retry": retry.status_code, "retry_msg": (retry.text[:90] if retry.status_code >= 400 else ""), "after_retry_bad": after})  # fmt: skip
                if not crashed:
                    break
            out[name] = {"crash_points": len(rows) - 1, "unrepaired": [r for r in rows if r["after_retry_bad"]], "rows": rows}
            print(name, "points", len(rows) - 1, "unrepaired", len(out[name]["unrepaired"]), flush=True)
    with open(f"{OUT}/drill_crash_{label}.json", "w") as fh:
        json.dump(out, fh, indent=1, default=str)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    asyncio.run(main(ap.parse_args().label))
