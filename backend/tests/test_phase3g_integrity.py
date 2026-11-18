"""Phase 3G (REQ-303/304/307/308/314): each test reproduces one audit finding; it fails on the pre-3G code and passes now.
Process 1 = the private test backend (BASE); process 2 = this pytest process using the same services on the same DB —
the same shape as two live replicas sharing one Atlas cluster."""

import asyncio
import os
import threading
import uuid
from datetime import date

import pytest
import requests
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

from tests.conftest import BASE
from tests.flat_claims import own_flats

API = f"{BASE}/api"
pytestmark = pytest.mark.load_sensitive


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _call(h, method, path, body=None, ok=(200, 201)):
    r = requests.request(method, f"{API}{path}", headers={**h, "Idempotency-Key": uuid.uuid4().hex}, json=body, timeout=120)
    assert r.status_code in ok, (method, path, r.status_code, r.text[:300])
    return r.json()


def _both(fa, fb):
    bar, out = threading.Barrier(2), [None, None]

    def go(i, f):
        bar.wait()
        out[i] = f()

    ts = [threading.Thread(target=go, args=(i, f)) for i, f in enumerate((fa, fb))]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


# ---- G-01 money business keys enforced by the database (REQ-290, JRN-127/130)
@pytest.mark.parametrize(
    "coll,field",
    [("waivers", "waiver_number"), ("waivers", "cn_number"), ("ledger_entries", None), ("refunds", "refund_number")],
)
def test_db_refuses_repeated_money_keys(coll, field):
    db = _db()
    q = {field: {"$type": "string"}, "parent_refund_id": {"$exists": False}} if field else {}
    doc = db[coll].find_one(q, {"_id": 0})
    if not doc:
        pytest.skip(f"no {coll} row in the snapshot")
    dup = {**doc, "id": f"t3g-{uuid.uuid4().hex}"}
    with pytest.raises(DuplicateKeyError):
        db[coll].insert_one(dup)
    db[coll].delete_many({"id": dup["id"]})


# ---- G-02 a uniqueness rule that meets duplicates never stops startup (REQ-307, JRN-133)
def test_uniqueness_rule_skipped_and_reported_when_duplicates_exist():
    from pymongo import ASCENDING

    from services import invariants

    coll = f"t3g_dups_{uuid.uuid4().hex[:6]}"
    _db()[coll].insert_many([{"n": "X-1"}, {"n": "X-1"}])

    async def go():
        return await invariants._business_key("test number", coll, [("n", ASCENDING)], "uniq_t3g", None)

    try:
        row = asyncio.run(go())
        assert row["status"] == "not_applied"
        assert row["message"] == "Uniqueness rule not applied — duplicates found"
        assert "uniq_t3g" not in _db()[coll].index_information()
    finally:
        _db().drop_collection(coll)


def test_system_health_lists_uniqueness_rules(admin_headers):
    ops = _call(admin_headers, "GET", "/admin/ops")
    keys = {r["key"]: r["status"] for r in ops["uniqueness"]}
    assert keys.get("ledger line (booking + sequence)") == "applied"
    assert keys.get("credit-note number") == "applied"


# ---- G-03 two ledger rebuilds from two processes never duplicate ledger lines (JRN-130, R8)
def test_ledger_rebuilds_from_two_processes_never_repeat_a_sequence(work_booking):
    from services import ledger

    bid = work_booking["id"]

    class OwnLockPerCall(dict):  # each call behaves like a separate process: no shared in-process lock
        def setdefault(self, k, v):
            return asyncio.Lock()

    ledger._REBUILD_LOCKS, saved = OwnLockPerCall(), ledger._REBUILD_LOCKS

    async def go():
        await asyncio.gather(*(ledger.rebuild(bid) for _ in range(6)), return_exceptions=False)

    try:
        asyncio.run(go())
    finally:
        ledger._REBUILD_LOCKS = saved
    seqs = [e["seq"] for e in _db().ledger_entries.find({"booking_id": bid}, {"seq": 1})]
    assert len(seqs) == len(set(seqs)) and seqs, f"{len(seqs)} rows, {len(set(seqs))} distinct"


