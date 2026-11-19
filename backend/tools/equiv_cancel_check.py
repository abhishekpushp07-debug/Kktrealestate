"""3I: the declared Cancellations difference is the flat label only — every money / count column must be identical.
Usage: python tools/equiv_cancel_check.py old.json new.json"""

import json
import sys

LABEL = {"unit", "flat", "flat_label", "location"}


def main(a: str, b: str):
    A, B = json.load(open(a)), json.load(open(b))
    keys = [k for k in A if k.startswith("cancellations?")]
    req = money_diff = label_diff = 0
    fields: set = set()
    for k in keys:
        ra, rb = (A[k][1] or {}).get("rows") or [], (B.get(k, [0, {}])[1] or {}).get("rows") or []
        req += 1
        if len(ra) != len(rb):
            money_diff += 1
            print("ROWCOUNT", k, len(ra), len(rb))
            continue
        ia = {r.get("booking_id") or r.get("id") or i: r for i, r in enumerate(ra)}
        ib = {r.get("booking_id") or r.get("id") or i: r for i, r in enumerate(rb)}
        for rid, x in ia.items():
            y = ib.get(rid) or {}
            for f in set(x) | set(y):
                if x.get(f) == y.get(f):
                    continue
                fields.add(f)
                if f in LABEL or not isinstance(x.get(f), int | float):
                    label_diff += 1
                else:
                    money_diff += 1
                    print("MONEY", k, rid, f, x.get(f), y.get(f))
        for f in ("totals", "groups"):
            if (A[k][1] or {}).get(f) != (B[k][1] or {}).get(f):
                money_diff += 1
                print("TOTALS", k, f)
    print(
        f"cancellations requests {req} · label cells changed {label_diff} · fields {sorted(fields)} · money/count differences {money_diff}"
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
