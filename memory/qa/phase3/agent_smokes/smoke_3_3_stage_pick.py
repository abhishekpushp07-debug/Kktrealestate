# 3-3 iteration 43: read-only — for each non-Ye tower, preview the next pending stage and print how many bills it would raise.
import requests
BASE = "https://kkt-builder-ledger--9g1vkntz.preview.emergentagent.com/api"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}); s.headers["Authorization"] = f"Bearer {r.json().get('access_token')}"
projs = s.get(f"{BASE}/projects").json(); projs = projs.get("items", projs)
for p in projs:
    if p.get("name","").strip().lower() == "ye": continue
    bl = s.get(f"{BASE}/blocks", params={"project_id": p["id"]}).json(); bl = bl.get("items", bl) if isinstance(bl, dict) else bl
    for b in bl:
        c = s.get(f"{BASE}/blocks/{b['id']}/construction")
        if not c.ok: continue
        st = [x for x in c.json().get("stages", []) if x.get("status") != "Completed"]
        if not st: continue
        nx = min(st, key=lambda x: x["seq"])
        pv = s.get(f"{BASE}/blocks/{b['id']}/stages/{nx['stage_id']}/preview").json()
        keys = {k: pv.get(k) for k in pv if isinstance(pv.get(k), (int, float, str)) and k not in ("stage_id",)}
        print(p["name"], "|", b.get("name"), b["id"], "| next", nx.get("seq"), nx.get("name"), "|", keys)