# ---- G-04 the same waiver approved twice at once → one approval, the other "Already approved" (JRN-127, R4)
def test_waiver_double_approve_and_approve_vs_reject(admin_headers, work_booking):
    db = _db()
    bid = work_booking["id"]
    for i in range(4):
        w = _call(admin_headers, "POST", "/waivers",
                  {"booking_id": bid, "target": {"kind": "share", "share": "Account"}, "amount": 1, "reason": "t3g double approve"})  # fmt: skip
        url = f"{API}/waivers/{w['id']}/approve"
        ra, rb = _both(lambda: requests.post(url, headers=admin_headers, timeout=60),
                       lambda: requests.post(url, headers=admin_headers, timeout=60))  # fmt: skip
        codes = sorted([ra.status_code, rb.status_code])
        audits = db.audit_logs.count_documents({"action": {"$in": ["waiver.approve", "waiver.self_approve"]}, "after.waiver_number": w["waiver_number"]})
        assert codes == [200, 409] and audits == 1, (codes, audits)
        loser = ra if ra.status_code == 409 else rb
        assert "Already approved" in loser.text
        _call(admin_headers, "POST", f"/waivers/{w['id']}/cancel", {"reason": "t3g cleanup"})
        z = _call(admin_headers, "POST", "/waivers",
                  {"booking_id": bid, "target": {"kind": "share", "share": "Account"}, "amount": 1, "reason": "t3g approve vs reject"})  # fmt: skip
        ra, rb = _both(lambda: requests.post(f"{API}/waivers/{z['id']}/approve", headers=admin_headers, timeout=60),
                       lambda: requests.post(f"{API}/waivers/{z['id']}/reject", headers=admin_headers, json={"reason": "t3g"}, timeout=60))  # fmt: skip
        final = db.waivers.find_one({"id": z["id"]})
        won = "Approved" if ra.status_code == 200 else "Rejected"
        assert sorted([ra.status_code, rb.status_code]) == [200, 409] and final["status"] == won, (ra.status_code, rb.status_code, final["status"])
        if final["status"] == "Approved":
            _call(admin_headers, "POST", f"/waivers/{z['id']}/cancel", {"reason": "t3g cleanup"})


# ---- G-05 split (auto) receipt cap is enforced by the write, not by an earlier read (R2)
def test_split_receipt_cap_is_enforced_by_the_write():
    from routers import payments

    db = _db()
    bid = f"t3g-{uuid.uuid4().hex}"
    agreed = 1_000_000
    b = {"id": bid, "status": "Active", "cash_agreed_paise": agreed, "account_agreed_paise": 0, "agreement_value_paise": agreed,
         "summary": {"cash_paid_paise": agreed - 100, "account_paid_paise": 0, "paid_paise": agreed - 100}}  # fmt: skip
    db.bookings.insert_one(dict(b), bypass_document_validation=True)
    p = {"allocations": [{"kind": "FLAT_VALUE", "category": "Cash", "amount_paise": 200, "demand_id": "x"}]}
    try:
        with pytest.raises(Exception) as e:  # another process already received up to agreed − ₹1
            asyncio.run(payments._reserve_split(b | {"summary": {}}, p))
        assert getattr(e.value, "status_code", None) == 409
        assert db.bookings.find_one({"id": bid})["summary"]["cash_paid_paise"] == agreed - 100
    finally:
        db.bookings.delete_one({"id": bid})


