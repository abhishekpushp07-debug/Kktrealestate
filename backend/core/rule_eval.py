"""Leaf: safe evaluator for alert-rule conditions (ops/alerts.yaml). Replaces dynamic evaluation.

Grammar (whitelist, checked once at load via compile_rule): BoolOp and/or · not · Compare (== != < <= > >= is / is not / in / not in)
· arithmetic + - * / % · unary - · Constant · Name `snap` · snap['key'] subscripts with constant keys · snap.key attribute
· calls to len/abs/min/max only. Anything else (other names, calls, lambdas, comprehensions, f-strings, attribute access on
non-snap values, dunder) raises RuleSyntaxError at compile time."""
import ast
import operator

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: operator.mod}
_CMP = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
        ast.Is: operator.is_, ast.IsNot: operator.is_not, ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b}
_FUNCS = {"len": len, "abs": abs, "min": min, "max": max}
_ROOT = "snap"


class RuleSyntaxError(ValueError):
    pass


def _check(node: ast.AST) -> None:
    if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
        for v in node.values:
            _check(v)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.Not, ast.USub)):
        _check(node.operand)
    elif isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        _check(node.left)
        _check(node.right)
    elif isinstance(node, ast.Compare) and all(type(o) in _CMP for o in node.ops):
        _check(node.left)
        for c in node.comparators:
            _check(c)
    elif isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str, bool, type(None))) or isinstance(node, ast.Name) and node.id == _ROOT:
        pass
    elif isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, (str, int)) or isinstance(node, ast.Attribute) and not node.attr.startswith("_"):
        _check(node.value)
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        for a in node.args:
            _check(a)
    else:
        raise RuleSyntaxError(f"disallowed expression element: {type(node).__name__}")


def _ev(node: ast.AST, snap: dict):
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            res = True
            for v in node.values:
                res = _ev(v, snap)
                if not res:
                    return res
            return res
        res = False
        for v in node.values:
            res = _ev(v, snap)
            if res:
                return res
        return res
    if isinstance(node, ast.UnaryOp):
        v = _ev(node.operand, snap)
        return (not v) if isinstance(node.op, ast.Not) else -v
    if isinstance(node, ast.BinOp):
        return _BIN[type(node.op)](_ev(node.left, snap), _ev(node.right, snap))
    if isinstance(node, ast.Compare):
        left = _ev(node.left, snap)
        for op, comp in zip(node.ops, node.comparators):
            right = _ev(comp, snap)
            if not _CMP[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return snap
    if isinstance(node, ast.Subscript):
        return _ev(node.value, snap)[node.slice.value]
    if isinstance(node, ast.Attribute):
        base = _ev(node.value, snap)
        return base[node.attr] if isinstance(base, dict) else getattr(base, node.attr)
    if isinstance(node, ast.Call):
        return _FUNCS[node.func.id](*[_ev(a, snap) for a in node.args])
    raise RuleSyntaxError(type(node).__name__)  # unreachable after _check


def compile_rule(expr: str):
    """Parse + whitelist-check once; returns a callable(snap) -> value."""
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise RuleSyntaxError(str(e)) from e
    _check(tree.body)
    body = tree.body
    return lambda snap: _ev(body, snap)
