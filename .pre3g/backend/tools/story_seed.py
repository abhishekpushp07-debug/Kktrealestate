"""Phase H story seeder — replays FY 2025-26 → today through the REAL API with an audited X-As-Of clock (seeder-only).
Nothing is written directly. Deterministic (seeded RNG) → identical numbers on every `admin/reseed`.
Run: python tools/story_seed.py [--as-of 2026-10-26] [--base http://localhost:8001]"""

import argparse
import asyncio
import os
import random
import re
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone

import httpx
from _env import DEMO_PASSWORD

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services import clock

R = random.Random(2526)
STORY_PROJECT_CODES = frozenset({"SGH", "GGV"})  # created by the base seed; everything else is the owner's


def cap_future(stamp: str, real_now: datetime | None = None) -> str:
    """A date-only as-of lands at 10:30 IST; a stamp that would still be in the future at run time (nightly refresh
    at 03:00) is stamped at the real run time instead — date-only and full-timestamp as-ofs alike. Demo timing only."""
    now_ist = (real_now or datetime.now(timezone.utc)).astimezone(clock.IST).replace(microsecond=0)
    if len(stamp) == 10:
        at = datetime.combine(date.fromisoformat(stamp), time(10, 30), tzinfo=clock.IST)
    else:
        at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if at.tzinfo is None:
            at = at.replace(tzinfo=clock.IST)
    return now_ist.isoformat() if at > now_ist else stamp


BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")
START = date(2025, 4, 1)
FIRST = [
    "Amit",
    "Priya",
    "Rahul",
    "Sunita",
    "Vikash",
    "Neha",
    "Manoj",
    "Kavita",
    "Santosh",
    "Deepak",
    "Anjali",
    "Ravi",
    "Rajeev",
    "Meera",
    "Imran",
    "Anil",
    "Pooja",
    "Suresh",
    "Nandini",
    "Vikram",
    "Fatima",
    "Harish",
    "Ritu",
    "Mohan",
    "Sanjay",
    "Divya",
    "Arun",
    "Shweta",
    "Nitin",
    "Rekha",
    "Gaurav",
    "Alka",
    "Pankaj",
    "Seema",
    "Rakesh",
    "Jyoti",
    "Ashok",
    "Madhu",
    "Sudhir",
    "Kiran",
    "Vinod",
    "Usha",
    "Prakash",
    "Sarita",
    "Dinesh",
    "Lata",
    "Mukesh",
    "Geeta",
    "Ramesh",
    "Nisha",
    "Ajay",
    "Bina",
    "Rohit",
    "Smita",
    "Yogesh",
    "Archana",
    "Alok",
    "Shalini",
    "Naveen",
    "Preeti",
    "Umesh",
    "Vandana",
    "Tarun",
    "Renu",
    "Satish",
    "Mamta",
    "Lalit",
    "Hema",
]
LAST = [
    "Sinha",
    "Verma",
    "Ranjan",
    "Devi",
    "Choudhary",
    "Singh",
    "Tiwari",
    "Jha",
    "Yadav",
    "Mishra",
    "Gupta",
    "Prasad",
    "Kumar",
    "Srivastava",
    "Thakur",
    "Pandey",
    "Iyer",
    "Qureshi",
    "Rao",
    "Begum",
    "Mehta",
    "Malhotra",
    "Lal",
    "Agarwal",
    "Khan",
    "Das",
    "Sharma",
    "Jaiswal",
]
log = lambda *a: print(*a, flush=True)


def d2s(d: date) -> str:
    return d.isoformat()


