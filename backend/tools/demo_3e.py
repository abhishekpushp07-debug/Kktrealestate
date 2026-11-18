"""Phase 3E REQ-257: discounts + waivers on the demo through the real API (idempotent; never touches project Ye or QA rows).
Two discounted bookings (one at booking, one on revision) and every waiver state: approved Account share, approved
charge line, owner self-approved then cancelled, pending, rejected."""

import os
import sys
import uuid

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools._env import DEMO_PASSWORD  # noqa: E402

BASE = os.environ.get("STORY_BASE_URL", "http://localhost:8001") + "/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
TAG = "Demo:"


class S:
    def __init__(self, email):
        r = requests.post(
            f"{BASE}/auth/login", json={"email": email, "password": DEMO_PASSWORD}, headers=BYPASS, timeout=30
        )
        r.raise_for_status()
        self.h = {**BYPASS, "Authorization": f"Bearer {r.json()['access_token']}"}

    def call(self, m, path, body=None, **params):
        r = requests.request(
            m,
            BASE + path,
            json=body,
            params=params or None,
            timeout=120,
            headers={**self.h, "Idempotency-Key": str(uuid.uuid4())},
        )
        if r.status_code >= 300:
            raise RuntimeError(f"{m} {path} → {r.status_code} {r.text[:300]}")
        return r.json()

    def get(self, path, **p):
        return self.call("GET", path, **p)

    def post(self, path, body=None):
        return self.call("POST", path, body or {})


def book(adm, flat, name, phone, agreed, reason=None):
    found = adm.get("/customers", search=phone[-10:], page_size=5)["items"]
    cust = found[0] if found else adm.post("/customers", {"full_name": name, "phone": phone})
    cash = round(agreed * 0.2, 2)
    body = {
        "flat_id": flat["id"],
        "customer_id": cust["id"],
        "booking_date": adm.today,
        "agreement_value": agreed,
        "cash_agreed": cash,
        "account_agreed": round(agreed - cash, 2),
        "remarks": "demo 3E",
        **({"discount_reason": reason} if reason else {}),
    }
    return adm.post("/bookings", body)


def main():
    adm, acc = S("admin@kkt.in"), S("accounts@kkt.in")
    from tools.connection_matrix import _today

    adm.today = _today(adm)
    if any(w["reason"].startswith(TAG) for w in adm.get("/waivers")["items"]):
        print("demo_3e: already seeded")
        return
    sgh = next(p for p in adm.get("/projects")["items"] if p.get("code") == "SGH")
    flats = [
        f for f in adm.get("/flats", project_id=sgh["id"], status="Available", page_size=50)["items"] if f.get("price")
    ]
    f1, f2 = flats[0], flats[1]
    b1 = book(adm, f1, "Rohit Agarwal", "+919835011221", round(f1["price"] - 150000, 2), f"{TAG[:-1]} festival offer")
    b2 = book(adm, f2, "Meera Joshi", "+919835011222", f2["price"])
    cur = adm.get(f"/bookings/{b2['id']}")
    new_total = round(f2["price"] - 100000, 2)
    adm.post(
        f"/bookings/{b2['id']}/agreement-revisions",
        {
            "cash_agreed": round(new_total * 0.2, 2),
            "account_agreed": round(new_total - round(new_total * 0.2, 2), 2),
            "reason": "Demo corner-unit adjustment",
            "version": cur.get("version"),
        },
    )

    def req(s, bid, target, amt, reason):
        return s.post("/waivers", {"booking_id": bid, "target": target, "amount": amt, "reason": f"{TAG} {reason}"})

    acct, cash = {"kind": "share", "share": "Account"}, {"kind": "share", "share": "Cash"}
    out = []
    w = req(acc, b1["id"], acct, 25000, "possession delay goodwill")
    out.append(adm.post(f"/waivers/{w['id']}/approve"))
    out.append(req(acc, b1["id"], cash, 10000, "rounding off cash share"))  # stays Pending
    w = req(acc, b2["id"], acct, 5000, "late-fee relief asked")
    out.append(adm.post(f"/waivers/{w['id']}/reject", {"reason": "Payment was not late — no relief due"}))
    oc_b = next(
        b
        for b in adm.get("/bookings", status="Active", page_size=200)["items"]
        if b.get("project_id") == sgh["id"]
        and (b.get("summary") or {}).get("other_charges_due_paise", 0) >= 1000000
        and not (b.get("customer_name") or "").startswith("QA ")
    )
    d = adm.get(f"/bookings/{oc_b['id']}")
    line = next(x for x in d["other_charges"] if (x.get("demanded_paise") or 0) > (x.get("paid_paise") or 0))
    w = req(acc, oc_b["id"], {"kind": "line", "line_id": line["line_id"]}, 5000, f"{line['name']} part waived")
    out.append(adm.post(f"/waivers/{w['id']}/approve"))
    w = req(adm, oc_b["id"], {"kind": "line", "line_id": line["line_id"]}, 2000, "owner goodwill (cancelled later)")
    out.append(adm.post(f"/waivers/{w['id']}/cancel", {"reason": "Raised on the wrong charge"}))
    for x in out:
        print(x["waiver_number"], x["status"], x.get("cn_number") or "", x["booking_number"], x["amount_paise"] / 100)


if __name__ == "__main__":
    main()
