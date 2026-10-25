"""Phase 11A — code-review fixes, canonical additions, API packeting, index audit. Run per file (login limiter)."""
import os
import threading
import time
import uuid
from datetime import date, timedelta

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env"))
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
PWD = "Kkt@12345"
_tok = {}


def tok(email="admin@kkt.in", pwd=PWD):
    if email not in _tok:
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=15)
        assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
        _tok[email] = r.json()["access_token"]
    return _tok[email]


def H(email="admin@kkt.in", pwd=PWD):
    return {"Authorization": f"Bearer {tok(email, pwd)}", "Idempotency-Key": str(uuid.uuid4())}


def active_booking():
    r = requests.get(f"{BASE}/bookings?status=Active&page_size=50", headers=H(), timeout=15).json()
    return [b for b in r["items"] if b["cash_agreed_paise"] - b["summary"]["cash_paid_paise"] > 0]


def cash_mode():
    modes = requests.get(f"{BASE}/master/payment-modes", headers=H(), timeout=15).json()["items"]
    return next(m for m in modes if m["code"] == "CASH")["id"]


# ---------- 1a. atomic bucket cap ----------
def test_bucket_cap_race_exactly_one_succeeds():
    b = next(b for b in active_booking())
    headroom = b["cash_agreed_paise"] - b["summary"]["cash_paid_paise"]
    amt = (headroom // 100) * 0.6  # rupees; two of these exceed headroom
    assert amt >= 1
    results = []
    mode = cash_mode()

    def post():
        r = requests.post(f"{BASE}/payments", headers=H(), json={"booking_id": b["id"], "payment_category": "Cash", "amount": amt, "payment_date": date.today().isoformat(), "payment_mode_id": mode}, timeout=30)
        results.append((r.status_code, r.json().get("code"), r.json().get("id")))
    ts = [threading.Thread(target=post) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    codes = sorted(r[0] for r in results)
    assert codes == [201, 409], results
    assert next(r[1] for r in results if r[0] == 409) == "BUCKET_EXCEEDS_AGREED"
    pid = next(r[2] for r in results if r[0] == 201)
    r = requests.post(f"{BASE}/payments/{pid}/reverse", headers=H(), json={"reason": "test cleanup race"}, timeout=15)
    assert r.status_code == 200
    bb = requests.get(f"{BASE}/bookings/{b['id']}", headers=H(), timeout=15).json()
    assert bb["summary"]["cash_paid_paise"] == b["summary"]["cash_paid_paise"]


# ---------- 1f. last_payment_at ignores reversed ----------
def test_last_payment_ignores_reversed():
    b = next(b for b in active_booking())
    before = b["summary"].get("last_payment_at")
    r = requests.post(f"{BASE}/payments", headers=H(), json={"booking_id": b["id"], "payment_category": "Cash", "amount": 1, "payment_date": date.today().isoformat(), "payment_mode_id": cash_mode()}, timeout=30)
    assert r.status_code == 201, r.text
    requests.post(f"{BASE}/payments/{r.json()['id']}/reverse", headers=H(), json={"reason": "test"}, timeout=15)
    after = requests.get(f"{BASE}/bookings/{b['id']}", headers=H(), timeout=15).json()["summary"].get("last_payment_at")
    assert after == before


# ---------- 1b. document scope ----------
def test_document_project_scope_404():
    h = H()
    projects = requests.get(f"{BASE}/projects", headers=h, timeout=15).json()["items"]
    assert len(projects) >= 2
    a, b = projects[0], projects[1]
    bk = next(x for x in requests.get(f"{BASE}/bookings?project_id={b['id']}&page_size=5", headers=h, timeout=15).json()["items"])
    roles = requests.get(f"{BASE}/roles", headers=h, timeout=15).json()["items"]
    sales = next(r for r in roles if r["name"] == "Sales")
    email = f"scoped-{uuid.uuid4().hex[:6]}@kkt.in"
    r = requests.post(f"{BASE}/users", headers=h, json={"name": "Scoped A", "email": email, "password": "Scoped@12345", "role_id": sales["id"], "project_scope": [a["id"]]}, timeout=15)
    assert r.status_code == 201, r.text
    sh = H(email, "Scoped@12345")
    r = requests.get(f"{BASE}/documents?entity_type=booking&entity_id={bk['id']}", headers=sh, timeout=15)
    assert r.status_code == 404, r.text
    files = {"file": ("x.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}
    r = requests.post(f"{BASE}/documents", headers={"Authorization": sh["Authorization"]}, data={"entity_type": "booking", "entity_id": bk["id"]}, files=files, timeout=30)
    assert r.status_code == 404
    r = requests.get(f"{BASE}/documents?entity_type=booking&entity_id={bk['id']}", headers=h, timeout=15)
    assert r.status_code == 200


# ---------- 1c. erasure ----------
def test_erasure_scrubs_portal_and_tickets():
    h = H()
    ph = "98" + str(int(time.time()))[-8:]
    r = requests.post(f"{BASE}/customers", headers=h, json={"full_name": "Erase Me", "phone": ph}, timeout=15)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    r = requests.post(f"{BASE}/customers/{cid}/portal/enable", headers=H(), timeout=15)
    assert r.status_code in (200, 201), r.text
    r = requests.post(f"{BASE}/admin/customers/{cid}/erase", headers=H(), json={"confirm": "ERASE", "reason": "test"}, timeout=15)
    assert r.status_code == 200, r.text
    st = requests.get(f"{BASE}/customers/{cid}/portal", headers=h, timeout=15).json()
    assert st.get("is_active") is False
    assert st.get("login_phone", "").startswith("erased-")
    r = requests.post(f"{BASE}/portal/auth/login", json={"phone": ph, "password": "whatever"}, timeout=15)
    assert r.status_code in (401, 404, 422, 429)


# ---------- 1d. visit links expire / revoke ----------
def test_visit_links_revoked_on_completed():
    h = H()
    pid = requests.get(f"{BASE}/projects", headers=h, timeout=15).json()["items"][0]["id"]
    slug = requests.get(f"{BASE}/projects/{pid}", headers=h, timeout=15).json().get("website", {}).get("slug")
    d = (date.today() + timedelta(days=2)).isoformat()
    av = requests.get(f"{BASE}/public/site-visits/availability?project_slug={slug}&from={d}&to={(date.today() + timedelta(days=9)).isoformat()}", timeout=15).json()
    day = next(x for x in av["days"] if x["slots"])
    slot = next(s for s in day["slots"] if s["available_count"] > 0)
    r = requests.post(f"{BASE}/public/site-visits", json={"project_slug": slug, "date": day["date"], "slot_start": slot["start"], "name": "Link Test", "phone": "9876500011", "consent": True}, timeout=15)
    assert r.status_code in (200, 201), r.text
    v = r.json()
    vid = requests.get(f"{BASE}/site-visits?search=9876500011&page_size=1&sort=-created_at", headers=H(), timeout=15).json()["items"][0]["id"]
    ics = v["ics_url"]
    assert requests.get(f"{BASE.rsplit('/api', 1)[0]}{ics}", timeout=15).status_code == 200
    r = requests.post(f"{BASE}/site-visits/{vid}/complete", headers=H(), json={"note": "done"}, timeout=15)
    assert r.status_code == 200, r.text
    assert requests.get(f"{BASE.rsplit('/api', 1)[0]}{ics}", timeout=15).status_code == 410
    import base64, json
    raw = ics.rsplit("/", 1)[1].replace(".ics", "").split(".")[0]
    payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    assert payload.get("exp"), "signed visit links must carry an expiry"


# ---------- 2. catalogues / setup / crm / ledgers / read models ----------
def test_catalogue_bundle_etag_and_inline_add():
    h = H()
    r = requests.get(f"{BASE}/catalogues", headers=h, timeout=15)
    assert r.status_code == 200 and r.headers.get("ETag")
    local = requests.get("http://localhost:8001/api/catalogues", headers=h, timeout=15)  # the preview ingress rewrites Cache-Control
    assert "max-age=300" in local.headers["Cache-Control"]
    types = r.json()["types"]
    for t in ("salutation", "state", "city", "locality", "bank", "lead_source", "communication_type", "projects", "blocks", "flat_types", "payment_plans", "users"):
        assert types.get(t), t
    assert len(types["state"]) >= 36 and len(types["bank"]) >= 30
    r2 = requests.get(f"{BASE}/catalogues", headers={**h, "If-None-Match": r.headers["ETag"]}, timeout=15)
    assert r2.status_code == 304
    label = f"Astronaut {uuid.uuid4().hex[:4]}"
    r = requests.post(f"{BASE}/catalogues/occupation/items", headers=H("sales@kkt.in"), json={"label": label}, timeout=15)
    assert r.status_code == 201, r.text
    assert requests.post(f"{BASE}/catalogues/occupation/items", headers=H(), json={"label": label}, timeout=15).status_code == 409
    r3 = requests.get(f"{BASE}/catalogues", headers={**h, "If-None-Match": r2.headers.get("ETag", "")}, timeout=15)
    assert r3.status_code == 200 and r3.json()["version"] > 0
    assert requests.post(f"{BASE}/catalogues/occupation/items", headers=H("employee@kkt.in"), json={"label": "X"}, timeout=15).status_code == 403


def test_project_setup_hierarchy_errors():
    h = H()
    projects = requests.get(f"{BASE}/projects", headers=h, timeout=15).json()["items"]
    s = requests.get(f"{BASE}/projects/{projects[0]['id']}/setup", headers=h, timeout=15).json()
    assert s["towers"] and s["stages"]["project_sequence"] and "checklist" in s
    r = requests.put(f"{BASE}/projects/{projects[0]['id']}/setup/pricing", headers=h, json={"block_rates": [{"block_id": "not-a-tower", "rate_per_sqft": 4000}]}, timeout=15)
    assert r.status_code == 404 and r.json()["code"] == "TOWER_NOT_IN_PROJECT"
    r = requests.put(f"{BASE}/projects/{projects[0]['id']}/setup/nope", headers=h, json={}, timeout=15)
    assert r.status_code == 404
    t = s["towers"][0]
    r = requests.put(f"{BASE}/projects/{projects[0]['id']}/setup/pricing", headers=h, json={"block_rates": [{"block_id": t["id"], "rate_per_sqft": t["rate_per_sqft"], "floor_rise_per_sqft": t["floor_rise_per_sqft"]}]}, timeout=15)
    assert r.status_code == 200


def test_crm_profile_communication_timeline():
    h = H()
    cat = requests.get(f"{BASE}/catalogues", headers=h, timeout=15).json()["types"]
    c = requests.get(f"{BASE}/customers?page_size=1", headers=h, timeout=15).json()["items"][0]
    r = requests.patch(f"{BASE}/customers/{c['id']}/profile", headers=h, json={"segment_ids": [cat["customer_segment"][0]["id"]], "occupation_id": cat["occupation"][0]["id"], "preferences": {"bhk_ids": [cat["bhk_preference"][0]["id"]]}}, timeout=15)
    assert r.status_code == 200, r.text
    assert requests.patch(f"{BASE}/customers/{c['id']}/profile", headers=h, json={"occupation_id": cat["gender"][0]["id"]}, timeout=15).status_code == 422
    r = requests.post(f"{BASE}/communications", headers=H(), json={"customer_id": c["id"], "type_id": cat["communication_type"][0]["id"], "outcome_id": cat["communication_outcome"][0]["id"], "notes": "Test call"}, timeout=15)
    assert r.status_code == 201, r.text
    cc = requests.get(f"{BASE}/customers/{c['id']}", headers=h, timeout=15).json()
    assert cc.get("last_contacted_at")
    tl = requests.get(f"{BASE}/customers/{c['id']}/timeline?limit=3", headers=h, timeout=15).json()
    assert tl["items"] and tl["items"][0]["type"] == "communication"
    assert "next_cursor" in tl
    page2 = requests.get(f"{BASE}/customers/{c['id']}/timeline?limit=3&cursor={tl['next_cursor']}", headers=h, timeout=15).json() if tl["next_cursor"] else {"items": []}
    assert all(e["at"] < tl["next_cursor"] for e in page2["items"]) if tl["next_cursor"] else True


def test_three_ledgers_and_customer_ledgers():
    h = H()
    b = requests.get(f"{BASE}/bookings?status=Active&page_size=1", headers=h, timeout=15).json()["items"][0]
    l = requests.get(f"{BASE}/bookings/{b['id']}/ledgers", headers=h, timeout=15).json()
    for k in ("cash", "account", "other_charges", "combined"):
        assert set(l[k]["summary"]) >= {"agreed_paise", "raised_paise", "paid_paise", "due_paise", "advance_paise", "pending_cheques_paise"}
    assert l["cash"]["summary"]["agreed_paise"] == b["cash_agreed_paise"]
    assert l["cash"]["summary"]["paid_paise"] + l["account"]["summary"]["paid_paise"] == b["summary"]["paid_paise"]
    assert all(r["type"] in ("DEMAND", "PAYMENT", "REVERSAL", "AGREEMENT_CHANGE", "CANCELLATION") for r in l["cash"]["rows"])
    cl = requests.get(f"{BASE}/customers/{b['customer_id']}/ledgers", headers=h, timeout=15).json()
    assert any(x["booking_id"] == b["id"] for x in cl["bookings"]) and cl["totals"]["combined"]["paid_paise"] >= b["summary"]["paid_paise"]


def test_bootstrap_include_cursor_snapshot():
    h = H()
    r = requests.get(f"{BASE}/bootstrap", headers=h, timeout=15)
    assert r.status_code == 200 and r.headers.get("ETag") and "Server-Timing" in r.headers and r.headers.get("X-Request-ID")
    d = r.json()
    assert set(d) >= {"me", "permissions", "role", "project_scope", "company", "settings_public", "catalogues_version", "counts"}
    assert requests.get(f"{BASE}/bootstrap", headers={**h, "If-None-Match": r.headers["ETag"]}, timeout=15).status_code == 304
    r = requests.get(f"{BASE}/bookings?page_size=3&include=customer,flat,block,project", headers=h, timeout=15).json()
    assert r["items"][0]["customer"]["full_name"] and r["items"][0]["flat"]["flat_number"] and r["items"][0]["project"]["name"]
    r = requests.get(f"{BASE}/bookings?limit=2", headers=h, timeout=15).json()
    assert r["total"] is None and r["next_cursor"]
    r2 = requests.get(f"{BASE}/bookings?limit=2&cursor={r['next_cursor']}&with_total=true", headers=h, timeout=15).json()
    assert r2["total"] is not None and r2["items"][0]["id"] != r["items"][0]["id"]
    r = requests.get(f"{BASE}/customers?page_size=2&include=summary,bookings&fields=full_name,customer_code", headers=h, timeout=15).json()
    assert "phone" not in r["items"][0] and "bookings" in r["items"][0]
    s = requests.get(f"{BASE}/dashboard/snapshot", headers=h, timeout=15)
    assert s.status_code == 200 and "X-Data-Age" in s.headers and s.json()["totals"]["units"] > 0
    r = requests.get(f"{BASE}/search?q=BK-&scope=bookings", headers=h, timeout=15).json()
    assert r["groups"] and r["groups"][0]["type"] == "bookings" and r["took_ms"] < 50
    r = requests.post(f"{BASE}/admin/recompute-read-models", headers=H(), timeout=60)
    assert r.status_code == 200 and r.json()["projects"] >= 1
