import uuid
BANK="28b04683-c008-41d1-960e-1702c9aa107c"; CHEQUE="3a78eb1c-9a36-465a-9533-87c447bed465"; NEFT="f8f3f9ce-37f7-4b48-9803-1025f0c25ee8"
TODAY="2026-11-19"
def v3(api,key,**p):
    p.setdefault("page_size",500); r=api.get(f"/reports/v3/{key}",params=p); assert r.status_code==200,(key,r.status_code,r.text[:300]); return r.json()
def row(d,bid): return next((r for r in d["rows"] if r.get("booking_id")==bid),None)
def sfx(): return uuid.uuid4().hex[:6]
