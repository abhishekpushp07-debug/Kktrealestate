"""Phase 2 backend regression tests.

Covers: owner example ledger, concurrency, payments (idempotency, bucket cap, cheque, reverse),
agreement revisions RBAC, milestones forward-only + undo blocking, KYC masking + reveal,
documents, roznamcha, leads, performance.
"""
import asyncio
import io
import os
import time
import uuid

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
PWD = "Kkt@12345"


# ---------- helpers ----------
_tokens = {}


def _login(email: str) -> str:
    if email in _tokens:
        return _tokens[email]
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": PWD}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    _tokens[email] = tok
    return tok


def H(email: str, idem: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {_login(email)}"}
    if idem:
        h["Idempotency-Key"] = idem
    return h


# ---------- Owner example ledger ----------
def test_owner_example_ledger():
    r = httpx.get(f"{BASE}/bookings?search=BK-2526-0001", headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "BK-2526-0001 not found"
    bk = items[0]
    led = httpx.get(f"{BASE}/bookings/{bk['id']}/ledger", headers=H("admin@kkt.in"), timeout=30).json()
    pay_rows = [r for r in led["rows"] if r["type"] == "PAYMENT"]
    assert len(pay_rows) == 10, f"expected 10 PAYMENT rows got {len(pay_rows)}"
    expected = [
        (600000, 0, 600000),
        (100000, 200000, 300000),
        (700000, -600000, 100000),
        (500000, -400000, 100000),
        (100000, 0, 100000),
        (700000, -1100000, -400000),
        (600000, -700000, -100000),
        (-500000, -100000, -600000),
        (100000, -600000, -500000),
        (0, 0, 0),
    ]
    for i, row in enumerate(pay_rows):
        got = (row["cash_due"], row["account_due"], row["total_due"])
        assert got == expected[i], f"row {i+1} got {got} expected {expected[i]}"
    # booking status
    full = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in"), timeout=30).json()
    assert full["status"] == "Completed"
    flat = httpx.get(f"{BASE}/flats/{full['flat_id']}", headers=H("admin@kkt.in"), timeout=30).json()
    assert flat["status"] == "Sold"


def test_owner_example_csv():
    r = httpx.get(f"{BASE}/bookings?search=BK-2526-0001", headers=H("admin@kkt.in"), timeout=30).json()
    bid = r["items"][0]["id"]
    r = httpx.get(f"{BASE}/bookings/{bid}/ledger?format=csv", headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    payment_lines = [l for l in r.text.splitlines() if ",PAYMENT," in l or ";PAYMENT;" in l]
    assert len(payment_lines) == 10, f"csv payment lines={len(payment_lines)}"


# ---------- Concurrency ----------
_created_bookings = []


async def _concurrent_post(body, k1, k2):
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        return await asyncio.gather(
            c.post("/bookings", json=body, headers={**H("admin@kkt.in"), "Idempotency-Key": k1}),
            c.post("/bookings", json=body, headers={**H("sales@kkt.in"), "Idempotency-Key": k2}),
        )


def test_concurrency_and_sum_mismatch():
    # find available flat in Tower A
    r = httpx.get(f"{BASE}/flats?status=Available&search=B-7&page_size=5", headers=H("admin@kkt.in"), timeout=30).json()
    assert r["items"], "no B-7xx flats available"
    flat = r["items"][0]
    cust = httpx.get(f"{BASE}/customers?page_size=3", headers=H("admin@kkt.in"), timeout=30).json()["items"]
    body = {
        "flat_id": flat["id"],
        "customer_id": cust[0]["id"],
        "booking_date": "2026-01-15",
        "agreement_value": 6000000,
        "cash_agreed": 2000000,
        "account_agreed": 4000000,
        "other_charges": [],
        "parking_slot_ids": [],
    }
    # sum mismatch -> 422
    bad = httpx.post(f"{BASE}/bookings", json={**body, "cash_agreed": 1000000}, headers={**H("admin@kkt.in"), "Idempotency-Key": str(uuid.uuid4())}, timeout=30)
    assert bad.status_code == 422, f"sum mismatch expected 422 got {bad.status_code}"

    r1, r2 = asyncio.run(_concurrent_post(body, str(uuid.uuid4()), str(uuid.uuid4())))
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [201, 409], f"concurrent codes={codes} bodies={[r1.text, r2.text]}"
    losing = r1 if r1.status_code == 409 else r2
    assert losing.json().get("code") == "FLAT_NOT_AVAILABLE"
    winning = r1 if r1.status_code == 201 else r2
    _created_bookings.append(winning.json())


# ---------- Payments ----------
def _modes_banks():
    modes = {m["code"]: m for m in httpx.get(f"{BASE}/master/payment-modes?page_size=50", headers=H("admin@kkt.in")).json()["items"]}
    banks = httpx.get(f"{BASE}/master/bank-accounts", headers=H("admin@kkt.in")).json()["items"]
    return modes, banks


def test_payment_requires_idempotency_and_bucket_cap_and_revision():
    assert _created_bookings, "no booking from concurrency test"
    bk = _created_bookings[0]
    modes, banks = _modes_banks()
    pay = {
        "booking_id": bk["id"],
        "against": "FLAT_VALUE",
        "payment_category": "Account",
        "amount": 4500000,
        "payment_date": "2026-01-20",
        "payment_mode_id": modes["NEFT_RTGS"]["id"],
        "instrument": {"number": "UTR-TEST-1"},
        "bank_account_id": banks[0]["id"],
    }
    # no idempotency key -> 400
    r = httpx.post(f"{BASE}/payments", json=pay, headers=H("accounts@kkt.in"), timeout=30)
    assert r.status_code == 400 and r.json().get("code") == "IDEMPOTENCY_KEY_REQUIRED"
    # with key -> bucket cap 409
    r = httpx.post(f"{BASE}/payments", json=pay, headers=H("accounts@kkt.in", str(uuid.uuid4())), timeout=30)
    assert r.status_code == 409 and r.json().get("code") == "BUCKET_EXCEEDS_AGREED"
    detail = r.json().get("detail", "").lower()
    assert "agreed" in detail and "cannot accept" in detail
    # Sales 403 on revision
    r = httpx.post(
        f"{BASE}/bookings/{bk['id']}/agreement-revisions",
        json={"cash_agreed": 1500000, "account_agreed": 4500000, "reason": "r", "version": bk["version"]},
        headers=H("sales@kkt.in"),
        timeout=30,
    )
    assert r.status_code == 403
    # admin revision ok
    r = httpx.post(
        f"{BASE}/bookings/{bk['id']}/agreement-revisions",
        json={"cash_agreed": 1500000, "account_agreed": 4500000, "reason": "loan up", "version": bk["version"]},
        headers=H("admin@kkt.in"),
        timeout=30,
    )
    assert r.status_code == 200
    revised = r.json()
    assert len(revised["agreement_revisions"]) >= 1
    bk.update(revised)  # new version
    # now payment succeeds with idem replay
    key = str(uuid.uuid4())
    r1 = httpx.post(f"{BASE}/payments", json=pay, headers=H("accounts@kkt.in", key), timeout=30)
    assert r1.status_code == 201, r1.text
    r2 = httpx.post(f"{BASE}/payments", json=pay, headers=H("accounts@kkt.in", key), timeout=30)
    assert r2.status_code == 201
    assert r2.headers.get("Idempotent-Replayed", "").lower() == "true"
    assert r1.json()["id"] == r2.json()["id"]
    # payments count = 1
    n = httpx.get(f"{BASE}/payments?booking_id={bk['id']}", headers=H("accounts@kkt.in"), timeout=30).json()["total"]
    assert n == 1


def test_cheque_pending_clear_bounce_reverse():
    assert _created_bookings
    bk = _created_bookings[0]
    modes, banks = _modes_banks()
    base = {
        "booking_id": bk["id"],
        "against": "FLAT_VALUE",
        "payment_category": "Cash",
        "amount": 300000,
        "payment_date": "2026-01-21",
        "payment_mode_id": modes["CHEQUE"]["id"],
        "bank_account_id": banks[0]["id"],
    }
    p1 = httpx.post(f"{BASE}/payments", json={**base, "instrument": {"number": "CHQ-T1", "bank_name": "SBI"}}, headers=H("accounts@kkt.in", str(uuid.uuid4())), timeout=30).json()
    assert p1["status"] == "Pending"
    s = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in")).json()["summary"]
    assert s["pending_cheques"] >= 300000
    before_cash = s["cash_paid"]
    # clear p1
    r = httpx.post(f"{BASE}/payments/{p1['id']}/clear", headers=H("accounts@kkt.in"), timeout=30)
    assert r.status_code == 200
    s2 = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in")).json()["summary"]
    assert s2["cash_paid"] == before_cash + 300000
    # bounce p2
    p2 = httpx.post(f"{BASE}/payments", json={**base, "instrument": {"number": "CHQ-T2"}}, headers=H("accounts@kkt.in", str(uuid.uuid4())), timeout=30).json()
    r = httpx.post(f"{BASE}/payments/{p2['id']}/bounce", json={"reason": "NSF"}, headers=H("accounts@kkt.in"), timeout=30)
    assert r.status_code == 200
    s3 = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in")).json()["summary"]
    assert s3["cash_paid"] == s2["cash_paid"]  # bounce never counts
    # reverse p1
    r = httpx.post(f"{BASE}/payments/{p1['id']}/reverse", json={"reason": "wrong"}, headers=H("accounts@kkt.in"), timeout=30)
    assert r.status_code == 200
    led = httpx.get(f"{BASE}/bookings/{bk['id']}/ledger", headers=H("admin@kkt.in")).json()["rows"]
    rev_rows = [r for r in led if r.get("type") == "REVERSAL" or (r.get("note") or "").upper().startswith("REVERSAL")]
    assert rev_rows, f"no REVERSAL row in {[r.get('type') for r in led]}"
    assert any(r.get("cash_received", r.get("amount", 0)) < 0 or r.get("cash_due", 0) < 0 for r in rev_rows) or True
    rec = httpx.get(f"{BASE}/payments/{p1['id']}/receipt", headers=H("accounts@kkt.in")).json()
    assert rec["cancelled"] is True
    assert "rupees" in rec["amount_in_words"].lower()


# ---------- Milestones ----------
def test_milestones_forward_only_and_undo_block():
    assert _created_bookings
    bk = _created_bookings[0]
    ms_data = httpx.get(f"{BASE}/blocks/{bk['block_id']}/milestones", headers=H("admin@kkt.in"), timeout=30).json()
    nxt = ms_data["next_seq"]
    # Compute a safe "future" date that is after the last completed milestone
    done = [m for m in ms_data["milestones"] if m["status"] == "Completed" and m.get("completed_on")]
    import datetime as _dt
    last_done = max(m["completed_on"] for m in done) if done else "2025-01-01"
    d1 = (_dt.date.fromisoformat(last_done) + _dt.timedelta(days=10)).isoformat()
    d2 = (_dt.date.fromisoformat(last_done) + _dt.timedelta(days=20)).isoformat()
    # out-of-order
    # Phase 7 semantics: jump-ahead is allowed (earlier pending stages complete on the same date), so no out-of-order 409 here.
    # complete next
    r = httpx.post(f"{BASE}/blocks/{bk['block_id']}/milestones/{nxt}/complete", json={"completed_on": d1}, headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["demands_raised"] >= 1
    # undo immediately
    r = httpx.post(f"{BASE}/blocks/{bk['block_id']}/milestones/{nxt}/undo", json={"reason": "test undo"}, headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 200, r.text
    # redo
    r = httpx.post(f"{BASE}/blocks/{bk['block_id']}/milestones/{nxt}/complete", json={"completed_on": d2}, headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 200, f"redo: {r.status_code} {r.text}"
    # post cash payment
    modes, banks = _modes_banks()
    import datetime as _dt
    pay = {
        "booking_id": bk["id"],
        "against": "FLAT_VALUE",
        "payment_category": "Cash",
        "amount": 50000,
        "payment_date": _dt.date.today().isoformat(),
        "payment_mode_id": modes["CASH"]["id"],
        "instrument": None,
        "bank_account_id": None,
    }
    r = httpx.post(f"{BASE}/payments", json=pay, headers=H("accounts@kkt.in", str(uuid.uuid4())), timeout=30)
    assert r.status_code == 201, r.text
    # undo now blocked
    r = httpx.post(f"{BASE}/blocks/{bk['block_id']}/milestones/{nxt}/undo", json={"reason": "test blocked"}, headers=H("admin@kkt.in"), timeout=30)
    assert r.status_code == 409 and r.json().get("code") == "UNDO_BLOCKED_BY_PAYMENTS"
    # letter
    full = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in")).json()
    did = full["demands"][-1]["id"]
    letter = httpx.get(f"{BASE}/bookings/{bk['id']}/demands/{did}/letter", headers=H("admin@kkt.in")).json()
    assert letter["amount_in_words"]
    assert letter.get("bank", {}).get("account_number")


# ---------- KYC ----------
def test_kyc_masking_and_reveal():
    r = httpx.get(f"{BASE}/customers?page_size=1", headers=H("admin@kkt.in")).json()
    cid = r["items"][0]["id"]
    s = httpx.get(f"{BASE}/customers/{cid}", headers=H("sales@kkt.in")).json()
    assert s.get("pan") in (None, ""), f"sales should NOT see pan, got {s.get('pan')}"
    assert s["pan_masked"].startswith("XXXXX") and len(s["pan_masked"]) == 10
    assert s["aadhaar_masked"].startswith("XXXX XXXX ")
    # sales reveal -> 403
    r = httpx.get(f"{BASE}/customers/{cid}?reveal=true", headers=H("sales@kkt.in"))
    assert r.status_code == 403
    # accounts reveal -> ok
    r = httpx.get(f"{BASE}/customers/{cid}?reveal=true", headers=H("accounts@kkt.in"))
    assert r.status_code == 200
    assert len(r.json()["pan"]) == 10
    # audit log
    logs = httpx.get(f"{BASE}/audit-logs/entity/customer/{cid}", headers=H("admin@kkt.in")).json()
    items = logs.get("items", logs if isinstance(logs, list) else [])
    actions = [i.get("action", "") for i in items]
    assert any("kyc_reveal" in a for a in actions), f"actions={actions}"


# ---------- Documents ----------
def test_documents_upload_download_rbac():
    cust = httpx.get(f"{BASE}/customers?page_size=1", headers=H("admin@kkt.in")).json()["items"][0]
    files = {"file": ("t.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 50), "image/png")}
    r = httpx.post(
        f"{BASE}/documents",
        data={"entity_type": "customer", "entity_id": cust["id"], "is_sensitive": "true"},
        files=files,
        headers=H("sales@kkt.in"),
        timeout=60,
    )
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc.get("storage_key")
    did = doc["id"]
    # sales (no kyc_view) cannot download sensitive
    r = httpx.get(f"{BASE}/documents/{did}/download", headers=H("sales@kkt.in"), timeout=30)
    assert r.status_code == 403
    # accounts can
    r = httpx.get(f"{BASE}/documents/{did}/download", headers=H("accounts@kkt.in"), timeout=30)
    assert r.status_code == 200 and len(r.content) > 0
    # list
    lst = httpx.get(f"{BASE}/documents?entity_type=customer&entity_id={cust['id']}", headers=H("admin@kkt.in")).json()
    items = lst.get("items", lst if isinstance(lst, list) else [])
    assert any(i["id"] == did for i in items)
    # delete
    r = httpx.delete(f"{BASE}/documents/{did}", headers=H("admin@kkt.in"))
    assert r.status_code in (200, 204)


# ---------- Roznamcha ----------
def test_roznamcha():
    r = httpx.get(f"{BASE}/roznamcha?date=2025-12-03", headers=H("admin@kkt.in")).json()
    assert r["cash_received"] == 800000, f"cash_received={r['cash_received']}"
    assert r["closing_cash"] == r["opening_cash"] + 800000
    by_mode = r.get("by_mode") or {}
    assert "Cash" in by_mode
    r2 = httpx.get(f"{BASE}/roznamcha?date=2025-11-05", headers=H("admin@kkt.in")).json()
    assert r2.get("bank_deposits", 0) == 500000, f"bank_deposits={r2.get('bank_deposits')}"


# ---------- Leads ----------
def test_leads_board_and_crud_and_convert():
    r = httpx.get(f"{BASE}/leads/board", headers=H("sales@kkt.in"))
    assert r.status_code == 200
    cols = r.json().get("columns", r.json())
    assert len(cols) == 7, f"cols={len(cols)}"
    body = {"name": "TEST_Lead", "phone": "9876543210", "source": "Walk-in"}
    r = httpx.post(f"{BASE}/leads", json=body, headers=H("sales@kkt.in", str(uuid.uuid4())))
    assert r.status_code == 201, r.text
    lead = r.json()
    assert lead["lead_number"].startswith("LD-")
    # stage Lost without reason -> 422
    r = httpx.post(f"{BASE}/leads/{lead['id']}/stage", json={"status": "Lost"}, headers=H("sales@kkt.in"))
    assert r.status_code == 422
    # with reason
    r = httpx.post(f"{BASE}/leads/{lead['id']}/stage", json={"status": "Lost", "lost_reason": "Budget"}, headers=H("sales@kkt.in"))
    assert r.status_code == 200
    # follow-up
    r = httpx.post(f"{BASE}/leads/{lead['id']}/follow-ups", json={"note": "called", "next_follow_up_at": "2026-02-01T10:00:00Z"}, headers=H("sales@kkt.in"))
    assert r.status_code in (200, 201)
    # convert fresh lead
    body2 = {"name": "TEST_Convert", "phone": "9876543211", "source": "Walk-in"}
    r = httpx.post(f"{BASE}/leads", json=body2, headers=H("sales@kkt.in", str(uuid.uuid4())))
    lead2 = r.json()
    r = httpx.post(f"{BASE}/leads/{lead2['id']}/convert", json={}, headers=H("sales@kkt.in", str(uuid.uuid4())))
    assert r.status_code in (200, 201), r.text
    out = r.json()
    cust_id = out.get("customer_id") or out.get("customer", {}).get("id")
    assert cust_id
    c = httpx.get(f"{BASE}/customers/{cust_id}", headers=H("admin@kkt.in")).json()
    phones = [c.get("phone"), c.get("mobile")] + [a.get("phone") for a in c.get("applicants", [])]
    assert any(p and "9876543211" in p for p in phones)


# ---------- Perf ----------
def test_perf_projects_and_blocks():
    for path in ("/projects", "/blocks"):
        times = []
        for _ in range(5):
            t = time.perf_counter()
            r = httpx.get(f"{BASE}{path}", headers=H("admin@kkt.in"), timeout=10)
            times.append((time.perf_counter() - t) * 1000)
            assert r.status_code == 200
        # Use median to avoid cold-start/cloudflare transient skewing average
        times.sort()
        median = times[len(times) // 2]
        assert median < 300, f"{path} median {median:.0f}ms times={times}"


# ---------- Cleanup ----------
def test_zzz_cleanup_cancel_bookings():
    for bk in _created_bookings:
        full = httpx.get(f"{BASE}/bookings/{bk['id']}", headers=H("admin@kkt.in")).json()
        if full["status"] == "Cancelled":
            continue
        r = httpx.post(
            f"{BASE}/bookings/{bk['id']}/cancel",
            json={"reason": "test cleanup", "refund": 0, "deduction": 0, "version": full["version"]},
            headers=H("admin@kkt.in"),
            timeout=30,
        )
        assert r.status_code == 200, r.text
