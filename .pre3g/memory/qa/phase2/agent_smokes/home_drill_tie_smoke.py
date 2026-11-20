# Phase 2D drill tie spot-check: each widget number's drill.api returns the same total (public URL)
import json, requests, sys
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/") + "/api"
tok = json.load(open("/tmp/tokens.json"))[sys.argv[1] if len(sys.argv) > 1 else "admin@kkt.in"]
H = {"Authorization": f"Bearer {tok}"}
pid = sys.argv[2] if len(sys.argv) > 2 else None
d = requests.get(f"{BASE}/home/bundle?period=month" + (f"&project_id={pid}" if pid else ""), headers=H).json()["widgets"]


def walk(o, path=""):
    if isinstance(o, dict):
        if "drill" in o and isinstance(o["drill"], dict) and o["drill"].get("api"):
            yield path, o
        for k, v in o.items():
            if k != "drill":
                yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o[:3]):
            yield from walk(v, f"{path}[{i}]")


def pick(j, p):
    import re
    for k in re.split(r"\.(?![^\[]*\])", p):
        m = re.match(r"(\w+)\[(\w+)=(.*)\]$", k)
        if m and isinstance(j, dict):
            j = next((x for x in j.get(m[1], []) if str(x.get(m[2])) == m[3]), None)
            continue
        j = j.get(k) if isinstance(j, dict) else None
        if j is None:
            return None
    return j


ok = bad = 0
for path, n in walk(d):
    url, params = n["drill"]["api"]
    params = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items()}
    r = requests.get(f"{BASE}{url}", headers=H, params=params)
    if r.status_code != 200:
        print("HTTP", r.status_code, path, url, params, r.text[:150]); bad += 1; continue
    got = pick(r.json(), n["drill"]["pick"])
    want = n.get("amount_paise") if n["drill"]["pick"].endswith("paise") else n.get("count")
    if got != want:
        print("MISMATCH", path, url, params, n["drill"]["pick"], "widget=", want, "list=", got); bad += 1
    else:
        ok += 1
print(f"ties ok={ok} bad={bad}")
