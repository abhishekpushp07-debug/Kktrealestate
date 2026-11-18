"""Phase 3G (REQ-303/304/307/308/314): each test reproduces one audit finding; it fails on the pre-3G code and passes now.
Process 1 = the private test backend (BASE); process 2 = this pytest process using the same services on the same DB —
the same shape as two live replicas sharing one Atlas cluster."""

import json
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


def _py(script: str):
    """App-side async code runs in a fresh subprocess: a literal second process on the same DB (and motor binds per loop)."""
    import json
    import subprocess
    import sys

    out = subprocess.run([sys.executable, "-c", "import asyncio, json, sys\nsys.path.insert(0, '.')\n" + script],
                         cwd=os.path.join(os.path.dirname(__file__), ".."), capture_output=True, text=True, timeout=180, env={**os.environ})  # fmt: skip
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else None


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


def _own_booking(h, cash_share: bool):
    f = own_flats(API, h, 1)[0]
    cust = _call(h, "POST", "/customers", {"full_name": "T3G Buyer", "phone": f"+9190{uuid.uuid4().int % 10**8:08d}", "source": "Walk-in"})
    price = f["price"]
    plans = _call(h, "GET", f"/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans")["items"]
    return _call(h, "POST", "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "booking_date": date.today().isoformat(),
                 "agreement_value": price, "cash_agreed": price if cash_share else 0, "account_agreed": 0 if cash_share else price,
                 "payment_plan_id": plans[0]["id"], "other_charges": [], "agreement_gst_percent": 5, "remarks": "t3g"})  # fmt: skip


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
    coll = f"t3g_dups_{uuid.uuid4().hex[:6]}"
    _db()[coll].insert_many([{"n": "X-1"}, {"n": "X-1"}])
    try:
        row = _py(f"""
from services import invariants
print(json.dumps(asyncio.run(invariants._business_key("test number", "{coll}", [("n", 1)], "uniq_t3g", None))))
""")
        assert row["status"] == "not_applied"
        assert row["message"] == "Uniqueness rule not applied — duplicates found"
        assert "uniq_t3g" not in _db()[coll].index_information()
    finally:
        _db().drop_collection(coll)


# ---- G-03 two ledger rebuilds from two processes never duplicate ledger lines (JRN-130, R8)
def test_ledger_rebuilds_from_two_processes_never_repeat_a_sequence(work_booking):
    bid = work_booking["id"]
    _py(f"""
from services import ledger
class OwnLockPerCall(dict):  # each call behaves like a separate process: no shared in-process lock
    def setdefault(self, k, v):
        return asyncio.Lock()
ledger._REBUILD_LOCKS = OwnLockPerCall()
async def go():
    await asyncio.gather(*(ledger.rebuild("{bid}") for _ in range(6)))
asyncio.run(go())
""")
    seqs = [e["seq"] for e in _db().ledger_entries.find({"booking_id": bid}, {"seq": 1})]
    assert len(seqs) == len(set(seqs)) and seqs, f"{len(seqs)} rows, {len(set(seqs))} distinct"


