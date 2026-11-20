import requests
B="https://flat-ledger-11--18pq6xp9.preview.emergentagent.com/api"
t=requests.post(B+"/auth/login",json={"email":"admin@kkt.in","password":"Kkt@12345"}).json()["access_token"]
H={"Authorization":"Bearer "+t}
r=requests.get(B+"/bookings",headers=H,params={"q":"Amit Kumar Sinha","page_size":5}).json()
for b in r["items"]: print(b["id"],b["booking_number"],b["status"])
