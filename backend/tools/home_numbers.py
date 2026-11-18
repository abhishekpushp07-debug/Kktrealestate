"""Home-bundle helpers shared by tools/tieout.py and tests/test_home_bundle.py (no test-suite import side effects)."""

import re


def pick(doc, path):
    for part in path.split("."):
        m = re.fullmatch(r"(\w+)\[(\w+)=(.+)\]", part)
        if m:
            doc = next((r for r in doc[m.group(1)] if str(r[m.group(2)]) == m.group(3)), {})
        else:
            doc = doc.get(part, 0) if isinstance(doc, dict) else 0
    return doc or 0


def numbers(node, out):
    """Every {count|paise, drill{api}} leaf in a widget payload."""
    if isinstance(node, dict):
        if isinstance(node.get("drill"), dict) and node["drill"].get("api"):
            out.append(node)
        for v in node.values():
            numbers(v, out)
    elif isinstance(node, list):
        for v in node:
            numbers(v, out)
    return out