# ---- G-04 the same waiver approved twice at once → one approval, the other "Already approved" (JRN-127, R4)
def test_waiver_double_approve_and_approve_vs_reject(admin_headers):
    db = _db()
    from tests.conftest import TEST_PASSWORD, session_token

    bid = _own_booking(admin_headers, cash_share=False)["id"]
    share = "Account"
    acc = {"Authorization": f"Bearer {session_token('accounts@kkt.in', TEST_PASSWORD)}"}  # requester ≠ approver
    for i in range(4):
        w = _call(acc, "POST", "/waivers",
                  {"booking_id": bid, "target": {"kind": "share", "share": share}, "amount": 1, "reason": "t3g double approve"})  # fmt: skip
        url = f"{API}/waivers/{w['id']}/approve"
        ra, rb = _both(lambda: requests.post(url, headers=admin_headers, timeout=60),
                       lambda: requests.post(url, headers=admin_headers, timeout=60))  # fmt: skip
        codes = sorted([ra.status_code, rb.status_code])
        audits = db.audit_logs.count_documents({"action": {"$in": ["waiver.approve", "waiver.self_approve"]}, "after.waiver_number": w["waiver_number"]})
        assert codes == [200, 409] and audits == 1, (codes, audits, i, ra.text[:160], rb.text[:160])
        loser = ra if ra.status_code == 409 else rb
        assert "Already approved" in loser.text
        _call(admin_headers, "POST", f"/waivers/{w['id']}/cancel", {"reason": "t3g cleanup"})
        z = _call(acc, "POST", "/waivers",
                  {"booking_id": bid, "target": {"kind": "share", "share": share}, "amount": 1, "reason": "t3g approve vs reject"})  # fmt: skip
        ra, rb = _both(lambda: requests.post(f"{API}/waivers/{z['id']}/approve", headers=admin_headers, timeout=60),
                       lambda: requests.post(f"{API}/waivers/{z['id']}/reject", headers=admin_headers, json={"reason": "t3g"}, timeout=60))  # fmt: skip
        final = db.waivers.find_one({"id": z["id"]})
        won = "Approved" if ra.status_code == 200 else "Rejected"
        assert sorted([ra.status_code, rb.status_code]) == [200, 409] and final["status"] == won, (ra.status_code, rb.status_code, final["status"])
        if final["status"] == "Approved":
            _call(admin_headers, "POST", f"/waivers/{z['id']}/cancel", {"reason": "t3g cleanup"})


# ---- G-05 split (auto) receipt cap is enforced by the write, not by an earlier read (R2)
def test_split_receipt_cap_is_enforced_by_the_write():
    db = _db()
    bid = f"t3g-{uuid.uuid4().hex}"
    agreed = 1_000_000
    b = {"id": bid, "status": "Active", "cash_agreed_paise": agreed, "account_agreed_paise": 0, "agreement_value_paise": agreed,
         "summary": {"cash_paid_paise": agreed - 100, "account_paid_paise": 0, "paid_paise": agreed - 100}}  # fmt: skip
    db.bookings.insert_one(dict(b), bypass_document_validation=True)
    try:  # another process already received up to agreed − ₹1; this one read a stale "nothing received yet"
        code = _py(f"""
from routers import payments
b = {{"id": "{bid}", "status": "Active", "cash_agreed_paise": {agreed}, "account_agreed_paise": 0, "summary": {{}}}}
p = {{"allocations": [{{"kind": "FLAT_VALUE", "category": "Cash", "amount_paise": 200, "demand_id": "x"}}]}}
try:
    asyncio.run(payments._reserve_split(b, p)); print(json.dumps(0))
except Exception as e:
    print(json.dumps(getattr(e, "status_code", 500)))
""")
        assert code == 409
        assert db.bookings.find_one({"id": bid})["summary"]["cash_paid_paise"] == agreed - 100
    finally:
        db.bookings.delete_one({"id": bid})


# ---- G-06 a Mixed refund payout that stopped midway is completed exactly once (crash drill)
def test_interrupted_mixed_refund_payout_is_completed_once():
    db = _db()
    pid = f"t3g-{uuid.uuid4().hex}"
    parent = {"id": pid, "refund_number": f"RF-T3G-{pid[-6:]}", "booking_id": f"t3g-none-{pid}", "status": "Paid", "bucket": "Cash",
              "amount_paise": 300, "amount_total_paise": 1000, "split": {"Cash": 300, "Account": 500, "Other": 200},
              "children_pending": True, "company_id": "t3g"}  # fmt: skip
    db.refunds.insert_one(dict(parent))
    run = "from services import money_ops\nprint(json.dumps(asyncio.run(money_ops.repair_interrupted_refunds())))"
    try:
        assert _py(run) == 2
        assert _py(run) == 0  # idempotent
        rows = list(db.refunds.find({"refund_number": parent["refund_number"]}))
        assert sum(r["amount_paise"] for r in rows) == 1000 and len(rows) == 3
        assert not db.refunds.find_one({"id": pid}).get("children_pending")
    finally:
        db.refunds.delete_many({"refund_number": parent["refund_number"]})