class Api:
    def __init__(self, base):
        self.c = httpx.AsyncClient(base_url=base, timeout=120, headers={"X-Rate-Limit-Bypass": BYPASS})
        self.calls = 0
        self.today = None

    async def login(self, email="admin@kkt.in", password=DEMO_PASSWORD):
        r = await self.c.post("/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        self.c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    async def req(self, method, path, body=None, as_of=None, ok=(200, 201), **params):
        h = {"Idempotency-Key": str(uuid.uuid4())}
        if as_of:
            h["X-As-Of"] = as_of if isinstance(as_of, str) else d2s(as_of)
            if self.today and h["X-As-Of"][:10] > d2s(self.today):  # E2: nothing may be dated after the as-of day
                raise RuntimeError(f"story: {method} {path} dated {h['X-As-Of']} is after today {self.today}")
            h["X-As-Of"] = cap_future(h["X-As-Of"])
        for attempt in range(3):
            r = await self.c.request(method, path, json=body, params=params or None, headers=h)
            self.calls += 1
            if r.status_code == 401:
                await self.login()
                continue
            if r.status_code == 429:
                await asyncio.sleep(1)
                continue
            break
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {path} as_of={as_of} → {r.status_code} {r.text[:300]} body={body}")
        return r.json() if r.content else None

    async def get(self, path, as_of=None, **params):
        return await self.req("GET", path, as_of=as_of, **params)

    async def post(self, path, body, as_of=None, ok=(200, 201)):
        return await self.req("POST", path, body, as_of=as_of, ok=ok)

    async def patch(self, path, body, as_of=None):
        return await self.req("PATCH", path, body, as_of=as_of)

    async def put(self, path, body, as_of=None):
        return await self.req("PUT", path, body, as_of=as_of)


class Story:
    def __init__(self, api: Api, today: date):
        self.api, self.today = api, today
        api.today = today
        self.bookings: list[dict] = []  # {id, number, archetype, project, block, flat, customer_id, rm}
        self.customers_phone = 9431012345
        self.lead_phone = 9876500000
        self.n_cust = 0
        self.stats = {}

    # ---------- setup ----------
    async def ensure_sgh_cover(self):
        """REQ-184: SGH carries The Elite tower photo as its cover — uploaded once, never rewritten."""
        sgh = self.projects.get("SGH")
        if not sgh or sgh.get("cover_image_url"):
            return
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "elite_tower.jpg")
        with open(path, "rb") as fh:
            r = await self.api.c.post(
                f"/api/projects/{sgh['id']}/photos", files={"file": ("elite_tower.jpg", fh.read(), "image/jpeg")}
            )
        r.raise_for_status()

    async def load_setup(self):
        a = self.api
        # only the story's own projects: owner-created setup (e.g. "Ye") is never written by a refresh
        self.projects = {
            p["code"]: p
            for p in (await a.get("/api/projects", page_size=50))["items"]
            if p["code"] in STORY_PROJECT_CODES
        }
        await self.ensure_sgh_cover()
        self.blocks = {}
        for code, p in self.projects.items():
            for b in (await a.get("/api/blocks", project_id=p["id"], page_size=50))["items"]:
                self.blocks[f"{code}-{b['code']}"] = {**b, "project_code": code}
        self.flats = {}
        for key, b in self.blocks.items():
            self.flats[key] = sorted(
                (await a.get("/api/flats", block_id=b["id"], page_size=200))["items"],
                key=lambda f: (f["floor"], f["position"]),
            )
        self.plans = {}
        for key, b in self.blocks.items():
            self.plans[key] = (await a.get(f"/api/projects/{b['project_id']}/blocks/{b['id']}/payment-plans"))["items"]
        self.modes = {m["code"]: m["id"] for m in (await a.get("/api/master/payment-modes"))["items"]}
        self.charges = {c["code"]: c for c in (await a.get("/api/master/charge-types"))["items"]}
        self.bank = (await a.get("/api/master/bank-accounts"))["items"][0]
        users = (await a.get("/api/users", page_size=100))["items"]
        roles = {r["name"]: r["id"] for r in (await a.get("/api/roles"))["items"]}
        emails = {u["email"]: u for u in users}
        for name, email, role in (
            ("Neha Singh", "sales@kkt.in", "Sales"),
            ("Rohit Kumar", "sales2@kkt.in", "Sales"),
            ("Sunil Das", "support@kkt.in", "Accounts"),
        ):
            if email not in emails:
                emails[email] = await a.post(
                    "/api/users",
                    {
                        "name": name,
                        "email": email,
                        "phone": f"98765{R.randint(10000, 99999)}",
                        "password": DEMO_PASSWORD,
                        "role_id": roles[role],
                    },
                    as_of=START,
                )
        self.rms = [emails["sales@kkt.in"], emails["sales2@kkt.in"]]
        self.support = emails["support@kkt.in"]
        self.stage_ids = {}
        for key, b in self.blocks.items():
            self.stage_ids[key] = [
                (s["seq"], s["stage_id"], s["name"])
                for s in (await a.get(f"/api/blocks/{b['id']}/construction"))["stages"]
            ]
        await a.patch(
            f"/api/projects/{self.projects['SGH']['id']}",
            {
                "cancellation_policy": {
                    "deduction_type": "percent",
                    "deduction_base": "received",
                    "deduction_value": 10,
                    "gst_on_deduction": False,
                    "refund_sla_days": 45,
                }
            },
            as_of=START,
        )
        await a.patch(
            f"/api/projects/{self.projects['GGV']['id']}",
            {
                "cancellation_policy": {
                    "deduction_type": "percent",
                    "deduction_base": "agreement",
                    "deduction_value": 2,
                    "gst_on_deduction": False,
                    "refund_sla_days": 60,
                }
            },
            as_of=START,
        )
        for p in self.projects.values():  # site-visit booking enabled from day one (all weekdays, 3 per slot)
            await a.patch(
                f"/api/cms/projects/{p['id']}/website",
                {
                    "site_visits": {
                        "enabled": True,
                        "visit_days": [0, 1, 2, 3, 4, 5, 6],
                        "start_time": "10:00",
                        "end_time": "18:00",
                        "slot_minutes": 60,
                        "capacity_per_slot": 3,
                        "min_lead_hours": 3,
                        "max_days_ahead": 30,
                        "blackout_dates": [],
                    }
                },
                as_of=START,
            )
        # Phase PS: project pricing setup — agreement GST 5 %, maintenance method, Club head pre-listed on SGH (every value explicit, nothing assumed)
        self.slots = {}
        for code, p in self.projects.items():
            cur = await a.get(f"/api/projects/{p['id']}/pricing-setup")
            heads = [
                {
                    "charge_type_id": self.charges["CLUB"]["id"],
                    "enabled": code == "SGH",
                    "value": 100000,
                    "gst_percent": 18,
                    "timing": "on_booking",
                }
            ]
            await a.put(
                f"/api/projects/{p['id']}/pricing-setup",
                {
                    "agreement_gst_percent": 5,
                    "floor_rise_enabled": cur.get("floor_rise_enabled", False),
                    "rounding": "nearest_100",
                    "maintenance": {
                        "method": "per_sqft_months",
                        "rate_per_sqft": 2.5 if code == "SGH" else 2,
                        "months": 24,
                    },
                    "charge_heads": heads,
                    "version": cur.get("version"),
                },
                as_of=START,
            )
            self.slots[code] = [
                x
                for x in (await a.get("/api/parking", project_id=p["id"], page_size=200))["items"]
                if x["status"] == "Available" and not x.get("flat_id")
            ]
        log(
            "setup",
            {k: len(v) for k, v in self.flats.items()},
            "plans",
            {k: len(v) for k, v in self.plans.items()},
            "slots",
            {k: len(v) for k, v in self.slots.items()},
        )

    # ---------- helpers ----------
    def months(self):
        d = START
        while d <= self.today:
            yield d
            d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)

    def name(self):
        self.n_cust += 1
        if self.n_cust == 1:
            return "Amit Kumar Sinha"
        if self.n_cust == 2:
            self.customers_phone = 9431023456 - 11  # Priya Verma — the portal persona used by the hardening/leak tests
            return "Priya Verma"
        return f"{FIRST[(self.n_cust - 1) % len(FIRST)]} {LAST[(self.n_cust * 7) % len(LAST)]}"

    async def customer(self, name, when, rm, source="Walk-in", nri=False):
        if self.n_cust > 1:
            self.customers_phone += 11 if self.n_cust == 2 else R.choice([11, 13, 17, 19, 23])
        c = await self.api.post(
            "/api/customers",
            {
                "full_name": name,
                "phone": f"+91{self.customers_phone}",
                "email": f"{name.split()[0].lower()}.{self.customers_phone % 1000}@example.com",
                "source": source,
                "assigned_sales_user_id": rm["id"],
                "occupation": R.choice(["Salaried", "Business", "Doctor", "Government", "NRI" if nri else "Retired"]),
                "address_current": {
                    "line1": f"{R.randint(1, 99)}, {R.choice(['Boring Road', 'Kankarbagh', 'Patliputra Colony', 'Rajendra Nagar'])}",
                    "city": "Patna",
                    "state": "Bihar",
                    "pincode": f"8000{R.randint(10, 99)}",
                },
            },
            as_of=when,
        )
        await self.api.post(
            f"/api/customers/{c['id']}/kyc-status",
            {"kyc_status": "Verified", "note": "KYC verified at booking desk"},
            as_of=when + timedelta(days=1),
        )
        return c

    async def lead(self, name, when, project, rm, source):
        self.lead_phone += R.choice([7, 11, 13])
        return await self.api.post(
            "/api/leads",
            {
                "name": name,
                "phone": f"+91{self.lead_phone}",
                "project_id": project["id"],
                "source": source,
                "assigned_to": rm["id"],
                "notes": "story seed",
            },
            as_of=when,
        )

    async def visit(self, lead, project, when, outcome="complete"):
        v = await self.api.post(
            "/api/site-visits",
            {
                "project_id": project["id"],
                "date": d2s(when),
                "slot_start": R.choice(["10:00", "11:00", "12:00", "15:00", "16:00"]),
                "lead_id": lead["id"],
                "visitors_count": R.randint(1, 3),
            },
            as_of=when - timedelta(days=2),
        )
        await self.api.post(
            f"/api/site-visits/{v['id']}/{outcome}",
            {"note": "Could not make it" if outcome != "complete" else "Liked the sample flat"},
            as_of=when,
        )
        return v

    def pick_flat(self, key):
        avail = [f for f in self.flats[key] if f["status"] == "Available"]
        if not avail:  # block sold out → next block in the same project with stock
            for k2 in ("SGH-C", "SGH-B", "SGH-A"):
                avail = [f for f in self.flats[k2] if f["status"] == "Available"]
                if avail:
                    break
        f = avail[R.randrange(len(avail))]
        f["status"] = "Booked"
        return f

    async def book(self, key, when, archetype, cash_pct=None, charges=None, co=None, remarks=None):
        b = self.blocks[key]
        project = self.projects[b["project_code"]]
        rm = self.rms[len(self.bookings) % 2]
        source = R.choice(["Website", "Walk-in", "Referral", "Brochure", "Broker"])
        nm = self.name()
        ld = await self.lead(nm, when - timedelta(days=R.randint(15, 40)), project, rm, source)
        await self.api.post(
            f"/api/leads/{ld['id']}/stage",
            {"status": "Contacted", "note": "Called back"},
            as_of=when - timedelta(days=14),
        )
        if archetype == "noshow":
            await self.visit(ld, project, when - timedelta(days=12), "no-show")
        await self.visit(ld, project, when - timedelta(days=8), "complete")
        cust = await self.customer(nm, when - timedelta(days=4), rm, source, nri=archetype == "advance")
        flat = self.pick_flat(key)
        key = next(k for k, fl in self.flats.items() if any(x["id"] == flat["id"] for x in fl))
        b = self.blocks[key]
        price = flat["price"]
        # Phase PS: the flat sheet is filled explicitly before booking — saleable area / rate confirmed, maintenance
        # method, a parking slot attached for every 2nd booking
        pcode = b["project_code"]
        rate = flat.get("rate_per_sqft") or (
            b.get("rate_per_sqft") if not price else None
        )  # unpriced flat → explicit rate from the tower's rate
        sheet = {
            "saleable_sqft": flat.get("saleable_sqft") or flat.get("super_builtup_sqft"),
            "pricing_mode": "rate" if rate else "lump_sum",
            "maintenance": {"method": "per_sqft_months", "rate_per_sqft": 2.5 if pcode == "SGH" else 2, "months": 24},
        }
        if sheet["pricing_mode"] == "rate":
            sheet["rate_per_sqft"] = rate
        else:
            if not price:  # unpriced lump-sum unit → explicit price from the flat type's suggested base price
                ft = await self.api.get(f"/api/master/flat-types/{flat['flat_type_id']}")
                price = ft.get("base_price") or 10500000
            sheet["price"] = price
        if sheet["saleable_sqft"]:
            cur = await self.api.get(f"/api/flats/{flat['id']}")
            upd = await self.api.patch(
                f"/api/flats/{flat['id']}/pricing", {**sheet, "version": cur["version"]}, as_of=when - timedelta(days=2)
            )
            flat["price"] = price = upd.get("price") or price
        if len(self.bookings) % 2 == 0 and self.slots.get(pcode) and archetype != "owner":
            slot = self.slots[pcode].pop(0)
            await self.api.post(
                f"/api/parking/{slot['id']}/attach", {"flat_id": flat["id"]}, as_of=when - timedelta(days=2)
            )
        plan = next(
            (p for p in self.plans[key] if p.get("is_default")), self.plans[key][0] if self.plans[key] else None
        )
        if (
            archetype == "owner"
        ):  # owner's worked example: ₹1 Cr flat, 100 % raised on booking (lump-sum plan created + assigned through the API)
            await self.api.patch(f"/api/flats/{flat['id']}", {"price": 10000000}, as_of=when - timedelta(days=1))
            flat["price"] = price = 10000000
            if not getattr(self, "owner_plan", None):
                self.owner_plan = await self.plan_by_code("LUMP100") or await self.api.post(
                    "/api/master/payment-plans",
                    {
                        "name": "Lump sum (100% on booking)",
                        "code": "LUMP100",
                        "plan_type": "DP",
                        "installments": [
                            {
                                "seq": 1,
                                "name": "On booking",
                                "percent": 100,
                                "trigger_type": "ON_BOOKING",
                                "due_days": 7,
                            }
                        ],
                    },
                    as_of=when - timedelta(days=1),
                )
                await self.assign_once(self.owner_plan, b, when - timedelta(days=1))
            plan = self.owner_plan
        if (
            archetype == "loan" and key == "SGH-C"
        ):  # home-loan buyers get 45 days per stage bill (plan instalment due_days)
            plan = await self.loan_plan(plan, b, when)
        pct = cash_pct if cash_pct is not None else (60 if b["project_code"] == "SGH" else 0)
        if not price:
            raise RuntimeError(
                (
                    f"story: flat {flat['flat_number']} has no price after sheet {sheet} "
                    f"(flat={ {k: flat.get(k) for k in ('saleable_sqft', 'rate_per_sqft', 'price', 'pricing_mode')} })"
                )
            )
        cash = round(price * pct / 100, 2)
        # Phase PS: pre-listed lines (project heads + parking per attached slot + maintenance) exactly as the wizard
        # shows them, plus any archetype-specific heads
        pre = await self.api.post(
            "/api/bookings/breakdown-preview",
            {"flat_id": flat["id"], "agreement_value": price, "has_plan": bool(plan)},
            as_of=when,
        )
        oc = [
            {
                "charge_type_id": c.get("charge_type_id"),
                "name": c["name"],
                "source": c.get("source"),
                "amount": c["amount"],
                "gst_percent": c["gst_percent"],
                "demand_at": c["demand_at"],
            }
            for c in pre["charges"]
            if c.get("code") != "AGR_GST" and archetype != "owner"  # owner's worked example = agreement value only
        ]
        for code, mode in charges or []:
            ct = self.charges[code]
            if any(c.get("charge_type_id") == ct["id"] for c in oc):
                continue
            oc.append(
                {
                    "charge_type_id": ct["id"],
                    "amount": ct.get("default_value") or ct.get("default_amount") or 25000,
                    "gst_percent": ct.get("default_gst_percent", 18 if ct.get("is_taxable") else 0),
                    "demand_at": mode,
                }
            )
        body = {
            "flat_id": flat["id"],
            "customer_id": cust["id"],
            "booking_date": d2s(when),
            "agreement_value": price,
            "cash_agreed": cash,
            "account_agreed": round(price - cash, 2),
            "lead_id": ld["id"],
            "sales_user_id": rm["id"],
            "payment_plan_id": plan["id"] if plan else None,
            "other_charges": oc,
            "agreement_gst_percent": 0 if archetype == "owner" else 5,  # owner's worked example is agreement-only
            "remarks": remarks or f"story:{archetype}",
            "co_applicant_customer_ids": [co["id"]] if co else [],
        }
        bk = await self.api.post("/api/bookings", body, as_of=when)
        rec = {
            "id": bk["id"],
            "number": bk["booking_number"],
            "archetype": archetype,
            "key": key,
            "flat": flat,
            "customer_id": cust["id"],
            "rm": rm,
            "booked": when,
            "project": b["project_code"],
            "active": True,
        }
        self.bookings.append(rec)
        return rec

    async def loan_plan(self, base: dict, b: dict, when: date) -> dict:
        """Copy of the tower's default plan with 45 days to pay each stage bill, created + assigned through the API."""
        if not getattr(self, "_loan_plan", None):
            keep = ("seq", "name", "percent", "trigger_type", "trigger_days", "trigger_stage_id", "trigger_date")
            ins = [
                {**{k: i.get(k) for k in keep}, "due_days": 45 if i["trigger_type"] != "ON_BOOKING" else None}
                for i in base["installments"]
            ]
            self._loan_plan = await self.plan_by_code("CLP45") or await self.api.post(
                "/api/master/payment-plans",
                {"name": "CLP home loan (45 days to pay)", "code": "CLP45", "plan_type": "CLP", "installments": ins},
                as_of=when - timedelta(days=1),
            )
            await self.assign_once(self._loan_plan, b, when - timedelta(days=1))
        return self._loan_plan

    async def plan_by_code(self, code: str) -> dict | None:
        items = (await self.api.get("/api/master/payment-plans", page_size=200))["items"]
        return next((p for p in items if p.get("code") == code and p.get("is_active", True)), None)

    async def assign_once(self, plan: dict, b: dict, when: date) -> None:
        cur = (await self.api.get("/api/payment-plan-assignments", payment_plan_id=plan["id"]))["items"]
        if not any(x.get("block_id") == b["id"] for x in cur):
            await self.api.post(
                "/api/payment-plan-assignments",
                {"payment_plan_id": plan["id"], "project_id": b["project_id"], "block_id": b["id"]},
                as_of=when,
            )

    async def pay(
        self, bk, when, category, amount, mode="CASH", ref=None, against="FLAT_VALUE", line_id=None, rng=None
    ):
        when = max(when, bk["booked"])
        log(
            f"  pay {d2s(when)} {bk['archetype']} {bk['flat']['flat_number']} {category} {amount} {mode} rng={hash(R.getstate()[1]) & 0xFFFF:04x}"
        )
        if amount <= 0 or when > self.today:
            return None
        body = {
            "booking_id": bk["id"],
            "against": against,
            "payment_category": category if against == "FLAT_VALUE" else None,
            "other_charge_line_id": line_id,
            "amount": round(amount / 100, 2),
            "payment_date": d2s(when),
            "payment_mode_id": self.modes[mode],
            "remarks": f"story:{bk['archetype']}",
        }
        if mode in ("CHEQUE", "DD", "NEFT_RTGS", "LOAN_DISBURSEMENT", "UPI"):
            rr = rng or R
            body["instrument"] = {
                "number": ref or f"{mode[:3]}{rr.randint(100000, 999999)}",
                "date": d2s(when),
                "bank_name": rr.choice(["SBI", "HDFC Bank", "PNB", "Bank of Baroda"]),
            }
            body["bank_account_id"] = self.bank["id"]
        return await self.api.post("/api/payments", body, as_of=when)

    # ---------- monthly engine ----------
    async def settle(self, bk, upto: date):
        """Pay demands due by `upto` according to the booking archetype (dates are historically correct)."""
        if not bk["active"]:
            return
        d = await self.api.get(f"/api/bookings/{bk['id']}", as_of=upto)
        s = d["summary"]
        headroom = {
            "Cash": d["cash_agreed_paise"] - s["cash_paid_paise"],
            "Account": d["account_agreed_paise"] - s["account_paid_paise"],
        }
        arch = bk["archetype"]
        if arch == "owner":
            return  # paid by the fixed 10-payment sequence in edges()
        for dm in d["demands"]:
            if dm["status"] not in ("Open", "Partially Paid") or dm.get("voided"):
                continue
            due = date.fromisoformat(dm["due_date"])
            offset = {
                "ontime": R.randint(-5, 3),
                "advance": -20,
                "loan": R.randint(5, 20),
                "late30": R.randint(10, 25),
                "late60": R.randint(35, 55),
                "late90": R.randint(65, 85),
                "late90p": R.randint(100, 160),
                "fullpaid": -3,
                "noshow": R.randint(35, 70),
                "bounce": R.randint(0, 5),
                "revision": R.randint(-2, 4),
                "transfer": R.randint(-2, 4),
                "swap": 0,
                "cancel": 0,
                "forfeit": 0,
                "reverse": 0,
                "possession": -2,
                "oc": R.randint(0, 6),
            }.get(arch, 0)
            pay_on = due + timedelta(days=offset)
            if arch == "late90p" and dm.get("installment_seq", 1) > 2:
                continue  # defaulter after the 2nd installment → 90+ band
            if arch == "late90" and due > self.today - timedelta(days=91):
                continue  # recent demands unpaid → 61–90 band
            if arch == "late60" and due > self.today - timedelta(days=31) and due <= self.today:
                continue  # 31–60 band
            if pay_on > upto or pay_on > self.today:
                continue
            if arch in ("cancel", "forfeit") and dm.get("installment_seq", 1) > 1:
                continue
            cash_due = min(max(dm["cash_demand_paise"] - dm.get("cash_paid_paise", 0), 0), headroom["Cash"])
            acc_due = min(max(dm["account_demand_paise"] - dm.get("account_paid_paise", 0), 0), headroom["Account"])
            headroom["Cash"] -= cash_due
            headroom["Account"] -= acc_due
            if cash_due:
                await self.pay(bk, pay_on, "Cash", cash_due, R.choice(["CASH", "CASH", "UPI"]))
            if acc_due:
                if arch == "loan" and dm.get("installment_seq", 1) > 1:
                    half = acc_due // 2
                    await self.pay(bk, pay_on, "Account", half, "LOAN_DISBURSEMENT")
                    await self.pay(bk, pay_on + timedelta(days=12), "Account", acc_due - half, "LOAN_DISBURSEMENT")
                else:
                    generic = arch in ("ontime", "late30", "late60", "late90", "late90p", "advance", "loan", "noshow")
                    mode = (
                        ("CHEQUE" if R.random() < 0.15 else R.choice(["NEFT_RTGS", "NEFT_RTGS", "DD"]))
                        if generic
                        else "NEFT_RTGS"
                    )
                    p = await self.pay(bk, pay_on, "Account", acc_due, mode)
                    if (
                        p
                        and p.get("status") == "Pending"
                        and date.fromisoformat(p["payment_date"]) + timedelta(days=4) <= self.today
                    ):
                        await self.api.post(
                            f"/api/payments/{p['id']}/clear",
                            {"reason": "Instrument realised"},
                            as_of=date.fromisoformat(p["payment_date"])
                            + timedelta(days=4),  # clearing ≥ deposit (payment date may move to booking day)
                        )
        await self.settle_oc(bk, d, upto)

    # REQ-212: buyers pay other-charge parts like real buyers — parking / club soon after booking, each GST part with
    # its stage bill; the late archetypes leave a deterministic few overdue in every band. Offsets come from a hash of
    # (booking, line, part), not the story RNG, so the instalment story is byte-identical to before.
    OC_LAG = {"late30": (10, 25), "late60": (35, 55), "late90": (65, 85), "noshow": (35, 70), "loan": (2, 10)}

    async def settle_oc(self, bk, d, upto: date):
        arch = bk["archetype"]
        if arch in ("owner", "oc", "cancel", "forfeit", "reverse") or not bk["active"]:
            return
        import hashlib

        for ln in d.get("other_charges", []):
            unpaid_line = (ln.get("demanded_paise") or 0) - (ln.get("paid_paise") or 0)  # API money here is paise
            if not ln.get("demanded_at") or unpaid_line <= 0 or "bounce" in (ln.get("name") or "").lower():
                continue  # a bounce charge is the bouncer's own story
            paid = ln.get("paid_paise") or 0
            for i, h in enumerate(ln.get("demand_history") or []):
                amt = h.get("paise") or 0
                take, paid = max(amt - paid, 0), max(paid - amt, 0)
                due = date.fromisoformat(h.get("due_on") or clock.day_of(ln["demanded_at"]))
                if not take:
                    continue
                if arch == "late90p" and i > 1:
                    continue  # defaulter: stops paying GST parts after the 2nd
                if arch == "late90" and due > self.today - timedelta(days=91):
                    continue
                if arch == "late60" and self.today - timedelta(days=31) < due <= self.today:
                    continue
                hx = int(hashlib.sha1(f"{bk['id']}:{ln.get('line_id')}:{i}".encode()).hexdigest()[:8], 16)
                lo, hi = self.OC_LAG.get(arch, (-6, 6))  # most buyers: within days-to-pay (a few days either side)
                pay_on = due + timedelta(days=lo + hx % (hi - lo + 1))
                forgetful = int(hashlib.sha1(bk["id"].encode()).hexdigest()[:8], 16) % 15 == 0
                if forgetful and i == len(ln.get("demand_history") or []) - 1:
                    continue  # ~1 in 15 good payers forgets one latest part → a few small overdue lines
                if pay_on > upto or pay_on > self.today:
                    continue
                await self.pay(
                    bk,
                    pay_on,
                    None,
                    take,
                    "NEFT_RTGS",
                    against="OTHER_CHARGE",
                    line_id=ln["line_id"],
                    rng=random.Random(hx),
                )

    async def mark_stages(self, month: date):
        """Construction cadence: SGH-A 2 months/stage from May-25; B lags 2 stages; C lags 5; GGV-V 7/9 by today."""
        plan = {"SGH-A": 0, "SGH-B": 4, "SGH-C": 10, "GGV-V": 1}
        for key, lag in plan.items():
            if key not in self.stage_ids:
                continue
            idx = (month.year - 2025) * 12 + month.month - 4 - lag  # months since Apr-25 minus lag
            if idx < 1 or idx % 2:
                continue
            seq = idx // 2
            stages = self.stage_ids[key]
            cap = {"SGH-A": 8, "SGH-B": 6, "SGH-C": 3, "GGV-V": 7}[key]
            if seq > min(cap, len(stages) - (0 if key == "GGV-V" else 1)):
                continue
            sid = stages[seq - 1][1]
            on = month.replace(day=min(10 + seq, 28))
            await self.api.post(
                f"/api/blocks/{self.blocks[key]['id']}/construction/stage",
                {"stage_id": sid, "completed_on": d2s(on), "notes": f"story: {stages[seq - 1][2]} completed"},
                as_of=on,
            )
            self.stats.setdefault("stages", []).append((key, stages[seq - 1][2], d2s(on)))

    # ---------- the story ----------
    async def run(self):
        a = self.api
        await self.load_setup()
        await self.price_all_flats()
        await a.post(
            "/api/roznamcha/opening",
            {"date": d2s(START), "amount": 2500000, "remarks": "Opening cash — FY 2025-26 cash book"},
            as_of=START,
        )
        schedule = []  # (month_index, key, archetype, kwargs)
        archetypes = [
            "ontime",
            "ontime",
            "ontime",
            "loan",
            "loan",
            "advance",
            "ontime",
            "late30",
            "loan",
            "ontime",
            "late60",
            "ontime",
            "loan",
            "late90",
            "ontime",
            "advance",
            "late90p",
            "ontime",
            "loan",
            "ontime",
        ]
        keys = [
            "SGH-A",
            "SGH-C",
            "SGH-B",
            "GGV-V",
            "SGH-A",
            "SGH-C",
            "SGH-C",
            "GGV-V",
            "SGH-B",
            "SGH-C",
            "SGH-A",
            "SGH-C",
        ]
        i = 0
        for mi in range(19):
            n = 2 if mi < 3 else (4 if mi < 12 else 3)
            for _ in range(n):
                schedule.append((mi, keys[i % len(keys)], archetypes[i % len(archetypes)], {}))
                i += 1
        edge = [
            (1, "GGV-V", "fullpaid", {"remarks": "story:fullpaid — possession", "cash_pct": 40}),
            (3, "SGH-B", "bounce", {}),
            (5, "SGH-A", "bounce2", {}),
            (4, "SGH-B", "revision", {"charges": [("PARKING", "on_booking")]}),
            (5, "SGH-A", "transfer", {}),
            (6, "SGH-B", "swap", {}),
            (6, "SGH-B", "swap2", {}),
            (7, "SGH-A", "cancel", {}),
            (9, "SGH-C", "forfeit", {}),
            (8, "SGH-A", "noshow", {}),
            (10, "GGV-V", "reverse", {"cash_pct": 30}),
            (
                2,
                "GGV-V",
                "oc",
                {"charges": [("MAINT", "on_possession"), ("REGISTRY", "manual"), ("PARKING", "on_booking")]},
            ),
            (
                2,
                "GGV-V",
                "owner",
                {"cash_pct": 60, "remarks": "story:owner — ₹1 Cr worked example (60 L cash / 40 L account)"},
            ),
            (3, "SGH-A", "oc", {"charges": [("PARKING", "on_booking"), ("CLUB", "on_booking")]}),
            (12, "SGH-B", "possession", {}),
            (15, "SGH-C", "late90", {"remarks": "story:late90 — booked Jul-26, first instalment overdue 61–90 days"}),
            (16, "SGH-C", "late60", {"remarks": "story:late60 — booked Aug-26"}),
        ]
        schedule += edge
        schedule.sort(key=lambda s: s[0])
        months = list(self.months())
        pending_edges = {}
        for mi, month in enumerate(months):
            if month > self.today:
                break
            log(f" month {d2s(month)} rng={hash(R.getstate()[1]) & 0xFFFF:04x}")
            await self.cancellations(month, pending_edges)
            await self.mark_stages(month)
            await self.recent_stages(month)
            for smi, key, arch, kw in [s for s in schedule if s[0] == mi]:
                when = month.replace(day=min(3 + R.randint(0, 22), 28))
                if when > self.today:
                    continue
                kw = dict(kw)
                if arch == "fullpaid":
                    kw["remarks"] = kw.get("remarks")
                bk = await self.book(
                    key,
                    when,
                    arch,
                    cash_pct=kw.pop("cash_pct", None),
                    charges=kw.pop("charges", None),
                    remarks=kw.pop("remarks", None),
                )
                pending_edges[arch] = bk
                fp = hash(R.getstate()[1]) & 0xFFFF  # determinism trace: first divergence between two rebuilds
                log(f"{d2s(when)} booked {bk['number']} {key} {arch} flat={bk['flat']['flat_number']} rng={fp:04x}")
            # pay what fell due this month
            upto = (months[mi + 1] - timedelta(days=1)) if mi + 1 < len(months) else self.today
            upto = min(upto, self.today)
            for bk in self.bookings:
                await self.settle(bk, upto)
            await self.edges(mi, month, upto, pending_edges)
            # stray leads / visits / tickets
            await self.funnel(month)
        await a.post("/api/admin/run-dues", None, as_of=self.today, ok=(200, 201))
        await self.tickets_and_notices()
        await self.rate_card_and_holds()
        await self.today_edges()
        await self.portal_accounts()
        await a.post("/api/admin/recompute-counters", None)
        log("calls", a.calls, "bookings", len(self.bookings))

    async def cancellations(self, month, pe):
        """Run before the month's stage completions so no bill is raised after a cancellation date."""
        a = self.api
        # cancel with refund (policy % of received) → refund Pending → Paid NEFT 30 days later
        bk = pe.get("cancel")
        if bk and bk["active"] and (bk["booked"] + timedelta(days=75)).replace(day=1) <= month:
            on = bk["booked"] + timedelta(days=75)
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=on)
            r = await a.post(
                f"/api/bookings/{bk['id']}/cancel",
                {"reason": "story: customer relocated abroad — cancelled, refund per policy", "version": d["version"]},
                as_of=on,
            )
            bk["active"] = False
            bk["flat"]["status"] = "Available"
            if r.get("refund") and r["refund"]["status"] == "Pending" and on + timedelta(days=30) <= self.today:
                await a.post(
                    f"/api/refunds/{r['refund']['id']}/pay",
                    {
                        "paid_date": d2s(on + timedelta(days=30)),
                        "mode": "NEFT_RTGS",
                        "bank_account_id": self.bank["id"],
                        "reference": "UTR-REFUND-STORY",
                    },
                    as_of=on + timedelta(days=30),
                )
        # forfeiture: cancel with deduction == received
        bk = pe.get("forfeit")
        if bk and bk["active"] and (bk["booked"] + timedelta(days=50)).replace(day=1) <= month:
            on = bk["booked"] + timedelta(days=50)
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=on)
            await a.post(
                f"/api/bookings/{bk['id']}/cancel",
                {
                    "reason": "story: booking amount forfeited — buyer defaulted after notices",
                    "deduction": d["summary"]["paid_paise"] / 100,
                    "version": d["version"],
                },
                as_of=on,
            )
            bk["active"] = False
            bk["flat"]["status"] = "Available"

    async def edges(self, mi, month, upto, pe):
        a = self.api
        # owner's worked example: the 10-payment sequence from the owner's ledger table (₹ lakh), one every ~12 days from booking
        if "owner" in pe and pe["owner"]["active"]:
            bk = pe["owner"]
            seq = [
                ("Account", 4, "NEFT_RTGS"),
                ("Cash", 8, "CASH"),
                ("Account", 12, "NEFT_RTGS"),
                ("Cash", 5, "CASH"),
                ("Cash", 10, "CASH"),
                ("Account", 15, "NEFT_RTGS"),
                ("Cash", 7, "CASH"),
                ("Cash", 20, "CASH"),
                ("Account", 9, "NEFT_RTGS"),
                ("Cash", 10, "CASH"),
            ]
            i = bk.setdefault("owner_idx", 0)
            while i < len(seq):
                on = bk["booked"] + timedelta(days=12 * (i + 1))
                if on > upto:
                    break
                cat, lakh, mode = seq[i]
                await self.pay(bk, on, cat, lakh * 100000 * 100, mode)
                i += 1
            bk["owner_idx"] = i
        # fullpaid persona: pay everything demanded so far early; possession when tower A finishes
        if "fullpaid" in pe and pe["fullpaid"]["active"]:
            bk = pe["fullpaid"]
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
            for dm in d["demands"]:
                if dm["status"] in ("Open", "Partially Paid"):
                    cd, ad = (
                        dm["cash_demand_paise"] - dm.get("cash_paid_paise", 0),
                        dm["account_demand_paise"] - dm.get("account_paid_paise", 0),
                    )
                    on = min(date.fromisoformat(dm["demand_date"]) + timedelta(days=3), upto)
                    await self.pay(bk, on, "Cash", cd, "CASH")
                    await self.pay(bk, on, "Account", ad, "NEFT_RTGS")
        # bounce: in the booking month+1, pay account by cheque, bounce it 6 days later; persona 1 replaces by NEFT
        for arch in ("bounce", "bounce2"):
            bk = pe.get(arch)
            if bk and bk["active"] and not bk.get("bounced") and month > bk["booked"].replace(day=1):
                d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
                dm = next(
                    (
                        x
                        for x in d["demands"]
                        if x["status"] in ("Open", "Partially Paid")
                        and x["account_demand_paise"] - x.get("account_paid_paise", 0) > 0
                    ),
                    None,
                )
                if dm:
                    on = min(date.fromisoformat(dm["due_date"]), upto - timedelta(days=12))
                    amt = dm["account_demand_paise"] - dm.get("account_paid_paise", 0)
                    p = await self.pay(bk, on, "Account", amt, "CHEQUE", ref=f"CHQ{R.randint(100000, 999999)}")
                    if p:
                        await a.post(
                            f"/api/payments/{p['id']}/bounce",
                            {"reason": "Returned unpaid — insufficient funds"},
                            as_of=on + timedelta(days=6),
                        )
                        bk["bounced"] = True
                        if arch == "bounce":
                            await self.pay(
                                bk, on + timedelta(days=11), "Account", amt, "NEFT_RTGS", ref="UTR-REPLACEMENT"
                            )
        # revision: cash 60 → 50 one month after booking
        bk = pe.get("revision")
        if bk and bk["active"] and not bk.get("revised") and month > bk["booked"].replace(day=1):
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
            av = d["agreement_value_paise"]
            cash = round(av * 0.5)
            await a.post(
                f"/api/bookings/{bk['id']}/agreement-revisions",
                {
                    "cash_agreed": cash / 100,
                    "account_agreed": (av - cash) / 100,
                    "reason": "story: customer increased home-loan component (cash 60% → 50%)",
                    "version": d["version"],
                },
                as_of=bk["booked"].replace(day=1) + timedelta(days=40),
            )
            bk["revised"] = True
        # transfer: to a cheaper flat in Tower B, 2 months after booking, cash 55%
        bk = pe.get("transfer")
        if (
            bk
            and bk["active"]
            and not bk.get("transferred")
            and (month.year, month.month)
            >= ((bk["booked"] + timedelta(days=62)).year, (bk["booked"] + timedelta(days=62)).month)
        ):
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
            cands = [
                f
                for f in self.flats["SGH-B"] + self.flats["SGH-A"]
                if f["status"] == "Available" and f.get("price") and f["price"] < d["agreement_value_paise"] / 100
            ]
            tgt = sorted(cands, key=lambda f: -f["price"])[0]
            tgt["status"] = "Booked"
            bk["flat"]["status"] = "Available"
            await a.post(
                f"/api/bookings/{bk['id']}/transfer",
                {
                    "new_flat_id": tgt["id"],
                    "reason": "story: moved to Tower B (lower floor, price difference refunded via schedule)",
                    "cash_percent": 55,
                    "version": d["version"],
                },
                as_of=bk["booked"] + timedelta(days=62),
            )
            bk["transferred"] = True
        # swap: two Tower B bookings swap units
        if (
            pe.get("swap")
            and pe.get("swap2")
            and not pe["swap"].get("swapped")
            and month > pe["swap2"]["booked"].replace(day=1)
        ):
            d = await a.get(f"/api/bookings/{pe['swap']['id']}", as_of=upto)
            await a.post(
                f"/api/bookings/{pe['swap']['id']}/swap",
                {
                    "other_booking_id": pe["swap2"]["id"],
                    "reason": "story: families swapped units (floor preference)",
                    "version": d["version"],
                },
                as_of=pe["swap2"]["booked"] + timedelta(days=20),
            )
            pe["swap"]["swapped"] = True
        # reversal: wrong amount keyed, same-day reversal and re-entry
        bk = pe.get("reverse")
        if bk and bk["active"] and not bk.get("reversed") and month > bk["booked"].replace(day=1):
            on = min(bk["booked"] + timedelta(days=40), upto)
            p = await self.pay(bk, on, "Cash", 1500000, "CASH")
            if p:
                await a.post(
                    f"/api/payments/{p['id']}/reverse",
                    {"reason": "Keyed ₹15,000 instead of ₹1,500 — reversed same day"},
                    as_of=on,
                )
                await self.pay(bk, on, "Cash", 150000, "CASH")
            bk["reversed"] = True
        # other-charges persona: demand the manual REGISTRY line and pay parking partly
        bk = pe.get("oc")
        if bk and bk["active"] and not bk.get("oc_done") and month > bk["booked"].replace(day=1):
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
            for ln in d.get("other_charges", []):
                if ln.get("demand_at") == "manual" and not ln.get("demanded_paise"):
                    await a.post(
                        f"/api/bookings/{bk['id']}/other-charges/demand",
                        {"line_id": ln["line_id"]},
                        as_of=min(bk["booked"] + timedelta(days=35), upto),
                    )
                if ln.get("demand_at") == "on_booking" and ln.get("demanded_paise") and not ln.get("paid_paise"):
                    await self.pay(
                        bk,
                        min(bk["booked"] + timedelta(days=20), upto),
                        None,
                        ln["demanded_paise"] // 2,
                        "UPI",
                        against="OTHER_CHARGE",
                        line_id=ln["line_id"],
                    )
            bk["oc_done"] = True
        # possession: once everything (flat value + other charges) is paid and the block has handed over → Completed
        for arch in ("fullpaid", "possession"):
            bk = pe.get(arch)
            if (
                bk
                and bk["active"]
                and not bk.get("completed")
                and month >= bk["booked"].replace(day=1) + timedelta(days=100)
            ):
                d = await a.get(f"/api/bookings/{bk['id']}", as_of=upto)
                if (
                    d["summary"]["outstanding_paise"] == 0
                    and d["summary"]["total_order_raised_paise"] >= d["agreement_value_paise"]
                ):
                    await a.post(
                        f"/api/bookings/{bk['id']}/complete",
                        {"notes": "story: keys handed over", "version": d["version"]},
                        as_of=upto,
                    )
                    bk["completed"] = True
        # cash book: deposit ~80% of the month's cash receipts into the bank on the last working day
        rz = await a.get("/api/roznamcha", as_of=upto, date=d2s(upto))
        dep = int(rz["closing_cash_paise"] * 0.8) // 100000 * 100000
        if dep >= 5000000:
            await a.post(
                "/api/roznamcha/contra",
                {
                    "date": d2s(upto),
                    "kind": "DEPOSIT",
                    "amount": dep / 100,
                    "bank_account_id": self.bank["id"],
                    "remarks": "Monthly cash deposit",
                },
                as_of=upto,
            )

    async def funnel(self, month):
        """Open leads at every stage with sources; visits completed/no-show/cancelled; some Lost with reasons (last 4 months heavier)."""
        if month < self.today - timedelta(days=130):
            n = 1
        else:
            n = 6
        for i in range(n):
            when = month.replace(day=min(2 + i * 4, 28))
            if when > self.today:
                break
            proj = self.projects["SGH" if i % 3 else "GGV"]
            rm = self.rms[i % 2]
            ld = await self.lead(
                f"{FIRST[(i * 13 + month.month) % len(FIRST)]} {LAST[(i * 5 + month.day) % len(LAST)]}",
                when,
                proj,
                rm,
                ["Website", "Brochure", "Walk-in", "Referral", "Broker", "Campaign"][i % 6],
            )
            stage = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Lost"][
                (i + month.month) % 6
            ]
            if stage == "Site Visit Done" and when + timedelta(days=5) <= self.today:
                await self.visit(ld, proj, when + timedelta(days=5), ["complete", "no-show", "cancel"][i % 3])
            elif stage not in ("New", "Site Visit Done") and when + timedelta(days=3) <= self.today:
                await self.api.post(
                    f"/api/leads/{ld['id']}/stage",
                    {
                        "status": stage,
                        "note": "story funnel",
                        "lost_reason": "Budget mismatch" if stage == "Lost" else None,
                    },
                    as_of=when + timedelta(days=3),
                )
            if stage in ("Contacted", "Negotiation") and when + timedelta(days=4) <= self.today:
                await self.api.post(
                    f"/api/leads/{ld['id']}/follow-ups",
                    {"note": "Shared price list, follow up next week"},
                    as_of=when + timedelta(days=4),
                )

    async def tickets_and_notices(self):
        a = self.api
        cats = [
            "Payment query",
            "Document request",
            "Construction query",
            "Possession",
            "Defect/Snag",
            "Agreement",
            "Other",
        ]
        active = [b for b in self.bookings if b["active"]][:14]
        for i, bk in enumerate(active):
            on = self.today - timedelta(days=[2, 5, 9, 14, 20, 33, 40, 60, 75, 90, 1, 3, 7, 12][i])
            sr = await a.post(
                "/api/service-requests",
                {
                    "customer_id": bk["customer_id"],
                    "booking_id": bk["id"],
                    "category": cats[i % len(cats)],
                    "priority": ["Low", "Medium", "High"][i % 3],
                    "subject": f"{cats[i % len(cats)]} — {bk['number']}",
                    "description": "story: raised by customer on call",
                },
                as_of=on,
            )
            flow = i % 5
            if flow >= 1:
                await a.post(
                    f"/api/service-requests/{sr['id']}/assign",
                    {"assigned_to": self.support["id"]},
                    as_of=on + timedelta(days=1),
                    ok=(200, 201, 404, 422),
                )
                await a.post(
                    f"/api/service-requests/{sr['id']}/reply",
                    {"message": "We are looking into this.", "status": "In Progress"},
                    as_of=on + timedelta(days=1),
                )
            if flow >= 2:
                await a.post(
                    f"/api/service-requests/{sr['id']}/status",
                    {"status": "Resolved", "note": "Fixed"},
                    as_of=on + timedelta(days=3),
                )
            if flow >= 3:
                await a.post(
                    f"/api/service-requests/{sr['id']}/status",
                    {"status": "Closed", "note": "Customer confirmed"},
                    as_of=on + timedelta(days=4),
                )
            if flow == 4:
                await a.post(
                    f"/api/service-requests/{sr['id']}/status",
                    {"status": "In Progress", "note": "Reopened — issue recurred"},
                    as_of=on + timedelta(days=6),
                )
        await a.post(
            "/api/notices",
            {
                "title": "Diwali site holiday",
                "body": "Site office closed 20–22 Oct. Payments accepted online.",
                "project_ids": [],
                "pinned": True,
            },
            as_of=self.today - timedelta(days=10),
        )
        await a.post(
            "/api/notices",
            {
                "title": "Tower A — finishing works update",
                "body": "Flooring and painting complete on floors 1–10; possession letters from next quarter.",
                "project_ids": [self.projects["SGH"]["id"]],
            },
            as_of=self.today - timedelta(days=3),
        )

    async def portal_accounts(self):
        """Enable the customer portal for the first 8 story buyers via the real flow (temp password → first login → change password)."""
        for bk in self.bookings[:8]:
            r = await self.api.post(
                f"/api/customers/{bk['customer_id']}/portal/enable",
                None,
                as_of=bk["booked"] + timedelta(days=2),
                ok=(200, 201),
            )
            c = httpx.AsyncClient(
                base_url=str(self.api.c.base_url), timeout=60, headers={"X-Rate-Limit-Bypass": BYPASS}
            )
            lg = await c.post(
                "/api/portal/auth/login", json={"phone": r["login_phone"], "password": r["temporary_password"]}
            )
            if lg.status_code == 200:
                await c.post(
                    "/api/portal/auth/change-password",
                    json={"current_password": r["temporary_password"], "new_password": "Buyer@12345"},
                    headers={"Authorization": f"Bearer {lg.json()['access_token']}"},
                )
            await c.aclose()

    async def rate_card_and_holds(self):
        a = self.api
        # price edit on unsold stock (Dec-25) and PLC — recorded before later sales; holds/releases/blocked
        for f in [x for x in self.flats["SGH-C"] if x["status"] == "Available"][:3]:
            note = f.get("notes") or ""  # E4: setup survives refreshes → revise from the recorded base, never compound
            m = re.match(r"Rate revised Dec-25 from ([0-9.]+)/sqft", note)
            base = float(m.group(1)) if m else (f.get("rate_per_sqft") or 4300)
            await a.patch(
                f"/api/flats/{f['id']}",
                {"rate_per_sqft": round(base * 1.03, 2), "notes": f"Rate revised Dec-25 from {base:g}/sqft"},
                as_of=date(2025, 12, 5),
            )
        avail = [x for x in self.flats["SGH-B"] if x["status"] == "Available"]
        reasons = {r["code"]: r["id"] for r in (await a.get("/api/master/hold-reasons"))["items"]}
        tok = reasons.get("TOKEN") or next(iter(reasons.values()))

        def until(d: date) -> str:  # E5: every hold carries a real expiry (18:00 IST on day d)
            return datetime.combine(d, time(18, 0), tzinfo=clock.business_tz()).isoformat()

        for f, rid, note, when, exp in (
            (
                avail[0],
                tok,
                "Token received — awaiting KYC",
                self.today - timedelta(days=4),
                self.today + timedelta(days=3),
            ),
            (
                avail[1],
                reasons.get("INTEREST", tok),
                "Broker hold 7 days",
                self.today - timedelta(days=2),
                self.today + timedelta(days=5),
            ),
        ):
            await a.post(
                "/api/inventory/bulk",
                {"flat_ids": [f["id"]], "action": "hold", "reason_id": rid, "note": note, "expires_at": until(exp)},
                as_of=when,
            )
            f["status"] = "Hold"
        await a.patch(
            f"/api/flats/{avail[2]['id']}/status",
            {"status": "Blocked", "reason": "Legal — title dispute"},
            as_of=date(2026, 2, 10),
        )
        f = avail[3]
        await a.post(
            "/api/inventory/bulk",
            {
                "flat_ids": [f["id"]],
                "action": "hold",
                "reason_id": tok,
                "note": "Token received",
                "expires_at": until(self.today + timedelta(days=1)),
            },
            as_of=self.today - timedelta(days=30),
        )
        await a.post(
            "/api/inventory/bulk",
            {"flat_ids": [f["id"]], "action": "release", "reason": "Token refunded — released"},
            as_of=self.today - timedelta(days=22),
        )

    # ---------- Phase 1 F-6: every flat explicitly priced; situations dated today ----------
    async def price_all_flats(self):
        """Every flat gets an explicit saleable area + price through the per-flat pricing sheet (no silent defaults)."""
        a = self.api
        # E4: setup survives refreshes — a flat the story revised last time goes back to its recorded base first, so
        # every rebuild starts from the same rates (REQ-38 determinism) and the Dec-25 edit never compounds
        for flats in self.flats.values():
            for f in flats:
                m = re.match(r"Rate revised Dec-25 from ([0-9.]+)/sqft", f.get("notes") or "")
                if m:
                    f.update(
                        await a.patch(
                            f"/api/flats/{f['id']}", {"rate_per_sqft": float(m.group(1)), "notes": ""}, as_of=START
                        )
                    )
        for key, flats in self.flats.items():
            b = self.blocks[key]
            for f in flats:
                if f.get("pricing_status") == "ready" and f.get("price"):
                    if f.get("pricing_mode") == "rate" and not f.get("rate_per_sqft"):  # a stored lump sum → say so
                        cur = await a.get(f"/api/flats/{f['id']}")
                        await a.patch(
                            f"/api/flats/{f['id']}/pricing",
                            {"pricing_mode": "lump_sum", "price": f["price"], "version": cur["version"]},
                            as_of=START,
                        )
                        f["pricing_mode"] = "lump_sum"
                    continue
                area = f.get("saleable_sqft") or f.get("super_builtup_sqft")
                rate = (
                    f.get("rate_per_sqft") or b.get("rate_per_sqft") or (4500 if b["project_code"] == "SGH" else 3800)
                )
                if not area:
                    ft = await a.get(f"/api/master/flat-types/{f['flat_type_id']}")
                    area = ft.get("saleable_sqft") or ft.get("super_builtup_sqft") or 1250
                cur = await a.get(f"/api/flats/{f['id']}")
                sheet = {
                    "saleable_sqft": area,
                    "pricing_mode": "rate",
                    "rate_per_sqft": rate,
                    "version": cur["version"],
                    "maintenance": {
                        "method": "per_sqft_months",
                        "rate_per_sqft": 2.5 if b["project_code"] == "SGH" else 2,
                        "months": 24,
                    },
                }
                upd = await a.patch(f"/api/flats/{f['id']}/pricing", sheet, as_of=START)
                f.update(price=upd.get("price"), saleable_sqft=area, rate_per_sqft=rate, pricing_status="ready")

    async def recent_stages(self, month: date):
        """SGH-C completes its next three stages 50, 25 and 6 days before today, in calendar order with the bookings;
        buyers have not paid those bills by today (31-60 / 0-30 overdue, and Not due: inside the due window)."""
        stages = self.stage_ids.get("SGH-C") or []
        for ago in (50, 25, 6):
            on = self.today - timedelta(days=ago)
            done = len([s for s in self.stats.get("stages", []) if s[0] == "SGH-C"])
            if on.replace(day=1) != month or done >= len(stages):
                continue
            await self.api.post(
                f"/api/blocks/{self.blocks['SGH-C']['id']}/construction/stage",
                {
                    "stage_id": stages[done][1],
                    "completed_on": d2s(on),
                    "notes": f"story: {stages[done][2]} completed",
                },
                as_of=on,
            )
            self.stats.setdefault("stages", []).append(("SGH-C", stages[done][2], d2s(on)))

    async def today_edges(self):
        """Receipts today (Cash + UPI), a cheque deposited today still to clear, a hold expiring < 48 h, a visit and a follow-up due today."""
        a, t = self.api, self.today
        live = []
        for bk in [x for x in self.bookings if x["active"]]:
            d = await a.get(f"/api/bookings/{bk['id']}", as_of=t)
            if d["status"] == "Active" and d["summary"].get("outstanding_paise", 0) >= 5000000:
                live.append(bk)
            if len(live) == 3:
                break
        for bk, mode, amt in zip(live, ("CASH", "UPI", "CHEQUE"), (2500000, 1500000, 4000000)):
            on = t - timedelta(days=2) if mode == "CHEQUE" else t  # cheque deposited T-2 → clears today
            body = {
                "booking_id": bk["id"],
                "allocation": "auto",
                "amount": amt / 100,
                "payment_date": d2s(on),
                "payment_mode_id": self.modes[mode],
                "remarks": f"story:today-{mode.lower()}",
            }
            if mode != "CASH":
                body["instrument"] = {
                    "number": f"{mode[:3]}{R.randint(100000, 999999)}",
                    "date": d2s(on),
                    "bank_name": "SBI",
                }
                body["bank_account_id"] = self.bank["id"]
            await a.post("/api/payments", body, as_of=on)
        avail = [f for f in self.flats["SGH-C"] if f["status"] == "Available"]
        reasons = (await a.get("/api/master/hold-reasons"))["items"] or [
            await a.post("/api/master/hold-reasons", {"name": "Token promised", "code": "TOKEN"}, as_of=t)
        ]
        from datetime import timezone

        exp = datetime.combine(t + timedelta(days=1), time(18, 0), tzinfo=timezone.utc).isoformat()
        await a.post(
            "/api/inventory/bulk",
            {
                "flat_ids": [avail[0]["id"]],
                "action": "hold",
                "reason_id": reasons[0]["id"],
                "note": "Token promised tomorrow",
                "expires_at": exp,
            },
            as_of=t,
        )
        avail[0]["status"] = "Hold"
        sgh, rm = self.projects["SGH"], self.rms[0]
        ld = await self.lead("Kunal Bhardwaj", t - timedelta(days=3), sgh, rm, "Website")
        v = await a.post(
            "/api/site-visits",
            {"project_id": sgh["id"], "date": d2s(t), "slot_start": "16:00", "lead_id": ld["id"], "visitors_count": 2},
            as_of=t - timedelta(days=1),
        )
        self.stats["visit_today"] = v["id"]
        ld2 = await self.lead("Sneha Kapoor", t - timedelta(days=6), sgh, self.rms[1], "Referral")
        await a.post(
            f"/api/leads/{ld2['id']}/stage",
            {"status": "Contacted", "note": "Asked for 3 BHK price list"},
            as_of=t - timedelta(days=5),
        )
        due = datetime.combine(t, time(11, 0), tzinfo=clock.business_tz()).isoformat()  # 11:00 IST on the as-of day
        await a.post(
            f"/api/leads/{ld2['id']}/follow-ups",
            {"note": "Call back with Tower C floor plans", "next_follow_up_at": due},
            as_of=t - timedelta(days=2),
        )


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", default=None)
    ap.add_argument("--base", default=os.environ.get("STORY_BASE_URL", "http://localhost:8001"))
    args = ap.parse_args()
    today = date.fromisoformat(args.as_of) if args.as_of else clock.today()
    api = Api(args.base)
    await api.login()
    story = Story(api, today)
    await story.run()
    # record the story's as-of so the headline test knows which numbers to expect
    await api.post("/api/admin/story-marker", {"as_of": d2s(today), "bookings": len(story.bookings)})
    from tools import demo_3e  # REQ-257: discounts + every waiver state, through the same API

    await asyncio.to_thread(demo_3e.main)
    log("STORY DONE as_of", d2s(today))


if __name__ == "__main__":
    asyncio.run(main())
