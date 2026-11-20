"""3I parity: every test id run (with its outcome) in the standalone chunks vs the replica-set chunks."""
import glob
import re
import sys

Q = "/app/memory/qa/phase3i"
R = {}
for m in ("sa", "rs"):
    d = {}
    for f in sorted(glob.glob(f"{Q}/chunks_{m}/c*.log")):
        for st, i in re.findall(r"\] (PASSED|SKIPPED|FAILED|ERROR) (tests/\S.*?)\s*$", open(f).read(), re.M):
            d[i] = st
    R[m] = d
a, b = R["sa"], R["rs"]
out = [f"standalone ids: {len(a)} ({sum(v == 'PASSED' for v in a.values())} passed, {sum(v == 'SKIPPED' for v in a.values())} skipped, "
       f"{sum(v in ('FAILED', 'ERROR') for v in a.values())} failed)",
       f"replica-set ids: {len(b)} ({sum(v == 'PASSED' for v in b.values())} passed, {sum(v == 'SKIPPED' for v in b.values())} skipped, "
       f"{sum(v in ('FAILED', 'ERROR') for v in b.values())} failed)"]
out += ["only standalone: " + i for i in sorted(set(a) - set(b))]
out += ["only replica set: " + i for i in sorted(set(b) - set(a))]
out += [f"outcome differs: {i}: standalone={a[i]} replica-set={b[i]}" for i in sorted(set(a) & set(b)) if a[i] != b[i]]
out += [f"failed ({m}): {i}" for m, d in R.items() for i, v in sorted(d.items()) if v in ("FAILED", "ERROR")]
open(sys.argv[1] if len(sys.argv) > 1 else f"{Q}/parity_final.txt", "w").write("\n".join(out) + "\n")
print("\n".join(out))
