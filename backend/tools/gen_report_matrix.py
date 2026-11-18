"""Write security/report_access_matrix.json: for every Phase 3F report, the permissions that open it and the one that exports it."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from reports_v3.registry import REGISTRY  # noqa: E402

out = {
    k: {"view": [s["permission"], *s.get("permission_any", [])], "export": s["export_permission"]}
    for k, s in sorted(REGISTRY.items())
}
path = os.path.join(os.path.dirname(__file__), "..", "security", "report_access_matrix.json")
json.dump(out, open(path, "w"), indent=1, sort_keys=True)
print(f"{len(out)} reports → {path}")
