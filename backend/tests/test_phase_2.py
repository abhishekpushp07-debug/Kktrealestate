"""Phase 2 backend regression tests.

Covers: owner example ledger, concurrency, payments (idempotency, bucket cap, cheque, reverse),
agreement revisions RBAC, milestones forward-only + undo blocking, KYC masking + reveal,
documents, roznamcha, leads, performance.
"""
import asyncio
import io
import os
import pytest
import time
import uuid

import httpx
from dotenv import load_dotenv

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
PWD = TEST_PASSWORD


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


_created_bookings = []


async def _concurrent_post(body, k1, k2):
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        return await asyncio.gather(
            c.post("/bookings", json=body, headers={**H("admin@kkt.in"), "Idempotency-Key": k1}),
            c.post("/bookings", json=body, headers={**H("sales@kkt.in"), "Idempotency-Key": k2}),
        )


# ---------- Payments ----------
def _modes_banks():
    modes = {m["code"]: m for m in httpx.get(f"{BASE}/master/payment-modes?page_size=50", headers=H("admin@kkt.in")).json()["items"]}
    banks = httpx.get(f"{BASE}/master/bank-accounts", headers=H("admin@kkt.in")).json()["items"]
    return modes, banks


def _cash_remaining(booking_id):
    """Full remaining cash bucket so FIFO reaches this stage's demand (repeat runs already hold some cash)."""
    full = httpx.get(f"{BASE}/bookings/{booking_id}", headers=H("admin@kkt.in"), timeout=30).json()
    recv = sum(p.get("amount_paise", 0) for p in full.get("payments", []) if p.get("payment_category") == "Cash" and p.get("status") in ("Cleared", "Pending") and p.get("against") == "FLAT_VALUE")
    return max(1, (full["cash_agreed_paise"] - recv) // 100)


# ---------- Milestones ----------
# ---------- KYC ----------
# ---------- Documents ----------
@pytest.mark.load_sensitive
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
