"""Locust scenario — KKT ERP read-heavy mix at 5,000 concurrent users.
Run against a multi-worker instance (see README "Load test"):
  locust -f load/locustfile.py --headless -u 5000 -r 100 -t 5m --host http://localhost:8011 --csv load/out/run
Realistic mix: bootstrap+catalogues (cached, 304), dashboard snapshot, bookings list w/ include, customer 360 + ledgers,
inventory grid, search, payment posting (2 %, unique idempotency keys, ₹1 each on a load-test booking), portal reads (10 %)."""
import os
import random
import uuid

from locust import FastHttpUser, between, events, task

PWD = os.environ.get("KKT_PWD", "Kkt@12345")
STATE = {"token": None, "etags": {}, "booking": None, "customers": [], "blocks": [], "mode": None, "portal": None}


@events.test_start.add_listener
def _login(environment, **kw):
    import requests
    host = environment.host
    r = requests.post(f"{host}/api/auth/login", json={"email": "admin@kkt.in", "password": PWD}, timeout=30)
    r.raise_for_status()
    STATE["token"] = r.json()["access_token"]
    h = {"Authorization": f"Bearer {STATE['token']}"}
    bks = requests.get(f"{host}/api/bookings?status=Active&page_size=50", headers=h, timeout=30).json()["items"]
    STATE["booking"] = max(bks, key=lambda b: b["cash_agreed_paise"] - b["summary"]["cash_paid_paise"])
    STATE["customers"] = [c["id"] for c in requests.get(f"{host}/api/customers?page_size=50", headers=h, timeout=30).json()["items"]]
    STATE["blocks"] = [b["id"] for b in requests.get(f"{host}/api/blocks?page_size=50", headers=h, timeout=30).json()["items"]]
    STATE["mode"] = next(m["id"] for m in requests.get(f"{host}/api/master/payment-modes", headers=h, timeout=30).json()["items"] if m["code"] == "CASH")
    acc = requests.get(f"{host}/api/customers/{STATE['booking']['customer_id']}/portal", headers=h, timeout=30).json()
    if acc.get("enabled"):
        pr = requests.post(f"{host}/api/portal/auth/login", json={"phone": acc["login_phone"], "password": "Buyer@12345"}, timeout=30)
        if pr.status_code == 200:
            STATE["portal"] = pr.json()["access_token"]


class ErpUser(FastHttpUser):
    wait_time = between(1, 4)
    connection_timeout = 30
    network_timeout = 60

    def on_start(self):
        self.h = {"Authorization": f"Bearer {STATE['token']}"}
        # This pod only has ~1,000 ephemeral ports (ip_local_port_range 32768–33791, not changeable). Spreading the
        # destination over several loopback addresses gives each (src,dst) tuple its own port space → 5,000 sockets.
        if "localhost" in self.host or "127.0.0.1" in self.host:
            port = self.host.rsplit(":", 1)[1]
            self.host = f"http://127.0.0.{random.randint(1, 8)}:{port}"
            self.client = self.client.__class__(self.host, request_event=self.environment.events.request, user=self, insecure=True, concurrency=10, connection_timeout=30, network_timeout=60)

    def _get(self, path, name=None, cache_key=None):
        h = dict(self.h)
        if cache_key and STATE["etags"].get(cache_key):
            h["If-None-Match"] = STATE["etags"][cache_key]
        with self.client.get(path, headers=h, name=name or path, catch_response=True) as r:
            if r.status_code in (200, 304):
                if cache_key and r.headers.get("ETag"):
                    STATE["etags"][cache_key] = r.headers["ETag"]
                r.success()
            else:
                r.failure(f"{r.status_code}")

    @task(15)
    def bootstrap(self):
        self._get("/api/bootstrap", cache_key="bootstrap")

    @task(10)
    def catalogues(self):
        self._get("/api/catalogues", cache_key="catalogues")

    @task(15)
    def dashboard(self):
        self._get("/api/dashboard/snapshot")

    @task(12)
    def bookings(self):
        self._get("/api/bookings?page_size=20&include=customer,flat,project", name="/api/bookings?include")

    @task(10)
    def customer_360(self):
        cid = random.choice(STATE["customers"])
        self._get(f"/api/customers/{cid}", name="/api/customers/{id}")
        self._get(f"/api/customers/{cid}/ledgers", name="/api/customers/{id}/ledgers")
        self._get(f"/api/customers/{cid}/timeline?limit=30", name="/api/customers/{id}/timeline")

    @task(8)
    def inventory_grid(self):
        self._get(f"/api/blocks/{random.choice(STATE['blocks'])}/grid", name="/api/blocks/{id}/grid")

    @task(8)
    def search(self):
        self._get(f"/api/search?q={random.choice(['BK-', 'A1', 'San', 'CUST', '98'])}", name="/api/search")

    @task(10)
    def portal(self):
        if not STATE["portal"]:
            return
        h = {"Authorization": f"Bearer {STATE['portal']}"}
        for p in ("/api/portal/me", "/api/portal/bookings", "/api/portal/notifications"):
            with self.client.get(p, headers=h, name=p, catch_response=True) as r:
                r.success() if r.status_code in (200, 304) else r.failure(str(r.status_code))

    @task(2)
    def post_payment(self):
        b = STATE["booking"]
        with self.client.post("/api/payments", headers={**self.h, "Idempotency-Key": str(uuid.uuid4())}, name="/api/payments POST",
                              json={"booking_id": b["id"], "payment_category": "Cash", "amount": 1, "payment_date": "2026-10-24", "payment_mode_id": STATE["mode"], "remarks": "LOADTEST"}, catch_response=True) as r:
            r.success() if r.status_code in (201, 409, 429) else r.failure(str(r.status_code))
