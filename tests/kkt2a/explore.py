import os,requests,json
B="https://flat-ledger-11--18pq6xp9.preview.emergentagent.com/api"
t=requests.post(B+"/auth/login",json={"email":"admin@kkt.in","password":"Kkt@12345"}).json()["access_token"]
H={"Authorization":"Bearer "+t}
ps=requests.get(B+"/projects",headers=H).json()["items"]
print([(p["code"],p["id"],p.get("name")) for p in ps])
r=requests.get(B+"/flats",headers=H,params={"status":"Available","page_size":200})
print(r.status_code)
d=r.json(); it=d.get("items",d)
print(len(it)); 
for f in it[:60]: print({k:f.get(k) for k in ("id","flat_number","status","block_name","block_code","project_code","price","total_price","price_paise","base_price_paise")})
print(list(it[0].keys()))
