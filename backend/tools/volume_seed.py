"""Volume dataset generator (Phase D1). Drives the real API of a backend pointed at a separate DB so every business rule
(bucket caps, idempotency, dues engine, numbering, audit) holds and the integrity checker stays clean.

  DB_NAME=kkt_volume uvicorn server:app --port 8002        # second backend process, never the demo DB
  python tools/volume_seed.py --base http://localhost:8002 --db kkt_volume [--scale 1.0]

Targets at scale 1.0: 6 projects, 36 towers, ~3,000 flats, ~2,000 customers, ~1,500 bookings, ~20,000 payments,
~400 leads, ~300 visits, ~200 service tickets. Idempotent: re-running tops up to the targets.
"""
import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import date, timedelta

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
R = random.Random(42)
FIRST = ["Amit", "Priya", "Rahul", "Sneha", "Vikram", "Anjali", "Rohit", "Kavita", "Suresh", "Neha", "Manish", "Pooja", "Deepak", "Ritu", "Sanjay", "Meera", "Arun", "Divya", "Nitin", "Shweta"]
LAST = ["Sinha", "Verma", "Ranjan", "Kumar", "Singh", "Gupta", "Mishra", "Jha", "Pandey", "Yadav", "Prasad", "Choudhary", "Srivastava", "Tiwari", "Thakur"]
CITIES = ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Ranchi"]


class Api:
    def __init__(self, base, email, password):
        self.c = httpx.AsyncClient(base_url=base, timeout=60, headers={"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")})
        self.email, self.password = email, password

    async def login(self):
        r = await self.c.post("/api/auth/login", json={"email": self.email, "password": self.password})
        r.raise_for_status()
        self.c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    async def get(self, path, **params):
        r = await self.c.get(path, params=params or None)
        if r.status_code == 401:
            await self.login()
            r = await self.c.get(path, params=params or None)
        r.raise_for_status()
        return r.json()

    async def post(self, path, body, ok=(200, 201), idem=True):
        h = {"Idempotency-Key": str(uuid.uuid4())} if idem else {}
        r = await self.c.post(path, json=body, headers=h)
        if r.status_code == 401:
            await self.login()
            r = await self.c.post(path, json=body, headers=h)
        if r.status_code not in ok:
            return None, r
        return r.json(), r


async def page_all(api, path, **params):
    out, page = [], 1
    while True:
        d = await api.get(path, page=page, page_size=200, **params)
        out += d["items"]
        if len(out) >= d.get("total", 0) or not d["items"]:
            return out
        page += 1


