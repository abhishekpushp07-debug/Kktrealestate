"""Phase X.1 — English ledger terminology guard: 'Udhar'/'Jama' never reappear in user-facing strings (frontend src, backend
string literals in routers/services). 'Roznamcha' is retained on purpose. Also checks the shared two-sided helper's sign/status
convention and that present_money exposes the English aliases."""
import ast
import os
import re

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORD = re.compile(r"\b(udhar|jama)\b", re.I)


def test_frontend_has_no_udhar_jama():
    hits = []
    for dp, dn, fn in os.walk(os.path.join(ROOT, "frontend", "src")):
        for f in fn:
            if f.endswith((".js", ".jsx", ".css")):
                p = os.path.join(dp, f)
                with open(p) as fh:
                    for i, line in enumerate(fh, 1):
                        if WORD.search(line):
                            hits.append(f"{os.path.relpath(p, ROOT)}:{i}")
    assert hits == [], hits


def test_backend_user_facing_strings_have_no_udhar_jama():
    hits = []
    for sub in ("routers", "services"):
        for dp, dn, fn in os.walk(os.path.join(ROOT, "backend", sub)):
            for f in fn:
                if not f.endswith(".py"):
                    continue
                p = os.path.join(dp, f)
                with open(p) as fh:
                    tree = ast.parse(fh.read())
                docs = {id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
                for node in ast.walk(tree):
                    if id(node) in docs:
                        continue  # docstrings may explain the legacy field names; labels may not
                    if isinstance(node, ast.Constant) and isinstance(node.value, str) and WORD.search(node.value) and node.value not in ("udhar", "jama"):
                        hits.append(f"{os.path.relpath(p, ROOT)}:{node.lineno}: {node.value[:60]!r}")
    # docstrings explaining the legacy field names are allowed; labels are not
    hits = [h for h in hits if "legacy" not in h.lower() and "udhar side" not in h.lower() and "jama side" not in h.lower()]
    assert hits == [], hits


def test_roznamcha_is_retained():
    with open(os.path.join(ROOT, "frontend", "src", "pages", "Roznamcha.jsx")) as fh:
        assert "Roznamcha" in fh.read()


@pytest.mark.parametrize("billed,received,status,bal", [(100, 40, "due", -60), (40, 100, "advance", 60), (50, 50, "settled", 0)])
def test_two_sided_sign_convention(billed, received, status, bal):
    import sys
    sys.path.insert(0, os.path.join(ROOT, "backend"))
    from services.definitions import two_sided
    from services.money import present_money
    t = two_sided(billed, received)
    assert t["balance_signed_paise"] == bal and t["balance_status"] == status
    out = present_money({"total_udhar_paise": billed, "total_jama_paise": received, "udhar_cash_paise": 1})
    assert out["total_bill_raised_paise"] == billed and out["total_received_paise"] == received and out["bill_raised_cash_paise"] == 1
    assert out["balance_signed_paise"] == bal and out["balance_status"] == status and out["balance_signed"] == bal / 100
