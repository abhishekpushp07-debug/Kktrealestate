import requests,json
B="https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
t=requests.post(B+"/auth/login",json={"email":"admin@kkt.in","password":"Kkt@12345"}).json()["access_token"]
H={"Authorization":"Bearer "+t}
r=requests.get(B+"/dashboard/home",headers=H); print(r.status_code, json.dumps(r.json().get("totals"))[:800]); print(list(r.json().keys()))
print([ (m["code"],m["id"]) for m in requests.get(B+"/master/payment-modes",headers=H).json()["items"]])
print(requests.get(B+"/master/hold-reasons",headers=H).json()["items"][:2])
r=requests.get(B+"/docgen/register",headers=H,params={"page_size":2}); print(r.status_code, json.dumps(r.json())[:700])