async def main(base, scale):
    api = Api(base, "admin@kkt.in", "Kkt@12345")
    await api.login()
    charge_types = (await api.get("/api/master/charge-types"))["items"] if True else []
    bts = (await api.get("/api/master/block-types"))["items"]
    tower = next(b for b in bts if b["name"].lower().startswith("tower"))
    fts = [f for f in (await api.get("/api/master/flat-types"))["items"] if f.get("is_active", True)]
    plans = [p for p in (await api.get("/api/master/payment-plans"))["items"] if p.get("is_active", True)]
    modes = {m["code"]: m for m in (await api.get("/api/master/payment-modes"))["items"]}
    banks = (await api.get("/api/master/bank-accounts"))["items"]
    mts = []
    users = (await api.get("/api/users", page_size=50))["items"]
    sales = [u for u in users if "sales" in (u.get("role_name") or "").lower()] or users

    # 1) projects + towers (36 total)
    projects = (await api.get("/api/projects", page_size=50))["items"]
    want = int(6 * scale)
    for i in range(len(projects), want):
        body = {"name": f"KKT Volume {CITIES[i % 6]} Heights", "code": f"V{i + 1:02d}", "project_type": "Residential", "status": "Under Construction", "address": {"city": CITIES[i % 6], "state": "Bihar"}}
        d, r = await api.post("/api/projects", {k: v for k, v in body.items() if v is not None})
        if d:
            projects.append(d)
        else:
            print("project failed", r.status_code, r.text[:160])
    projects = (await api.get("/api/projects", page_size=50))["items"]
    blocks = await page_all(api, "/api/blocks")
    per_project = max(1, round(36 * scale / max(1, len(projects))))
    for p in projects:
        have = [b for b in blocks if b["project_id"] == p["id"]]
        for j in range(len(have), per_project):
            code = f"{chr(65 + j)}" if j < 26 else f"Z{j}"
            pft = [{"position": k + 1, "flat_type_id": R.choice(fts)["id"]} for k in range(4)]
            body = {"project_id": p["id"], "block_type_id": tower["id"], "name": f"Tower {code}", "code": code, "floors": R.choice([10, 12, 14, 16, 18, 21]), "flats_per_floor": 4,
                    "floor_start": 1, "numbering_pattern": "{block}-{floor}{pos2}", "position_flat_types": pft, "rate_per_sqft": R.choice([3800, 4200, 4600, 5100]), "floor_rise_per_sqft": 40}
            d, r = await api.post("/api/blocks", body)
            if not d:
                print("block failed", p["code"], code, r.status_code, r.text[:160])
    blocks = await page_all(api, "/api/blocks")
    # project-wide default plan assignment so bookings can pick any applicable plan
    assigned = {a["project_id"] for a in (await api.get("/api/payment-plan-assignments", page_size=200))["items"] if a.get("block_id") is None}
    for p in projects:
        if p["id"] not in assigned and plans:
            await api.post("/api/payment-plan-assignments", {"payment_plan_id": plans[0]["id"], "project_id": p["id"], "is_default": True}, ok=(200, 201, 409))
            if len(plans) > 1:
                await api.post("/api/payment-plan-assignments", {"payment_plan_id": plans[1]["id"], "project_id": p["id"]}, ok=(200, 201, 409))
    flats_total = (await api.get("/api/flats", page_size=1))["total"]
    print(f"projects={len(projects)} blocks={len(blocks)} flats={flats_total}")

    # 2) customers
    customers = await page_all(api, "/api/customers")
    want = int(2000 * scale)
    sem = asyncio.Semaphore(8)

    async def mk_customer(i):
        async with sem:
            body = {"salutation": R.choice(["Mr", "Mrs", "Ms"]), "full_name": f"{R.choice(FIRST)} {R.choice(LAST)}", "phone": f"9{R.randint(100000000, 999999999)}", "email": f"vol{i}@example.in",
                    "city": R.choice(CITIES), "pincode": f"80{R.randint(1000, 9999)}", "customer_segment": R.choice(["Salaried", "Business", "NRI"]), "address_line1": f"{R.randint(1, 99)} Volume Lane"}
            d, r = await api.post("/api/customers", body)
            if not d and r.status_code == 422:
                body = {k: body[k] for k in ("salutation", "full_name", "phone", "email")}
                d, r = await api.post("/api/customers", body)
            if not d:
                print("customer failed", r.status_code, r.text[:120])
            return d
    news = await asyncio.gather(*[mk_customer(i) for i in range(len(customers), want)])
    customers += [n for n in news if n]
    print(f"customers={len(customers)}")

    # 3) bookings on available flats
    bookings = await page_all(api, "/api/bookings")
    want = int(1500 * scale)
    if len(bookings) < want:
        avail = await page_all(api, "/api/flats", status="Available")
        R.shuffle(avail)
        today = date.today()

        async def mk_booking(flat, cust):
            async with sem:
                price = flat.get("price") or 4500000
                agreement = round(price * R.uniform(0.97, 1.03), -3)
                cash = round(agreement * R.choice([0.2, 0.3, 0.4]), -3)
                bd = (today - timedelta(days=R.randint(30, 900))).isoformat()
                appl = await api.get(f"/api/projects/{flat['project_id']}/blocks/{flat['block_id']}/payment-plans")
                appl = appl.get("items") if isinstance(appl, dict) else appl
                body = {"flat_id": flat["id"], "customer_id": cust["id"], "booking_date": bd, "agreement_value": agreement, "cash_agreed": cash, "account_agreed": agreement - cash,
                        "payment_plan_id": R.choice(appl)["id"] if appl else None, "sales_user_id": R.choice(sales)["id"], "other_charges": [{"charge_type_id": charge_types[0]["id"], "amount": 60000, "demand_at": "on_booking"}] if charge_types and R.random() < 0.6 else []}
                body = {k: v for k, v in body.items() if v is not None}
                d, r = await api.post("/api/bookings", body)
                if not d and r.status_code == 422 and body.get("other_charges"):
                    body.pop("other_charges")
                    d, r = await api.post("/api/bookings", body)
                if not d:
                    print("booking failed", r.status_code, r.text[:140])
                return d
        pairs = list(zip(avail[: want - len(bookings)], R.sample(customers, min(len(customers), want - len(bookings)))))
        news = await asyncio.gather(*[mk_booking(f, c) for f, c in pairs])
        bookings += [n for n in news if n]
    print(f"bookings={len(bookings)}")

    # 4) payments: fill each booking's cash/account buckets with several instalments (cheques pending/cleared/bounced)
    paid_total = (await api.get("/api/payments", page_size=1))["total"]
    want = int(20000 * scale)
    if paid_total < want:
        per_booking = max(2, round((want - paid_total) / max(1, len(bookings))))
        today = date.today()
        cash_mode, cheque, neft = modes.get("CASH"), modes.get("CHEQUE"), modes.get("NEFT") or modes.get("RTGS") or modes.get("UPI")
        bank_id = banks[0]["id"] if banks else None

        async def pay_booking(b):
            async with sem:
                full = await api.get(f"/api/bookings/{b['id']}")
                s = full.get("summary") or {}
                cash_room = (full.get("cash_agreed_paise", 0) - s.get("cash_paid_paise", 0)) // 100
                acc_room = (full.get("account_agreed_paise", 0) - s.get("account_paid_paise", 0)) // 100
                n = 0
                for k in range(per_booking):
                    cat = "Cash" if (k % 3 == 0 and cash_room > 1000) else "Account"
                    room = cash_room if cat == "Cash" else acc_room
                    if room < 1000:
                        continue
                    amt = max(1000, min(room, round(room * R.uniform(0.05, 0.25), -3)))
                    pd = max(full["booking_date"], (today - timedelta(days=R.randint(0, 600))).isoformat())
                    if cat == "Cash":
                        body = {"booking_id": b["id"], "against": "FLAT_VALUE", "payment_category": "Cash", "amount": amt, "payment_date": pd, "payment_mode_id": cash_mode["id"], "remarks": "volume"}
                    else:
                        use_cheque = R.random() < 0.3 and cheque
                        m = cheque if use_cheque else neft
                        body = {"booking_id": b["id"], "against": "FLAT_VALUE", "payment_category": "Account", "amount": amt, "payment_date": pd, "payment_mode_id": m["id"], "bank_account_id": bank_id, "remarks": "volume",
                                "instrument": {"number": f"{R.randint(100000, 999999)}", "bank_name": "SBI", "date": pd}}
                    d, r = await api.post("/api/payments", body)
                    if not d:
                        if r.status_code in (409, 422):
                            break
                        print("payment failed", r.status_code, r.text[:140])
                        break
                    n += 1
                    if cat == "Cash":
                        cash_room -= amt
                    else:
                        acc_room -= amt
                    if d.get("status") == "Pending":
                        x = R.random()
                        if x < 0.6:
                            await api.post(f"/api/payments/{d['id']}/clear", {"cleared_on": pd})
                        elif x < 0.75:
                            await api.post(f"/api/payments/{d['id']}/bounce", {"reason": "Insufficient funds"})
                return n
        counts = await asyncio.gather(*[pay_booking(b) for b in bookings])
        print(f"payments posted={sum(counts)}")

    # 5) leads, visits, service tickets
    leads = (await api.get("/api/leads", page_size=1))["total"]
    for i in range(leads, int(400 * scale)):
        body = {"name": f"{R.choice(FIRST)} {R.choice(LAST)}", "phone": f"8{R.randint(100000000, 999999999)}", "source": R.choice(["Walk-in", "Website", "Referral", "Broker", "Hoarding"]), "project_id": R.choice(projects)["id"]}
        d, r = await api.post("/api/leads", body)
        if d and R.random() < 0.6:
            await api.post(f"/api/leads/{d['id']}/stage", {"status": R.choice(["Contacted", "Site Visit", "Negotiation"])}, ok=(200, 201, 409))
    visits = (await api.get("/api/site-visits", page_size=1))["total"]
    all_leads = (await api.get("/api/leads", page_size=200))["items"]
    for i in range(visits, int(300 * scale)):
        p = R.choice(projects)
        d = (date.today() + timedelta(days=R.randint(1, 20))).isoformat()
        body = {"project_id": p["id"], "date": d, "slot_start": R.choice(["10:00", "11:00", "12:00", "14:00", "15:00"]), "lead_id": R.choice(all_leads)["id"] if all_leads else None, "visitors_count": R.randint(1, 3)}
        await api.post("/api/site-visits", {k: v for k, v in body.items() if v is not None}, ok=(200, 201, 409, 422))
    srs = (await api.get("/api/service-requests", page_size=1))["total"]
    for i in range(srs, int(200 * scale)):
        b = R.choice(bookings)
        body = {"customer_id": b["customer_id"], "booking_id": b["id"], "category": R.choice(["Plumbing", "Electrical", "Documentation", "Payments"]), "priority": R.choice(["Low", "Medium", "High"]), "subject": f"Volume ticket {i}", "description": "Generated for load profiling."}
        await api.post("/api/service-requests", body, ok=(200, 201, 422))
    tot = {k: (await api.get(f"/api/{k}", page_size=1))["total"] for k in ("projects", "blocks", "flats", "customers", "bookings", "payments", "leads", "site-visits", "service-requests")}
    print("TOTALS", tot)
    rep = await api.get("/api/admin/integrity-report", fresh=1)
    print("INTEGRITY ok=", rep.get("ok"), rep.get("counts"))
    await api.c.aclose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8002")
    ap.add_argument("--db", default="kkt_volume")
    ap.add_argument("--scale", type=float, default=1.0)
    a = ap.parse_args()
    asyncio.run(main(a.base, a.scale))
