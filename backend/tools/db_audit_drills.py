# ruff: noqa: B023 — every drill lambda is called by both() inside its own loop iteration

"""Phase 3G race / stale-window / startup drills (REQ-296, 313, 314, JRN-124…130, 137, 138). THROW-AWAY copy only.

    python -m tools.db_audit_drills setup              # kkt_volume → kkt_audit_scratch
    python -m tools.db_audit_drills races  --label before [--reps 20]
    python -m tools.db_audit_drills stale  --label before [--redis redis://127.0.0.1:6390/0]
    python -m tools.db_audit_drills startup --label before [--reps 10]
    python -m tools.db_audit_drills teardown           # drops kkt_audit_scratch
Two backend processes (A :8101, B :8102) share the scratch DB, exactly like 2 live replicas share Atlas.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from datetime import date

import httpx
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools._env import DEMO_PASSWORD  # noqa: E402

SCRATCH = "kkt_audit_scratch"
SRC = "kkt_volume"
URL = os.environ["MONGO_URL"]
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")
PORTS = (8101, 8102)
OUT = "/app/memory/qa/db_audit"
assert "billpe" not in URL


def mdb():
    return MongoClient(URL)[SCRATCH]


def setup():
    MongoClient(URL).drop_database(SCRATCH)
    dump = subprocess.Popen(
        ["mongodump", f"--uri={URL}", f"--db={SRC}", "--archive", "--quiet"], stdout=subprocess.PIPE
    )
    subprocess.run(["mongorestore", f"--uri={URL}", "--archive", f"--nsFrom={SRC}.*", f"--nsTo={SCRATCH}.*", "--quiet"],
                   stdin=dump.stdout, check=True)  # fmt: skip
    dump.wait()
    print("scratch ready", mdb().bookings.count_documents({}))


def start(port, extra=None, cpus=None):
    env = {**os.environ, "DB_NAME": SCRATCH, "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS, "KKT_ROLE": "test",
           "BACKUP_ENABLED": "0", "DEMO_AUTO_REFRESH": "false", "ACCESS_TOKEN_MINUTES": "120", **(extra or {})}  # fmt: skip
    env.pop("REDIS_URL", None) if not (extra or {}).get("REDIS_URL") else None
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "server:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--log-level",
        "warning",
    ]
    if cpus:
        cmd = ["taskset", "-c", cpus] + cmd
    log = open(f"/tmp/kkt_drill_{port}.log", "w")
    return subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)


def wait_up(port, secs=120):
    for _ in range(secs):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2).json().get("startup", {}).get("done"):
                return True
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError(f"backend :{port} did not start (see /tmp/kkt_drill_{port}.log)")


def client(port, email="admin@kkt.in"):
    c = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=120, headers={"X-Rate-Limit-Bypass": BYPASS})
    r = c.post("/api/auth/login", json={"email": email, "password": DEMO_PASSWORD})
    c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return c


def both(fa, fb):
    """Run two calls at the same moment (barrier) and return both responses."""
    bar = threading.Barrier(2)
    out = [None, None]

    def go(i, f):
        bar.wait()
        try:
            out[i] = f()
        except Exception as e:  # noqa: BLE001
            out[i] = e

    ts = [threading.Thread(target=go, args=(i, f)) for i, f in enumerate((fa, fb))]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


def code(r):
    return r.status_code if isinstance(r, httpx.Response) else f"EXC {type(r).__name__}"


def msg(r):
    try:
        j = r.json()
        return (j.get("detail") or j.get("message") or j.get("error") or {}) if isinstance(j, dict) else None
    except Exception:  # noqa: BLE001
        return None


TODAY = date.today().isoformat()


def modes(c):
    return {m["code"]: m["id"] for m in c.get("/api/master/payment-modes").json()["items"]}


def pay_body(bid, md, amount=1000, mode="CASH"):
    b = {
        "booking_id": bid,
        "amount": amount,
        "payment_date": TODAY,
        "payment_mode_id": md[mode],
        "allocation": "auto",
        "remarks": "drill",
    }
    if mode != "CASH":
        b["bank_account_id"] = mdb().bank_accounts.find_one({"is_active": True})["id"]
        b["instrument"] = {"number": uuid.uuid4().hex[:6], "date": TODAY, "bank_name": "SBI"}
    return b


def active_bookings(n):
    db = mdb()
    q = {"status": "Active", "summary.outstanding_paise": {"$gt": 5_000_000}, "load_test": {"$ne": True}}
    return [b["id"] for b in db.bookings.find(q, {"_id": 0, "id": 1}).limit(n)]


def booking_checks(bid) -> list[str]:
    """Integrity of one booking after a drill: ledger seqs unique + gap-free, Σ allocations per bill ≤ bill, caps."""
    db = mdb()
    bad = []
    seqs = [e["seq"] for e in db.ledger_entries.find({"booking_id": bid}, {"seq": 1}).sort("seq", 1)]
    if len(seqs) != len(set(seqs)) or (seqs and seqs != list(range(seqs[0], seqs[0] + len(seqs)))):
        bad.append(f"ledger seqs {len(seqs)} rows / {len(set(seqs))} distinct")
    per = Counter()
    for p in db.payments.find(
        {"booking_id": bid, "status": "Cleared", "allocations.demand_id": {"$exists": True}}, {"allocations": 1}
    ):
        for a in p["allocations"]:
            if a.get("demand_id"):
                per[a["demand_id"]] += a["amount_paise"]
    for d in db.demands.find({"id": {"$in": list(per)}}, {"id": 1, "total_demand_paise": 1, "demand_number": 1}):
        if per[d["id"]] > d["total_demand_paise"]:
            bad.append(f"bill {d['demand_number']} allocated {per[d['id']]} > {d['total_demand_paise']}")
    b = db.bookings.find_one(
        {"id": bid}, {"summary": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "status": 1}
    )
    s = b.get("summary") or {}
    if (
        s.get("cash_paid_paise", 0) > b["cash_agreed_paise"]
        or s.get("account_paid_paise", 0) > b["account_agreed_paise"]
    ):
        bad.append("bucket paid above agreed")
    cleared = sum(
        p["amount_paise"]
        for p in db.payments.find(
            {"booking_id": bid, "status": "Cleared", "against": "FLAT_VALUE"}, {"amount_paise": 1}
        )
    )
    if (
        b["status"] == "Active"
        and s.get("paid_paise") is not None
        and abs(s["paid_paise"] - cleared) > 0
        and not db.payments.find_one({"booking_id": bid, "allocations.kind": "OTHER_CHARGE"})
    ):
        bad.append(f"summary paid {s['paid_paise']} != Σ cleared {cleared}")
    return bad


# ---------------------------------------------------------------- race drills
def races(label, reps):
    A, B = client(PORTS[0]), client(PORTS[1])
    md = modes(A)
    db = mdb()
    res = {}
    bks = active_bookings(reps * 4 + 10)

    # R1 same receipt, same idempotency key, at once (A and B)
    out = Counter()
    for i in range(reps):
        bid, key = bks[i], uuid.uuid4().hex
        h = {"Idempotency-Key": key}
        ra, rb = both(lambda: A.post("/api/payments", json=pay_body(bid, md), headers=h),
                      lambda: B.post("/api/payments", json=pay_body(bid, md), headers=h))  # fmt: skip
        n = db.payments.count_documents({"idempotency_key": key})
        same = (
            isinstance(ra, httpx.Response)
            and isinstance(rb, httpx.Response)
            and ra.status_code == rb.status_code == 201
            and ra.json().get("receipt_number") == rb.json().get("receipt_number")
        )
        out[f"receipts={n} codes={code(ra)}/{code(rb)} same_receipt={same}"] += 1
        out["integrity_bad"] += bool(booking_checks(bid))
    res["R1 same receipt + same key at once"] = dict(out)

    # R2 two different receipts on one booking at once
    out = Counter()
    ex = []
    for i in range(reps):
        bid = bks[reps + i]
        ra, rb = both(lambda: A.post("/api/payments", json=pay_body(bid, md, 700000), headers={"Idempotency-Key": uuid.uuid4().hex}),
                      lambda: B.post("/api/payments", json=pay_body(bid, md, 900000), headers={"Idempotency-Key": uuid.uuid4().hex}))  # fmt: skip
        bad = booking_checks(bid)
        out[f"codes={code(ra)}/{code(rb)}"] += 1
        out["integrity_bad"] += bool(bad)
        if bad and len(ex) < 3:
            ex.append({"booking": bid, "bad": bad})
    res["R2 two receipts on one booking at once"] = {**out, "examples": ex}

    # R7 receipt while the booking is cancelled
    out = Counter()
    ex = []
    for i in range(min(reps, 10)):
        bid = bks[2 * reps + i]
        v = A.get(f"/api/bookings/{bid}").json()["version"]
        ra, rb = both(lambda: A.post("/api/payments", json=pay_body(bid, md, 500000), headers={"Idempotency-Key": uuid.uuid4().hex}),
                      lambda: B.post(f"/api/bookings/{bid}/cancel", json={"reason": "drill cancel", "version": v}))  # fmt: skip
        b = db.bookings.find_one({"id": bid}, {"status": 1, "cancellation": 1})
        received_rec = (b.get("cancellation") or {}).get("received_paise")
        cleared = sum(
            p["amount_paise"] for p in db.payments.find({"booking_id": bid, "status": "Cleared"}, {"amount_paise": 1})
        )
        ok = (
            b["status"] != "Cancelled"
            or received_rec == cleared
            or db.payments.count_documents({"booking_id": bid, "remarks": "drill", "status": "Cleared"}) == 0
        )
        out[f"codes pay/cancel={code(ra)}/{code(rb)} accounted={ok}"] += 1
        if not ok and len(ex) < 3:
            ex.append({"booking": bid, "cancellation_received": received_rec, "cleared_now": cleared})
    res["R7 receipt during cancellation"] = {**out, "examples": ex}

    # R8 two ledger appends at once: a receipt on A and a cheque-clear on B (both rebuild the same ledger)
    out = Counter()
    ex = []
    for i in range(reps):
        bid = bks[3 * reps + i] if 3 * reps + i < len(bks) else bks[i]
        chq = A.post(
            "/api/payments", json=pay_body(bid, md, 1000, "CHEQUE"), headers={"Idempotency-Key": uuid.uuid4().hex}
        )
        if chq.status_code != 201:
            out[f"cheque post {chq.status_code}"] += 1
            continue
        pid = chq.json()["id"]
        ra, rb = both(lambda: A.post("/api/payments", json=pay_body(bid, md, 1000), headers={"Idempotency-Key": uuid.uuid4().hex}),
                      lambda: B.post(f"/api/payments/{pid}/clear", json={"cleared_on": TODAY}))  # fmt: skip
        bad = booking_checks(bid)
        out[f"codes={code(ra)}/{code(rb)}"] += 1
        out["integrity_bad"] += bool(bad)
        if bad and len(ex) < 3:
            ex.append({"booking": bid, "bad": bad})
    res["R8 two ledger rebuilds on one booking at once"] = {**out, "examples": ex}

    # R3 two bookings on one flat at once
    out = Counter()
    flats = [
        f
        for f in db.flats.find(
            {"status": "Available", "is_active": {"$ne": False}, "price_paise": {"$gt": 0}},
            {"_id": 0, "id": 1, "project_id": 1, "block_id": 1, "price_paise": 1},
        ).limit(reps * 3)
    ]
    cust = A.post(
        "/api/customers",
        json={"full_name": "Drill Buyer", "phone": "+919000000777", "source": "Walk-in"},
        headers={"Idempotency-Key": uuid.uuid4().hex},
    ).json()
    done = 0
    for f in flats:
        if done >= reps:
            break
        plans = A.get(f"/api/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans").json().get("items") or []
        price = f["price_paise"] / 100
        pre = A.post(
            "/api/bookings/breakdown-preview",
            json={"flat_id": f["id"], "agreement_value": price, "has_plan": bool(plans)},
        )
        if pre.status_code != 200 or not plans:
            continue
        oc = [
            {k: x.get(k) for k in ("charge_type_id", "name", "source", "amount", "gst_percent", "demand_at")}
            for x in pre.json()["charges"]
            if x.get("code") != "AGR_GST"
        ]
        body = {"flat_id": f["id"], "customer_id": cust["id"], "booking_date": TODAY, "agreement_value": price, "cash_agreed": 0,
                "account_agreed": price, "payment_plan_id": plans[0]["id"], "other_charges": oc, "agreement_gst_percent": 5, "remarks": "drill"}  # fmt: skip
        before_d = db.demands.count_documents({"flat_id": f["id"]})
        ra, rb = both(lambda: A.post("/api/bookings", json=body, headers={"Idempotency-Key": uuid.uuid4().hex}),
                      lambda: B.post("/api/bookings", json=body, headers={"Idempotency-Key": uuid.uuid4().hex}))  # fmt: skip
        n = db.bookings.count_documents({"flat_id": f["id"], "status": "Active"})
        loser = rb if code(ra) == 201 else ra
        stray = db.demands.count_documents({"flat_id": f["id"]}) - before_d
        out[f"live_bookings={n} codes={code(ra)}/{code(rb)}"] += 1
        out[f"loser says: {str(msg(loser))[:70]}"] += 1
        out["bookings_total_for_flat"] += db.bookings.count_documents({"flat_id": f["id"], "remarks": "drill"})
        out["bills_after"] += stray
        done += 1
    res["R3 two bookings on one flat at once"] = dict(out)

    # R4 same waiver approved twice at once; R5 two waivers approved at once
    out4, out5 = Counter(), Counter()
    sales = client(PORTS[0], "accounts@kkt.in")
    wb = [
        b["id"]
        for b in db.bookings.find({"status": "Active", "summary.account_due_paise": {"$gt": 100000}}, {"id": 1}).limit(
            reps * 3
        )
    ]
    for i in range(reps):
        bid = wb[i % len(wb)]
        mk = lambda: sales.post(
            "/api/waivers",
            json={
                "booking_id": bid,
                "target": {"kind": "share", "share": "Account"},
                "amount": 10,
                "reason": "drill waiver",
            },
        )
        w1 = mk()
        if w1.status_code != 201:
            out4[f"request {w1.status_code} {str(msg(w1))[:60]}"] += 1
            continue
        wid = w1.json()["id"]
        ra, rb = both(lambda: A.post(f"/api/waivers/{wid}/approve"), lambda: B.post(f"/api/waivers/{wid}/approve"))
        audits = db.audit_logs.count_documents(
            {
                "action": {"$in": ["waiver.approve", "waiver.self_approve"]},
                "after.waiver_number": w1.json()["waiver_number"],
            }
        )
        loser = rb if code(ra) == 200 else ra
        out4[f"codes={code(ra)}/{code(rb)} approval_audits={audits}"] += 1
        out4[f"loser says: {str(msg(loser))[:60]}"] += 1
        x, y = mk(), mk()
        if x.status_code == 201 and y.status_code == 201:
            ra, rb = both(
                lambda: A.post(f"/api/waivers/{x.json()['id']}/approve"),
                lambda: B.post(f"/api/waivers/{y.json()['id']}/approve"),
            )
            cns = [db.waivers.find_one({"id": w.json()["id"]}).get("cn_number") for w in (x, y)]
            out5[f"codes={code(ra)}/{code(rb)} distinct_cn={len(set(cns)) == 2 and None not in cns}"] += 1
        # approve vs reject at once
        z = mk()
        if z.status_code == 201:
            ra, rb = both(lambda: A.post(f"/api/waivers/{z.json()['id']}/approve"),
                          lambda: B.post(f"/api/waivers/{z.json()['id']}/reject", json={"reason": "drill reject"}))  # fmt: skip
            st = db.waivers.find_one({"id": z.json()["id"]})
            out4[f"approve/reject codes={code(ra)}/{code(rb)} final={st['status']} cn={bool(st.get('cn_number'))}"] += 1
    res["R4 same waiver approved twice at once (+ approve vs reject)"] = dict(out4)
    res["R5 two waivers approved at once"] = dict(out5)
    cn_dups = list(
        db.waivers.aggregate(
            [
                {"$match": {"cn_number": {"$type": "string"}}},
                {"$group": {"_id": "$cn_number", "n": {"$sum": 1}}},
                {"$match": {"n": {"$gt": 1}}},
            ]
        )
    )
    res["R5 duplicate credit-note numbers"] = len(cn_dups)

    # R6 stage completed twice at once
    out = Counter()
    n = 0
    for blk in db.blocks.find({}, {"_id": 0, "id": 1}):
        if n >= min(reps, 6):
            break
        st = A.get(f"/api/blocks/{blk['id']}/construction").json().get("stages") or []
        pend = [s for s in st if s["status"] != "Completed"]
        nb = db.bookings.count_documents({"block_id": blk["id"], "status": "Active"})
        if not pend or not (0 < nb <= 80):
            continue
        sid = pend[0]["stage_id"]
        before = db.demands.count_documents({"block_id": blk["id"], "voided": False})
        body = {"stage_id": sid, "completed_on": TODAY, "notes": "drill"}
        ra, rb = both(lambda: A.post(f"/api/blocks/{blk['id']}/construction/stage", json=body),
                      lambda: B.post(f"/api/blocks/{blk['id']}/construction/stage", json=body))  # fmt: skip
        raised = db.demands.count_documents({"block_id": blk["id"], "voided": False}) - before
        dup = list(
            db.demands.aggregate(
                [
                    {"$match": {"block_id": blk["id"], "voided": False}},
                    {"$group": {"_id": {"b": "$booking_id", "s": "$installment_seq"}, "n": {"$sum": 1}}},
                    {"$match": {"n": {"$gt": 1}}},
                ]
            )
        )
        gst_parts = list(
            db.bookings.aggregate(
                [
                    {"$match": {"block_id": blk["id"], "status": "Active"}},
                    {"$unwind": "$other_charges"},
                    {"$unwind": "$other_charges.demand_history"},
                    {"$match": {"other_charges.demand_history.stage_id": sid}},
                    {"$group": {"_id": {"b": "$id", "l": "$other_charges.line_id"}, "n": {"$sum": 1}}},
                    {"$match": {"n": {"$gt": 1}}},
                ]
            )
        )
        out[f"codes={code(ra)}/{code(rb)} dup_bills={len(dup)} dup_gst_parts={len(gst_parts)}"] += 1
        out["bills_raised_total"] += raised
        out["bookings_in_towers"] += nb
        n += 1
    res["R6 stage completed twice at once"] = dict(out)

    # R9 direct duplicate ledger line
    e = db.ledger_entries.find_one({}, {"_id": 0})
    try:
        db.ledger_entries.insert_one({**e, "id": uuid.uuid4().hex, "note": "drill duplicate"})
        res["R9 direct duplicate ledger (booking, seq) insert"] = "ACCEPTED by the database"
        db.ledger_entries.delete_one({"note": "drill duplicate"})
    except Exception as ex_:  # noqa: BLE001
        res["R9 direct duplicate ledger (booking, seq) insert"] = f"refused: {type(ex_).__name__}"
    for name in ("waiver_number", "cn_number"):
        w = db.waivers.find_one({name: {"$type": "string"}}, {"_id": 0})
        try:
            db.waivers.insert_one({**w, "id": uuid.uuid4().hex, "status": "Rejected", "note": "drill duplicate"})
            res[f"R10 direct duplicate {name}"] = "ACCEPTED by the database"
            db.waivers.delete_one({"note": "drill duplicate"})
        except Exception as ex_:  # noqa: BLE001
            res[f"R10 direct duplicate {name}"] = f"refused: {type(ex_).__name__}"
    save(f"races_{label}", res)


# ---------------------------------------------------------------- stale window (2 processes)
VOLATILE = (
    "computed_at",
    "generated_at",
    "data_age",
    "took_ms",
    "ms",
    "server_time",
    "etag",
    "cached",
    "age_s",
    "stamp",
    "greeting_date",
    "recent_audit",
)  # activity feed: background jobs add rows on their own


def _clean(x):
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items() if k not in VOLATILE and not k.endswith("_ms")}
    if isinstance(x, list):
        return [_clean(v) for v in x]
    return x


def fpj(j):
    return json.dumps(_clean(j), sort_keys=True, default=str)


SURFACES = [
    ("Home", "/api/home/bundle?period=fy", lambda j, ctx: fpj(j)),
    ("Home legacy", "/api/dashboard/home", lambda j, ctx: fpj(j)),
    ("Booking page", "/api/bookings/{bid}", lambda j, ctx: fpj(j.get("summary"))),
    ("Customer 360", "/api/customers/{cid}", lambda j, ctx: fpj(j)),
    ("Bills raised", "/api/demands/register?booking_id={bid}&page_size=50", lambda j, ctx: fpj(j)),
    ("Outstanding", "/api/reports/outstanding-v2", lambda j, ctx: fpj(j.get("totals", j))),
    (
        "Collections",
        "/api/reports/collections-v2?from_date={fy0}&to_date={today}",
        lambda j, ctx: fpj(j.get("totals", j)),
    ),
    ("Customer status", "/api/reports/v3/customer-status", lambda j, ctx: fpj(j.get("totals", j))),
    ("Bills vs Collection", "/api/reports/v3/bills-vs-collection", lambda j, ctx: fpj(j.get("totals", j))),
    (
        "Payments list",
        "/api/payments?booking_id={bid}&page_size=50",
        lambda j, ctx: fpj([x.get("receipt_number") for x in j.get("items", [])]),
    ),
    ("Dashboard", "/api/dashboard", lambda j, ctx: fpj(j)),
]


def _read_all(c, ctx):
    out = {}
    for name, path, fp in SURFACES:
        r = c.get(path.format(**ctx))
        out[name] = fp(r.json(), ctx) if r.status_code == 200 else f"HTTP {r.status_code}"
    return out


def stale(label, reps, redis_url=None):
    extra = {"REDIS_URL": redis_url} if redis_url else None
    procs = [start(p, extra) for p in PORTS]
    try:
        [wait_up(p) for p in PORTS]
        A, B = client(PORTS[0]), client(PORTS[1])
        md = modes(A)
        t = date.today()
        fy0 = date(t.year if t.month >= 4 else t.year - 1, 4, 1).isoformat()
        rows = []
        bks = active_bookings(reps + 2)
        acc = client(PORTS[0], "accounts@kkt.in")
        db = mdb()
        for i in range(reps * 3):
            kind = ("receipt", "waiver approve", "stage complete")[i % 3]
            bid = bks[i // 3]
            if kind == "waiver approve":
                bid = (
                    db.bookings.find({"status": "Active", "summary.account_due_paise": {"$gt": 100000}}, {"id": 1})
                    .skip(i)
                    .limit(1)[0]["id"]
                )
            if kind == "stage complete":
                blk = None
                for b in db.blocks.find({}, {"_id": 0, "id": 1}):
                    st = A.get(f"/api/blocks/{b['id']}/construction").json().get("stages") or []
                    pend = [s for s in st if s["status"] != "Completed"]
                    one = db.bookings.find_one({"block_id": b["id"], "status": "Active"}, {"id": 1})
                    if pend and one and db.bookings.count_documents({"block_id": b["id"], "status": "Active"}) <= 60:
                        blk, sid, bid = b["id"], pend[0]["stage_id"], one["id"]
                        break
                if not blk:
                    continue
            cid = db.bookings.find_one({"id": bid})["customer_id"]
            ctx = {"bid": bid, "cid": cid, "fy0": fy0, "today": TODAY}
            _read_all(B, ctx)  # warm B's caches with the old figures
            _read_all(B, ctx)
            if kind == "receipt":
                r = A.post(
                    "/api/payments", json=pay_body(bid, md, 1000 + i), headers={"Idempotency-Key": uuid.uuid4().hex}
                )
            elif kind == "waiver approve":
                w = acc.post(
                    "/api/waivers",
                    json={
                        "booking_id": bid,
                        "target": {"kind": "share", "share": "Account"},
                        "amount": 10 + i,
                        "reason": "drill stale",
                    },
                )
                _read_all(B, ctx)
                r = A.post(f"/api/waivers/{w.json()['id']}/approve") if w.status_code == 201 else w
            else:
                r = A.post(
                    f"/api/blocks/{blk}/construction/stage",
                    json={"stage_id": sid, "completed_on": TODAY, "notes": "drill stale"},
                )
            assert r.status_code in (200, 201), r.text[:200]
            truth = _read_all(A, ctx)  # what A shows right after its own write
            t0 = time.monotonic()
            first = _read_all(B, ctx)
            pending = {k for k in SURFACES_NAMES() if first[k] != truth[k]}
            secs = {k: 0.0 for k in SURFACES_NAMES() if k not in pending}
            while pending and time.monotonic() - t0 < 40:
                time.sleep(0.5)
                now = _read_all(B, ctx)
                for k in list(pending):
                    if now[k] == truth[k]:
                        secs[k] = round(time.monotonic() - t0, 1)
                        pending.discard(k)
            for k in pending:
                secs[k] = ">40"
                secs[k + " diff"] = _diff(json.loads(now[k]) if now[k].startswith(("{", "[")) else now[k],
                                          json.loads(truth[k]) if truth[k].startswith(("{", "[")) else truth[k])  # fmt: skip
            rows.append({"action": kind, **secs})
        summary = {k: sorted({str(r[k]) for r in rows if k in r}) for k in SURFACES_NAMES()}
        save(
            f"stale_{label}{'_redis' if redis_url else ''}",
            {"reps": reps, "redis": bool(redis_url), "per_surface_seconds": summary, "rows": rows},
        )
    finally:
        [p.kill() for p in procs]


def _diff(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            d = _diff(a.get(k), b.get(k), f"{p}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            d = _diff(x, y, f"{p}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{p}: B={str(a)[:60]} A={str(b)[:60]}"


def SURFACES_NAMES():
    return [s[0] for s in SURFACES]


# ---------------------------------------------------------------- 2 processes start together
def startup(label, reps):
    db = mdb()
    res = Counter()
    for i in range(reps):
        db.locks.delete_many({})
        ix_before = {c: sorted(db[c].index_information()) for c in db.list_collection_names()}
        jr_before = db.job_runs.count_documents({})
        procs = [start(p) for p in PORTS]
        try:
            [wait_up(p) for p in PORTS]
            time.sleep(3)
            errs = 0
            for p in PORTS:
                txt = open(f"/tmp/kkt_drill_{p}.log").read()
                errs += txt.count("Traceback") + txt.count("ERROR")
            res[f"start errors={errs}"] += 1
            leaders = db.locks.find_one({"name": "scheduler"}, {"owner": 1})
            res[f"scheduler lease held by one owner={bool(leaders)}"] += 1
            ix_after = {c: sorted(db[c].index_information()) for c in db.list_collection_names()}
            res[f"index sets unchanged={ix_after == ix_before}"] += 1
            new_runs = list(db.job_runs.aggregate([{"$sort": {"_id": -1}}, {"$limit": db.job_runs.count_documents({}) - jr_before or 1},
                                                    {"$group": {"_id": "$job", "n": {"$sum": 1}, "owners": {"$addToSet": "$owner"}}}]))  # fmt: skip
            res[f"job kinds run twice={sum(1 for r in new_runs if len(r.get('owners') or []) > 1)}"] += 1
        finally:
            [p.kill() for p in procs]
            time.sleep(1)
    save(f"startup_{label}", dict(res))


def save(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/drill_{name}.json", "w") as fh:
        json.dump(obj, fh, indent=1, default=str)
    print(name, json.dumps(obj, indent=1, default=str)[:4000])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["setup", "races", "stale", "startup", "teardown", "serve"])
    ap.add_argument("--label", default="run")
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--redis")
    a = ap.parse_args()
    if a.what == "setup":
        setup()
    elif a.what == "teardown":
        MongoClient(URL).drop_database(SCRATCH)
    elif a.what == "races":
        procs = [start(p) for p in PORTS]
        try:
            [wait_up(p) for p in PORTS]
            races(a.label, a.reps)
        finally:
            [p.kill() for p in procs]
    elif a.what == "stale":
        stale(a.label, a.reps, a.redis)
    elif a.what == "startup":
        startup(a.label, a.reps)


if __name__ == "__main__":
    main()
