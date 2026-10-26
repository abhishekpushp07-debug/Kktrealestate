"""Phase K.14: OpenAPI snapshot. The committed snapshot (backend/docs/openapi/v1.json) must match the live schema; breaking diffs fail loudly.
Regenerate (after an intentional change):  cd /app/backend && python -m tools.openapi_snapshot --write
Check:                                      cd /app/backend && python -m tools.openapi_snapshot"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "openapi", "v1.json")


def current() -> dict:
    os.environ.setdefault("KKT_SKIP_STARTUP", "1")
    from server import app
    spec = app.openapi()
    spec.pop("servers", None)
    return spec


def _types(schema: dict, prefix="") -> dict:
    """Flatten component schemas → {Name.field: type}."""
    out = {}
    for name, s in (schema.get("components", {}).get("schemas") or {}).items():
        for f, p in (s.get("properties") or {}).items():
            out[f"{name}.{f}"] = json.dumps(p.get("type") or p.get("$ref") or p.get("anyOf"), sort_keys=True)
    return out


def breaking_diff(old: dict, new: dict) -> list[str]:
    """Removed path/operation, removed response field or changed field type = breaking. Additions are fine."""
    issues = []
    for path, ops in old["paths"].items():
        if path not in new["paths"]:
            issues.append(f"removed path {path}")
            continue
        for m in ops:
            if m not in new["paths"][path]:
                issues.append(f"removed operation {m.upper()} {path}")
    ot, nt = _types(old), _types(new)
    for k, t in ot.items():
        if k not in nt:
            issues.append(f"removed field {k}")
        elif nt[k] != t:
            issues.append(f"type change {k}: {t} → {nt[k]}")
    return issues


def stale(old: dict, new: dict) -> bool:
    return json.dumps(old, sort_keys=True) != json.dumps(new, sort_keys=True)


if __name__ == "__main__":
    spec = current()
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(PATH), exist_ok=True)
        json.dump(spec, open(PATH, "w"), indent=1, sort_keys=True)
        print(f"wrote {PATH} ({len(spec['paths'])} paths)")
    else:
        old = json.load(open(PATH))
        issues = breaking_diff(old, spec)
        print("BREAKING:" if issues else "no breaking diff", *issues, sep="\n  ")
        print("snapshot stale — run: python -m tools.openapi_snapshot --write" if stale(old, spec) else "snapshot current")
        sys.exit(1 if issues or stale(old, spec) else 0)
