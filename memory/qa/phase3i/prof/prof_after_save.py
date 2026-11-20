import os, sys, time, uuid, json
sys.path.insert(0, "/app/backend")
sys.path.insert(0, "/app/backend/tools")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
import perf_budget as P
import httpx
from datetime import date

P.CFG.update(workers=int(os.environ.get("W", "2")), cpus=os.environ.get("CPUS", "0,1"), v3=False)
if os.environ.get("SNAP", "1") == "1":
    P.snapshot(os.environ.get("SRC", "kkt_volume"))
proc = P.start_backend()
try:
    c = httpx.Client(base_url=f"http://127.0.0.1:{P.PORT}", timeout=60, headers={"X-Rate-Limit-Bypass": P.BYPASS})
    tok = c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": P.DEMO_PASSWORD}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    paths = sys.argv[1:] or ["/api/home/bundle?period=month", "/api/demands/register?page_size=50"]
    for p in paths:
        for _ in range(3):
            c.get(p)
    bks = c.get("/api/bookings", params={"page_size": 100, "status": "Active"}).json()["items"]
    bk = next(b for b in bks if (b.get("summary") or {}).get("outstanding_paise", 1) > 0)
    modes = {m["code"]: m["id"] for m in c.get("/api/master/payment-modes").json()["items"]}
    body = {"booking_id": bk["id"], "amount": 1000, "payment_date": date.today().isoformat(),
            "payment_mode_id": modes["CASH"], "allocation": "auto", "remarks": "prof"}
    for p in paths:
        xs = []
        for i in range(int(os.environ.get("REPS", "10"))):
            r = c.post("/api/payments", json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
            pay = r.json()
            g = c.get(p)
            st = g.headers.get("server-timing", "")
            xs.append(P.server_ms(g))
            if i < 3 or os.environ.get("V"):
                print(p, "post", P.server_ms(r), "| get", st[:600], flush=True)
            c.post(f"/api/payments/{pay['id']}/reverse", json={"reason": "perf meter"})
            time.sleep(0.5)
        xs.sort()
        print("RESULT", p, "p50", xs[len(xs) // 2], "p95", P.pct(xs, 95), "max", xs[-1], flush=True)
finally:
    proc.kill()
    if os.environ.get("KEEP") != "1":
        from pymongo import MongoClient
        MongoClient(os.environ["MONGO_URL"]).drop_database(P.SCRATCH_DB)
