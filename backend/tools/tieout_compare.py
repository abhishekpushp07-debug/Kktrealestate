"""Compare two tieout markdown outputs: same tie-out name → same report/raw figures (3G JRN-134 "figures identical").
Usage: python tools/tieout_compare.py BEFORE.md AFTER.md"""

import re
import sys


def rows(path):
    out = {}
    for line in open(path):
        m = re.match(r"\| (.+?) \| `(.*?)` \| `(.*?)` \| \*\*(\w+)\*\*", line)
        if m:
            out.setdefault(m.group(1), []).append((m.group(2), m.group(3), m.group(4)))
    return out


if __name__ == "__main__":
    a, b = rows(sys.argv[1]), rows(sys.argv[2])
    common = sorted(set(a) & set(b))
    diff = [k for k in common if a[k] != b[k]]
    fails = sum(1 for v in b.values() for x in v if x[2] != "PASS")
    print(f"before {sum(map(len, a.values()))} · after {sum(map(len, b.values()))} rows · after FAIL {fails}")
    print(
        f"common names {len(common)} · figures differ {len(diff)} · only before {len(set(a) - set(b))} · only after {len(set(b) - set(a))}"
    )
    for k in diff:
        print(f"  DIFF {k}: {a[k]} → {b[k]}")
    for k in sorted(set(b) - set(a)):
        print(f"  NEW  {k}: {b[k]}")
    for k in sorted(set(a) - set(b)):
        print(f"  GONE {k}: {a[k]}")