# ---- G-07 read-model marks survive a crash and are visible to every process (REQ-314, crash drill)
def test_read_model_marks_are_shared_and_survive_a_crash():
    cid = f"t3g-{uuid.uuid4().hex}"
    _py(f"from services import read_model_state as S\nasyncio.run(S.persist(customer_id='{cid}'))")  # process 1 marks, then dies
    out = _py(f"""
from datetime import UTC, datetime
from services import read_model_state as S
async def go():
    a = await S.shared_pending("c:{cid}")
    b = await S.load_shared(0) and "{cid}" in S.dirty["customers"]
    S.dirty["customers"].discard("{cid}")
    await S.clear({{"customers": {{"{cid}"}}}}, datetime.now(UTC))
    return [a, b, await S.shared_pending("c:{cid}")]
print(json.dumps(asyncio.run(go())))
""")
    assert out == [True, True, False]


# ---- G-08 a cached figure is never served after a write on another process (REQ-314, JRN-137)
def test_cache_is_recomputed_after_a_write_on_another_process(admin_headers, work_booking):
    db = _db()
    body = {"booking_id": work_booking["id"], "amount": 1, "payment_date": date.today().isoformat(),
            "payment_mode_id": db.payment_modes.find_one({"code": "CASH"})["id"], "allocation": "auto", "remarks": "t3g stamp"}  # fmt: skip
    marker = f"/tmp/t3g_stamp_{uuid.uuid4().hex}"
    import subprocess
    import sys
    import time

    script = f"""
import asyncio, json, os, sys
sys.path.insert(0, '.')
from services import ttlcache
calls = []
async def compute():
    calls.append(1); return len(calls)
async def go():
    key = "home:t3g-stamp"
    a = await ttlcache.cached(key, 600, compute)
    b = await ttlcache.cached(key, 600, compute)
    open("{marker}", "w").close()
    for _ in range(600):
        if os.path.exists("{marker}.done"):
            break
        await asyncio.sleep(0.1)
    return [a, b, await ttlcache.cached(key, 600, compute)]
print(json.dumps(asyncio.run(go())))
"""
    proc = subprocess.Popen([sys.executable, "-c", script], cwd=os.path.join(os.path.dirname(__file__), ".."),
                            stdout=subprocess.PIPE, text=True, env={**os.environ})  # fmt: skip
    for _ in range(300):
        if os.path.exists(marker):
            break
        time.sleep(0.1)
    r = requests.post(f"{API}/payments", json=body, headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex}, timeout=60)
    assert r.status_code == 201
    open(marker + ".done", "w").close()
    out = json.loads(proc.communicate(timeout=120)[0].strip().splitlines()[-1])
    assert out == [1, 1, 2], "a write on the other process must change the next read"
    _call(admin_headers, "POST", f"/payments/{r.json()['id']}/reverse", {"reason": "t3g cleanup"})


