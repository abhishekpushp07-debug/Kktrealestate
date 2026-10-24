import asyncio
import io
import json
import os
import sys
import uuid

import httpx
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


async def login(c, email):
    r = await c.post("/auth/login", json={"email": email, "password": "Kkt@12345"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def main():
    async with httpx.AsyncClient(base_url=API, timeout=60) as c:
        H = await login(c, "admin@kkt.in")
        S = await login(c, "sales@kkt.in")
        A = await login(c, "accounts@kkt.in")
        cust = (await c.get("/customers?page_size=3", headers=H)).json()["items"]
        flats = (await c.get("/flats?status=Available&search=A-6&page_size=5", headers=H)).json()["items"]
        f = flats[0]
        print("flat", f["flat_number"], f["price"])
        body = {"flat_id": f["id"], "customer_id": cust[0]["id"], "booking_date": "2026-09-01", "agreement_value": 6000000, "cash_agreed": 2000000, "account_agreed": 4000000, "other_charges": [], "parking_slot_ids": []}
        bad = await c.post("/bookings", json={**body, "cash_agreed": 1000000}, headers=H)
        print("sum mismatch ->", bad.status_code, bad.json()["detail"][:60])
        r1, r2 = await asyncio.gather(c.post("/bookings", json=body, headers={**H, "Idempotency-Key": str(uuid.uuid4())}), c.post("/bookings", json={**body, "customer_id": cust[1]["id"]}, headers={**S, "Idempotency-Key": str(uuid.uuid4())}))
        print("concurrent ->", sorted([r1.status_code, r2.status_code]), [x.json().get("code") for x in (r1, r2) if x.status_code != 201])
        bk = (r1 if r1.status_code == 201 else r2).json()
        print("booking", bk["booking_number"], "pct", bk["construction_percent"], "due", bk["summary"]["due"])
        modes = {m["code"]: m for m in (await c.get("/master/payment-modes?page_size=50", headers=H)).json()["items"]}
        banks = (await c.get("/master/bank-accounts", headers=H)).json()["items"]
        pay = {"booking_id": bk["id"], "against": "FLAT_VALUE", "payment_category": "Account", "amount": 4500000, "payment_date": "2026-09-10", "payment_mode_id": modes["NEFT_RTGS"]["id"], "instrument": {"number": "UTR1"}, "bank_account_id": banks[0]["id"]}
        r = await c.post("/payments", json=pay, headers=A)
        print("no idem key ->", r.status_code, r.json()["code"])
        r = await c.post("/payments", json=pay, headers={**A, "Idempotency-Key": str(uuid.uuid4())})
        print("cap ->", r.status_code, r.json()["code"], r.json()["detail"])
        r = await c.post(f"/bookings/{bk['id']}/agreement-revisions", json={"cash_agreed": 1500000, "account_agreed": 4500000, "reason": "Higher loan", "version": bk["version"]}, headers=S)
        print("sales revise ->", r.status_code)
        r = await c.post(f"/bookings/{bk['id']}/agreement-revisions", json={"cash_agreed": 1500000, "account_agreed": 4500000, "reason": "Higher loan", "version": bk["version"]}, headers=H)
        print("admin revise ->", r.status_code, r.json()["agreement_value"], len(r.json()["agreement_revisions"]))
        key = str(uuid.uuid4())
        r = await c.post("/payments", json=pay, headers={**A, "Idempotency-Key": key})
        r2 = await c.post("/payments", json=pay, headers={**A, "Idempotency-Key": key})
        print("after revision ->", r.status_code, r.json()["receipt_number"], "replay", r2.status_code, r2.headers.get("idempotent-replayed"), r.json()["id"] == r2.json()["id"])
        n = (await c.get(f"/payments?booking_id={bk['id']}", headers=A)).json()["total"]
        print("payments count", n)
        # cheque pending/clear/bounce
        chq = {**pay, "payment_category": "Cash", "amount": 300000, "payment_mode_id": modes["CHEQUE"]["id"], "instrument": {"number": "CHQ100", "bank_name": "SBI"}}
        p1 = (await c.post("/payments", json=chq, headers={**A, "Idempotency-Key": str(uuid.uuid4())})).json()
        p2 = (await c.post("/payments", json={**chq, "instrument": {"number": "CHQ101"}}, headers={**A, "Idempotency-Key": str(uuid.uuid4())})).json()
        s = (await c.get(f"/bookings/{bk['id']}", headers=H)).json()["summary"]
        print("cheques pending:", p1["status"], "cash_paid", s["cash_paid"], "pending", s["pending_cheques"])
        await c.post(f"/payments/{p1['id']}/clear", headers=A)
        await c.post(f"/payments/{p2['id']}/bounce", json={"reason": "Insufficient funds"}, headers=A)
        s = (await c.get(f"/bookings/{bk['id']}", headers=H)).json()["summary"]
        print("after clear/bounce cash_paid", s["cash_paid"], "cash_due", s["cash_due"])
        r = await c.post(f"/payments/{p1['id']}/reverse", json={"reason": "Wrong booking"}, headers=A)
        s = (await c.get(f"/bookings/{bk['id']}", headers=H)).json()["summary"]
        led = (await c.get(f"/bookings/{bk['id']}/ledger", headers=H)).json()["rows"]
        rec = (await c.get(f"/payments/{p1['id']}/receipt", headers=A)).json()
        print("reversal ->", r.status_code, "cash_paid", s["cash_paid"], [x["type"] for x in led], "receipt cancelled", rec["cancelled"], rec["amount_in_words"])
        # milestones on this block
        ms = (await c.get(f"/blocks/{bk['block_id']}/milestones", headers=H)).json()
        print("milestones next", ms["next_seq"], "pct", ms["block"]["construction_percent"], "active", ms["active_bookings"])
        r = await c.post(f"/blocks/{bk['block_id']}/milestones/{ms['next_seq'] + 1}/complete", json={"completed_on": "2026-09-15"}, headers=H)
        print("out of order ->", r.status_code, r.json()["code"])
        r = await c.post(f"/blocks/{bk['block_id']}/milestones/{ms['next_seq']}/complete", json={"completed_on": "2026-09-15"}, headers=H)
        print("complete ->", r.status_code, "demands", r.json()["demands_raised"], [(d["booking_id"][:6], d["total_demand"]) for d in r.json()["demands"]][:3])
        r = await c.post(f"/blocks/{bk['block_id']}/milestones/{ms['next_seq']}/undo", json={"reason": "test"}, headers=H)
        print("undo (no payment after) ->", r.status_code, r.json().get("demands_voided"))
        r = await c.post(f"/blocks/{bk['block_id']}/milestones/{ms['next_seq']}/complete", json={"completed_on": "2026-09-15"}, headers=H)
        p = (await c.post("/payments", json={**pay, "payment_category": "Cash", "amount": 100000, "payment_mode_id": modes["CASH"]["id"], "instrument": None, "bank_account_id": None, "payment_date": "2026-09-16"}, headers={**A, "Idempotency-Key": str(uuid.uuid4())})).json()
        r = await c.post(f"/blocks/{bk['block_id']}/milestones/{ms['next_seq']}/undo", json={"reason": "test"}, headers=H)
        print("undo after payment ->", r.status_code, r.json().get("code"))
        d = (await c.get(f"/bookings/{bk['id']}", headers=H)).json()["demands"]
        letter = (await c.get(f"/bookings/{bk['id']}/demands/{d[-1]['id']}/letter", headers=H)).json()
        print("letter", letter["demand"]["demand_number"], letter["amount_in_words"], letter["bank"]["account_number"][-4:])
        # document upload
        files = {"file": ("test.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 100), "image/png")}
        r = await c.post("/documents", data={"entity_type": "customer", "entity_id": cust[0]["id"], "is_sensitive": "true"}, files=files, headers=S)
        print("upload ->", r.status_code, r.json().get("storage_key", r.json().get("detail")))
        if r.status_code == 201:
            did = r.json()["id"]
            r1 = await c.get(f"/documents/{did}/download", headers=S)
            r2 = await c.get(f"/documents/{did}/download", headers=A)
            print("download sales(sensitive) ->", r1.status_code, "accounts ->", r2.status_code, len(r2.content))
        # cancel booking
        bk2 = (await c.get(f"/bookings/{bk['id']}", headers=H)).json()
        r = await c.post(f"/bookings/{bk['id']}/cancel", json={"reason": "test cancel", "refund": 100000, "deduction": 0, "version": bk2["version"]}, headers=H)
        fl = (await c.get(f"/flats/{f['id']}", headers=H)).json()
        print("cancel ->", r.status_code, r.json().get("status"), "flat", fl["status"])
        r = await c.post("/payments", json={**pay, "amount": 1000}, headers={**A, "Idempotency-Key": str(uuid.uuid4())})
        print("pay after cancel ->", r.status_code, r.json()["code"])
        rec = (await c.post("/admin/reconcile-ledgers", headers=H)).json()
        print("reconcile mismatches", len(rec["mismatches"]))


asyncio.run(main())