# ---- G-06 a Mixed refund payout that stopped midway is completed exactly once (crash drill)
def test_interrupted_mixed_refund_payout_is_completed_once():
    from services import money_ops

    db = _db()
    pid = f"t3g-{uuid.uuid4().hex}"
    parent = {"id": pid, "refund_number": f"RF-T3G-{pid[-6:]}", "booking_id": f"t3g-none-{pid}", "status": "Paid", "bucket": "Cash",
              "amount_paise": 300, "amount_total_paise": 1000, "split": {"Cash": 300, "Account": 500, "Other": 200},
              "children_pending": True, "company_id": "t3g"}  # fmt: skip
    db.refunds.insert_one(dict(parent))
    try:
        assert asyncio.run(money_ops.repair_interrupted_refunds()) == 2
        assert asyncio.run(money_ops.repair_interrupted_refunds()) == 0  # idempotent
        rows = list(db.refunds.find({"refund_number": parent["refund_number"]}))
        assert sum(r["amount_paise"] for r in rows) == 1000 and len(rows) == 3
        assert not db.refunds.find_one({"id": pid}).get("children_pending")
    finally:
        db.refunds.delete_many({"refund_number": parent["refund_number"]})


# ---- G-07 read-model marks survive a crash and are visible to every process (REQ-314, crash drill)
def test_read_model_marks_are_shared_and_survive_a_crash():
    from services import read_model_state as S

    cid = f"t3g-{uuid.uuid4().hex}"

    async def go():
        await S.persist(customer_id=cid)
        S.dirty["customers"].discard(cid)  # "process 2" / restarted process: nothing in memory
        assert await S.shared_pending(f"c:{cid}")
        assert await S.load_shared(0) and cid in S.dirty["customers"]
        S.dirty["customers"].discard(cid)
        from datetime import UTC, datetime

        await S.clear({"customers": {cid}}, datetime.now(UTC))
        assert not await S.shared_pending(f"c:{cid}")

    asyncio.run(go())


# ---- G-08 a cached figure is never served after a write on another process (REQ-314, JRN-137)
def test_cache_is_recomputed_after_a_write_on_another_process(admin_headers, work_booking):
    from services import ttlcache

    calls = []

    async def compute():
        calls.append(1)
        return len(calls)

    async def go():
        key = f"home:t3g-{uuid.uuid4().hex}"
        first = await ttlcache.cached(key, 600, compute)
        assert await ttlcache.cached(key, 600, compute) == first  # still cached
        _call(admin_headers, "POST", "/payments", {"booking_id": work_booking["id"], "amount": 1, "payment_date": date.today().isoformat(),
              "payment_mode_id": _db().payment_modes.find_one({"code": "CASH"})["id"], "allocation": "auto", "remarks": "t3g stamp"})  # fmt: skip
        return first, await ttlcache.cached(key, 600, compute)

    first, after = asyncio.run(go())
    assert after == first + 1, "a write on the other process must change the next read"
    p = _db().payments.find_one({"booking_id": work_booking["id"], "remarks": "t3g stamp", "status": "Cleared"})
    _call(admin_headers, "POST", f"/payments/{p['id']}/reverse", {"reason": "t3g cleanup"})