# ---- G-09 a cancel that stopped after its status write is finished by its retry (crash drill, JRN-131)
def test_interrupted_cancel_is_completed_by_retry(admin_headers):
    db = _db()
    f = own_flats(API, admin_headers, 1)[0]
    cust = _call(admin_headers, "POST", "/customers", {"full_name": "T3G Cancel Buyer", "phone": f"+9190{uuid.uuid4().int % 10**8:08d}", "source": "Walk-in"})
    price = f["price"]
    plans = _call(admin_headers, "GET", f"/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans")["items"]
    bk = _call(admin_headers, "POST", "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "booking_date": date.today().isoformat(),
               "agreement_value": price, "cash_agreed": price, "account_agreed": 0, "payment_plan_id": plans[0]["id"],
               "other_charges": [], "agreement_gst_percent": 5, "remarks": "t3g cancel crash"})  # fmt: skip
    md = db.payment_modes.find_one({"code": "CASH"})
    _call(admin_headers, "POST", "/payments", {"booking_id": bk["id"], "amount": 50000, "payment_date": date.today().isoformat(),
          "payment_mode_id": md["id"], "allocation": "auto", "remarks": "t3g"})  # fmt: skip
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
    import subprocess
    import sys
    import time

    db = _db()
    body = {"booking_id": work_booking["id"], "amount": 1, "payment_date": date.today().isoformat(),
            "payment_mode_id": db.payment_modes.find_one({"code": "CASH"})["id"], "allocation": "auto", "remarks": "t3g lock"}  # fmt: skip
    script = f"""
import asyncio, sys
sys.path.insert(0, '.')
from services.booking_lock import booking_lock
async def go():
    async with booking_lock("{work_booking['id']}"):
        print("held", flush=True)
        await asyncio.sleep(3)
asyncio.run(go())
"""
    holder = subprocess.Popen([sys.executable, "-c", script], cwd=os.path.join(os.path.dirname(__file__), ".."),
                              stdout=subprocess.PIPE, text=True, env={**os.environ})  # fmt: skip
    assert holder.stdout.readline().strip() == "held"  # "process 2" is cancelling / posting on this booking
    t0 = time.monotonic()
    r = requests.post(f"{API}/payments", json=body, headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex}, timeout=60)
    waited = time.monotonic() - t0
    holder.wait(30)
    assert r.status_code == 201
    assert waited > 1.5, f"the receipt landed after {waited:.2f} s while another process held the booking"
    _call(admin_headers, "POST", f"/payments/{r.json()['id']}/reverse", {"reason": "t3g cleanup"})


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


# ---- G-11 the same stage completed twice at once: one completion, the other "Stage already completed" (JRN-128, R6)
def test_stage_completed_twice_at_once_raises_bills_once(admin_headers):
    f = own_flats(API, admin_headers, 2)
    blk = f[0]["block_id"]
    st = _call(admin_headers, "GET", f"/blocks/{blk}/construction")["stages"]
    sid = next(s["stage_id"] for s in st if s["status"] != "Completed")
    body = {"stage_id": sid, "completed_on": date.today().isoformat(), "notes": "t3g twice"}
    url = f"{API}/blocks/{blk}/construction/stage"
    ra, rb = _both(lambda: requests.post(url, json=body, headers=admin_headers, timeout=120),
                   lambda: requests.post(url, json=body, headers=admin_headers, timeout=120))  # fmt: skip
    assert sorted([ra.status_code, rb.status_code]) == [200, 409], (ra.status_code, rb.status_code, rb.text[:200])
    loser = ra if ra.status_code == 409 else rb
    assert "already completed" in loser.text.lower()
    n = _db().audit_logs.count_documents({"entity_id": blk, "action": {"$regex": "stage"}, "after.stage_id": sid})
    assert n <= 1


# ---- G-12 a flat whose booking is Completed (sold) can never get a second live booking (double sale)
def test_db_refuses_second_live_booking_on_a_sold_flat():
    db = _db()
    b = db.bookings.find_one({"status": "Completed"}, {"_id": 0})
    if not b:
        pytest.skip("no Completed booking in the snapshot")
    dup = {**b, "id": f"t3g-{uuid.uuid4().hex}", "booking_number": f"BK-T3G-{uuid.uuid4().hex[:6]}", "status": "Active"}
    try:
        with pytest.raises(DuplicateKeyError):
            db.bookings.insert_one(dup, bypass_document_validation=True)
    finally:
        db.bookings.delete_many({"id": dup["id"]})
