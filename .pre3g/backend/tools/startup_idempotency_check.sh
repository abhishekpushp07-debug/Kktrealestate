#!/bin/bash
# Run backend startup twice against a copy of kkt_test; print collection counts + PS field sums after each run.
cd /app/backend; set -a; . ./.env; set +a
SCR=kkt_idem_scratch
python3 - <<'PY'
import os
from pymongo import MongoClient
c=MongoClient(os.environ["MONGO_URL"]); src=c["kkt_test"]; c.drop_database("kkt_idem_scratch"); dst=c["kkt_idem_scratch"]
for name in src.list_collection_names():
    docs=list(src[name].find({}))
    if docs: dst[name].insert_many(docs)
dst.locks.delete_many({})
PY
snap() {
python3 - <<'PY'
import os, json, hashlib
from pymongo import MongoClient
db=MongoClient(os.environ["MONGO_URL"])["kkt_idem_scratch"]
out={n: db[n].count_documents({}) for n in sorted(db.list_collection_names()) if n not in ("locks","audit_logs","backup_runs","rate_limits","cache")}
fl=list(db.flats.find({}, {"_id":0,"id":1,"saleable_sqft":1,"super_builtup_sqft":1,"price_paise":1,"pricing_status":1,"pricing_mode":1}))
out["_flats_saleable_sum"]=sum(f.get("saleable_sqft") or 0 for f in fl); out["_flats_price_sum"]=sum(f.get("price_paise") or 0 for f in fl)
out["_flats_pricing_status"]=str(sorted(__import__("collections").Counter(f.get("pricing_status") for f in fl).items()))
bk=list(db.bookings.find({}, {"_id":0,"id":1,"pricing":1,"other_charges":1}))
out["_bk_with_pricing"]=sum(1 for b in bk if b.get("pricing")); out["_bk_total_final_sum"]=sum((b.get("pricing") or {}).get("total_final_value_paise",0) for b in bk)
out["_bk_lines"]=sum(len(b.get("other_charges") or []) for b in bk); out["_bk_demanded_sum"]=sum(l.get("demanded_paise",0) for b in bk for l in (b.get("other_charges") or []))
out["_ledger_sum"]=sum(l.get("udhar_paise",0)-l.get("jama_paise",0) for l in db.ledger_entries.find({}, {"_id":0,"udhar_paise":1,"jama_paise":1}))
out["_charge_types_active"]=db.charge_types.count_documents({"is_active":True})
out["_area_types"]=str(sorted((a.get("code"),a.get("name"),a.get("hidden")) for a in db.area_types.find({}, {"_id":0,"code":1,"name":1,"hidden":1})))
print(json.dumps(out, sort_keys=True))
PY
}
snap > /tmp/idem_0.json
for i in 1 2; do
  pkill -f "port 8032"; sleep 1
  python3 -c "import os;from pymongo import MongoClient;MongoClient(os.environ['MONGO_URL'])['kkt_idem_scratch'].locks.delete_many({})"
  DB_NAME=$SCR KKT_ROLE=test BACKUP_ENABLED=0 setsid nohup /root/.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8032 --log-level warning > /tmp/idem_be_$i.log 2>&1 &
  for t in $(seq 1 40); do sleep 2; curl -s http://127.0.0.1:8032/api/health | grep -q '"done":true' && break; done
  curl -s http://127.0.0.1:8032/api/health | python3 -c "import sys,json;d=json.load(sys.stdin);print('run',$i,'startup',d['startup']['phase'])"
  pkill -f "port 8032"; sleep 1
  snap > /tmp/idem_$i.json
done
python3 - <<'PY'
import json
a,b,c=[json.load(open(f"/tmp/idem_{i}.json")) for i in (0,1,2)]
print("baseline→run1 changes:"); [print(" ",k,a.get(k),"→",b.get(k)) for k in sorted(set(a)|set(b)) if a.get(k)!=b.get(k)] or print("  none")
print("run1→run2 changes:"); [print(" ",k,b.get(k),"→",c.get(k)) for k in sorted(set(b)|set(c)) if b.get(k)!=c.get(k)] or print("  none")
print("collections baseline→run2 count drops:", [(k,a[k],c[k]) for k in a if not k.startswith("_") and isinstance(a[k],int) and c.get(k,0)<a[k]])
PY
grep -iE "traceback|error" /tmp/idem_be_1.log /tmp/idem_be_2.log | grep -v bcrypt | head -5