# ---- G-09 a cancel that stopped after its status write is finished by its retry (crash drill, JRN-131)
def test_interrupted_cancel_is_completed_by_retry(admin_headers):
    db = _db()
    f = own_flats(API, admin_headers, 1)[0]
    cust = _call(admin_headers, "POST", "/customers", {"full_name": "T3G Cancel Buyer", "phone": f"+9190{uuid.uuid4().int % 10**8:08d}", "source": "Walk-in"})
    price = f["price"]
    plans = _call(admin_headers, "GET", f"/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans")["items"]
    bk = _call(admin_headers, "POST", "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "booking_date": date.today().isoformat(),
               "agreement_value": price, "cash_agreed": 0, "account_agreed": price, "payment_plan_id": plans[0]["id"],
               "other_charges": [], "agreement_gst_percent": 5, "remarks": "t3g cancel crash"})  # fmt: skip
    md = db.payment_modes.find_one({"code": "NEFT"}) or db.payment_modes.find_one({"code": {"$ne": "CASH"}, "is_active": True})
    bank = db.bank_accounts.find_one({"is_active": True})
    _call(admin_headers, "POST", "/payments", {"booking_id": bk["id"], "amount": 50000, "payment_date": date.today().isoformat(),
          "payment_mode_id": md["id"], "bank_account_id": bank["id"], "instrument": {"number": "T3G1", "date": date.today().isoformat(), "bank_name": "SBI"},
          "allocation": "auto", "remarks": "t3g"})  # fmt: skip
    b = db.bookings.find_one({"id": bk["id"]})
    received = b["summary"]["paid_paise"] + b["summary"].get("other_charges_paid_paise", 0)
    deduction = received // 10
    canc = {"at": b["updated_at"], "by": "t3g", "by_name": "T3G", "reason": "t3g crash", "received_paise": received, "deduction_paise": deduction,
            "charges_due_paise": 0, "refund_paise": received - deduction, "forfeiture_paise": deduction, "lines": []}  # fmt: skip
    db.bookings.update_one({"id": bk["id"]}, {"$set": {"status": "Cancelled", "cancellation": canc}, "$inc": {"version": 1}})  # crash here
    out = _call(admin_headers, "POST", f"/bookings/{bk['id']}/cancel", {"reason": "t3g retry"})
    assert out["status"] == "Cancelled" and out["refund"], out
    assert db.refunds.count_documents({"booking_id": bk["id"], "parent_refund_id": {"$exists": False}}) == 1
    _call(admin_headers, "POST", f"/bookings/{bk['id']}/cancel", {"reason": "t3g retry again"}, ok=(409,))


# ---- G-03/G-04 a receipt waits while another process writes the same booking (cancel / receipt / ledger, R2/R7)
def test_receipt_waits_for_the_other_process_writing_the_booking(admin_headers, work_booking):
    import time

    from services.booking_lock import booking_lock

    db = _db()
    body = {"booking_id": work_booking["id"], "amount": 1, "payment_date": date.today().isoformat(),
            "payment_mode_id": db.payment_modes.find_one({"code": "CASH"})["id"], "allocation": "auto", "remarks": "t3g lock"}  # fmt: skip
    out = {}

    async def go():
        async with booking_lock(work_booking["id"]):  # "process 2" is cancelling / posting on this booking
            t = threading.Thread(target=lambda: out.update(r=requests.post(f"{API}/payments", json=body, timeout=60,
                                 headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex})))  # fmt: skip
            t.start()
            await asyncio.sleep(2.0)
            out["during"] = "r" in out
        return t

    t = asyncio.run(go())
    t.join(60)
    assert out["during"] is False, "the receipt must not land while another process holds the booking"
    assert out["r"].status_code == 201
    _call(admin_headers, "POST", f"/payments/{out['r'].json()['id']}/reverse", {"reason": "t3g cleanup"})
    time.sleep(0.1)


# ---- G-10 a receipt retried after a crash (same key) returns the original receipt, never a 500 or a second one
def test_receipt_retry_after_crash_returns_the_original(admin_headers, work_booking):
    db = _db()
    key = uuid.uuid4().hex
    body = {"booking_id": work_booking["id"], "amount": 1, "payment_date": date.today().isoformat(),
            "payment_mode_id": db.payment_modes.find_one({"code": "CASH"})["id"], "allocation": "auto", "remarks": "t3g replay"}  # fmt: skip
    h = {**admin_headers, "Idempotency-Key": key}
    first = requests.post(f"{API}/payments", json=body, headers=h, timeout=60)
    assert first.status_code == 201
    db.idempotency_claims.delete_many({"key": key})  # crash: the receipt is stored, its claim never finished
    again = requests.post(f"{API}/payments", json=body, headers=h, timeout=60)
    assert again.status_code == 201, again.text[:200]
    assert again.json()["receipt_number"] == first.json()["receipt_number"]
    assert db.payments.count_documents({"idempotency_key": key}) == 1
    _call(admin_headers, "POST", f"/payments/{first.json()['id']}/reverse", {"reason": "t3g cleanup"})
