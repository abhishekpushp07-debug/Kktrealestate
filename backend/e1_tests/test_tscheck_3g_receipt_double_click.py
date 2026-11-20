import datetime, uuid, httpx
from conftest import login, qa_booking, parallel, CASH_MODE, ledger_len, summary, BASE

def test_double_click_same_key_one_receipt():
    c = login("admin@kkt.in")
    _, bk = qa_booking(c, "tscheck-3g-dbl", discount=0)
    bid = bk["id"]; tok = c.headers["Authorization"]
    for i in range(5):
        l0, s0 = ledger_len(c, bid), summary(c, bid)
        key = f"tscheck-3g-dbl-{uuid.uuid4().hex}"
        body = {"booking_id":bid,"payment_category":"Cash","against":"FLAT_VALUE","amount":1000,
                "payment_date":datetime.date.today().isoformat(),"payment_mode_id":CASH_MODE,"remarks":"tscheck-3g-dbl"}
        post = lambda: httpx.post(f"{BASE}/payments", json=body, headers={"Authorization":tok,"Idempotency-Key":key}, timeout=60)
        a, b = parallel(post, post)
        assert a.status_code < 300 and b.status_code < 300, (a.status_code, a.text[:200], b.status_code, b.text[:200])
        ja, jb = a.json(), b.json()
        assert ja["id"] == jb["id"], (ja.get("id"), jb.get("id"))
        assert ja.get("receipt_number") == jb.get("receipt_number")
        pays = c.get("/payments", params={"booking_id":bid,"page_size":200}).json()["items"]
        assert len([p for p in pays if p["id"]==ja["id"]]) == 1
        assert ledger_len(c, bid) == l0 + 1, f"rep {i}: ledger lines moved by {ledger_len(c,bid)-l0}"
        s1 = summary(c, bid)
        assert s1["total_jama_paise"] - s0["total_jama_paise"] == 100000
