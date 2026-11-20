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
def login(email):
    r = httpx.post(f"{BASE}/auth/login", json={"email":email,"password":_pw()}, timeout=30)
    assert r.status_code == 200, r.text
    return httpx.Client(base_url=BASE, headers={"Authorization":"Bearer "+r.json()["access_token"]}, timeout=60)
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
