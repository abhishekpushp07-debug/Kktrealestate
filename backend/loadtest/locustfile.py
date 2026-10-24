"""KKT Phase 4 load test — realistic mix for 1,000 concurrent users.
Run (4-worker instance recommended):
  cd /app/backend && WEB_CONCURRENCY=4 uvicorn server:app --host 0.0.0.0 --port 8002 --workers 4 &
  LT_BOOKING=<booking_id> locust -f loadtest/locustfile.py --headless -u 1000 -r 50 -t 3m -H http://localhost:8002 --csv loadtest/out
Login: the API rate-limits logins to 10/min/IP, so tokens are minted once per seeded account at test start and shared by the virtual users (documented deviation). Public reads (300/min/IP) and payment posting (120 writes/min/user) will show 429s from a single load-generator IP — these are rate limits working, not errors.
"""
import os
import random
import uuid
from datetime import date

import requests
from locust import HttpUser, between, events, task

PASSWORD = os.environ.get("LT_PASSWORD", "Kkt@12345")
ACCOUNTS = ["admin@kkt.in", "accounts@kkt.in", "sales@kkt.in", "projectadmin@kkt.in", "employee@kkt.in", "marketing@kkt.in"]
_s = {"tokens": {}, "blocks": [], "projects": [], "bookings": [], "slugs": [], "modes": {}, "bank": None}


@events.test_start.add_listener
def _mint(environment, **kw):
    host = environment.host
    for e in ACCOUNTS:
        r = requests.post(f"{host}/api/auth/login", json={"email": e, "password": PASSWORD}, timeout=30)
        if r.status_code == 200:
            _s["tokens"][e] = r.json()["access_token"]
    admin = {"Authorization": f"Bearer {_s['tokens']['admin@kkt.in']}"}
    _s["blocks"] = [b["id"] for b in requests.get(f"{host}/api/blocks?page_size=50", headers=admin, timeout=30).json()["items"]]
    _s["projects"] = [p["id"] for p in requests.get(f"{host}/api/projects", headers=admin, timeout=30).json()["items"]]
    _s["bookings"] = [b["id"] for b in requests.get(f"{host}/api/bookings?page_size=50&status=Active", headers=admin, timeout=30).json()["items"]]
    _s["slugs"] = [p["slug"] for p in requests.get(f"{host}/api/public/projects", timeout=30).json()["items"]]
    _s["modes"] = {m["code"]: m["id"] for m in requests.get(f"{host}/api/master/payment-modes?page_size=50", headers=admin, timeout=30).json()["items"]}


class ErpUser(HttpUser):
    wait_time = between(0.3, 1.5)

    def on_start(self):
        self.email = random.choice([e for e in ACCOUNTS if e in _s["tokens"]])
        self.h = {"Authorization": f"Bearer {_s['tokens'][self.email]}"}
        self.admin = {"Authorization": f"Bearer {_s['tokens']['admin@kkt.in']}"}
        self.accounts = {"Authorization": f"Bearer {_s['tokens'].get('accounts@kkt.in', _s['tokens']['admin@kkt.in'])}"}

    # 40% dashboards / lists
    @task(8)
    def dashboard(self):
        self.client.get(random.choice(["/api/dashboard", "/api/dashboard/widgets"]), headers=self.h, name="/api/dashboard*")

    @task(8)
    def lists(self):
        self.client.get(random.choice(["/api/projects", "/api/flats?page_size=50", "/api/customers?page_size=20", "/api/leads?page_size=20", "/api/payments?page_size=50", "/api/bookings?page_size=20"]), headers=self.admin, name="/api/{list}")

    @task(4)
    def me_notifs(self):
        self.client.get(random.choice(["/api/auth/me", "/api/notifications?limit=20"]), headers=self.h, name="/api/auth/me|notifications")

    # 20% block grid
    @task(10)
    def grid(self):
        self.client.get(f"/api/blocks/{random.choice(_s['blocks'])}/grid", headers=self.admin, name="/api/blocks/{id}/grid")

    # 15% booking detail + ledger
    @task(7)
    def booking(self):
        bid = random.choice(_s["bookings"])
        self.client.get(f"/api/bookings/{bid}", headers=self.admin, name="/api/bookings/{id}")
        self.client.get(f"/api/bookings/{bid}/ledger", headers=self.admin, name="/api/bookings/{id}/ledger")

    # 10% public website
    @task(5)
    def public(self):
        self.client.get(random.choice(["/api/public/home", "/api/public/site", f"/api/public/projects/{random.choice(_s['slugs'])}", "/api/public/posts"]), name="/api/public/*")

    # 10% search
    @task(5)
    def search(self):
        self.client.get(f"/api/search?q={random.choice(['A-1', 'Tower', 'SGH', 'Kumar', '3BHK', 'BK-25'])}", headers=self.h, name="/api/search")

    # 5% payment posting on dedicated booking
    @task(2)
    def pay(self):
        bid = os.environ.get("LT_BOOKING")
        if not bid or not _s["modes"].get("CASH"):
            return
        self.client.post("/api/payments", headers={**random.choice([self.admin, self.accounts]), "Idempotency-Key": str(uuid.uuid4())},
                         json={"booking_id": bid, "against": "FLAT_VALUE", "payment_category": random.choice(["Cash", "Account"]), "amount": 100, "payment_date": date.today().isoformat(), "payment_mode_id": _s["modes"]["CASH"], "remarks": "LOADTEST"}, name="POST /api/payments")
