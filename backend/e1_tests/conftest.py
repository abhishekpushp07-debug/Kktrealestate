import os, httpx, pytest
BASE = "http://localhost:8001/api"
def _pw():
    for l in open("/app/backend/.env"):
        if l.startswith("DEMO_PASSWORD="): return l.split("=",1)[1].strip().strip('"')
@pytest.fixture(scope="session")
def api():
    r = httpx.post(f"{BASE}/auth/login", json={"email":"admin@kkt.in","password":_pw()}, timeout=30)
    assert r.status_code == 200, r.text
    c = httpx.Client(base_url=BASE, headers={"Authorization": "Bearer "+r.json()["access_token"]}, timeout=60)
    yield c
    c.close()
@pytest.fixture(scope="session")
def home(api):
    r = api.get("/dashboard/home"); assert r.status_code == 200; return r.json()
def block_id(home, project_code, name):
    for p in home["projects"]:
        if p["code"] == project_code:
            for b in p["blocks"]:
                if b["name"] == name: return b["block_id"]

# ---- Phase 3E helpers (QA-prefixed fixtures) ----
import random as _r, datetime as _dt
SGH = "8e4ef80c-0ce8-4fe6-8c46-7b552afe0d8a"
_LOGIN_CACHE = {}
def login(email, fresh=False):
    if email in _LOGIN_CACHE and not fresh: return _LOGIN_CACHE[email]
    r = httpx.post(f"{BASE}/auth/login", json={"email":email,"password":_pw()}, timeout=30)
    assert r.status_code == 200, r.text
    c = httpx.Client(base_url=BASE, headers={"Authorization":"Bearer "+r.json()["access_token"]}, timeout=60)
    if not fresh: _LOGIN_CACHE[email] = c
    return c
def qa_customer(c, tag, **kw):
    body = {"full_name": f"QA tscheck {tag} {_r.randint(1000,9999)}", "phone": "9"+str(_r.randint(100000000,999999999))}
    body.update(kw)
    r = c.post("/customers", json=body); assert r.status_code in (200,201), r.text
    return r.json()
def qa_booking(c, tag, discount=100000, reason="QA tscheck reason", days_ago=0):
    cust = qa_customer(c, tag)
    fl = [f for f in c.get("/flats", params={"project_id":SGH,"status":"Available","limit":100}).json()["items"] if f.get("bookable")]
    assert fl, "no bookable SGH flat"
    f = _r.choice(fl); av = f["price"] - discount
    body = {"flat_id":f["id"],"customer_id":cust["id"],"booking_date":(_dt.date.today()-_dt.timedelta(days=days_ago)).isoformat(),
            "agreement_value":av,"cash_agreed":round(av*0.2),"account_agreed":av-round(av*0.2)}
    if discount: body["discount_reason"] = reason
    r = c.post("/bookings", json=body); assert r.status_code in (200,201), r.text
    CREATED.append(("booking", r.json()["booking_number"], r.json()["id"]))
    return cust, r.json()
CREATED = []
def pytest_sessionfinish(session, exitstatus):
    if CREATED:
        open("/tmp/tscheck_3e_created.txt","a").write("\n".join(map(str,CREATED))+"\n")

# ---- Phase 3G concurrency helpers ----
import threading as _th, uuid as _uuid
CASH_MODE = "b6a7dde1-e9f2-4826-983f-1c38b7f4279a"
VILLA_P = "0d220380-bdd3-4202-9769-7a5db753b75a"
ORION = "8c8d8d49-1575-45d7-86b0-70f09cc71917"
def parallel(*fns):
    out=[None]*len(fns); bar=_th.Barrier(len(fns))
    def run(i,f):
        bar.wait()
        try: out[i]=f()
        except Exception as e: out[i]=e
    ts=[_th.Thread(target=run,args=(i,f)) for i,f in enumerate(fns)]
    [t.start() for t in ts]; [t.join() for t in ts]
    return out
def booking_on_flat(c, tag, flat, cust=None):
    cust = cust or qa_customer(c, tag)
    av = flat["price"]
    return {"flat_id":flat["id"],"customer_id":cust["id"],"booking_date":_dt.date.today().isoformat(),
            "agreement_value":av,"cash_agreed":round(av*0.2),"account_agreed":av-round(av*0.2)}
def avail_flats(c, block_id):
    return [f for f in c.get("/flats", params={"block_id":block_id,"status":"Available","limit":100}).json()["items"] if f.get("bookable")]
def ledger_len(c, bid):
    j = c.get(f"/bookings/{bid}/ledger").json()
    items = j if isinstance(j, list) else (j.get("items") or j.get("entries") or j.get("rows") or [])
    return len(items)
def summary(c, bid):
    return c.get(f"/bookings/{bid}").json()["summary"]
