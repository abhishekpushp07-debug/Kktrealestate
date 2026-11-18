import requests,json
B="https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
t=requests.post(B+"/auth/login",json={"email":"admin@kkt.in","password":"Kkt@12345"}).json()["access_token"]
H={"Authorization":"Bearer "+t}
bid="43dec1db-392b-434b-adc9-a881860cad51"
for x in requests.get(B+f"/journey/entity/booking/{bid}",headers=H).json()["items"]:
    print(x["action"],x["id"][:8],x["created_at"],x.get("actor_name"),json.dumps(x.get("after"))[:120])
b=requests.get(B+f"/bookings/{bid}",headers=H).json(); print(b["status"],b["booking_number"],b["flat_id"])
