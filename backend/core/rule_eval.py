"""Leaf: safe evaluator for alert-rule conditions (ops/alerts.yaml). Replaces dynamic evaluation.

Grammar (whitelist, checked once at load via compile_rule): BoolOp and/or · not · Compare (== != < <= > >= is / is not / in / not in)
· arithmetic + - * / % · unary - · Constant · Name `snap` · snap['key'] subscripts with constant keys · snap.key attribute
· calls to len/abs/min/max only. Anything else (other names, calls, lambdas, comprehensions, f-strings, attribute access on
non-snap values, dunder) raises RuleSyntaxError at compile time.
CR-2: table-driven — one checker and one evaluator per node type (`_CHECKERS` / `_EVALUATORS`)."""
import ast
import operator

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: operator.mod}
_CMP = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
        ast.Is: operator.is_, ast.IsNot: operator.is_not, ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b}
_FUNCS = {"len": len, "abs": abs, "min": min, "max": max}
_ROOT = "snap"
_CONST_TYPES = (int, float, str, bool, type(None))


class RuleSyntaxError(ValueError):
    pass


# ---- whitelist check (compile time) --------------------------------------------------------------
def _bad(node):
    raise RuleSyntaxError(f"disallowed expression element: {type(node).__name__}")


def _chk_boolop(n):
    if not isinstance(n.op, (ast.And, ast.Or)):
        _bad(n)
    for v in n.values:
        _check(v)


def _chk_unary(n):
    if not isinstance(n.op, (ast.Not, ast.USub)):
        _bad(n)
    _check(n.operand)


def _chk_binop(n):
    if type(n.op) not in _BIN:
        _bad(n)
    _check(n.left)
    _check(n.right)


def _chk_compare(n):
    if not all(type(o) in _CMP for o in n.ops):
        _bad(n)
    _check(n.left)
    for c in n.comparators:
        _check(c)


def _chk_constant(n):
    if not isinstance(n.value, _CONST_TYPES):
        _bad(n)


def _chk_name(n):
    if n.id != _ROOT:
        _bad(n)


def _chk_subscript(n):
    if not (isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, (str, int))):
        _bad(n)
    _check(n.value)


def _chk_attribute(n):
    if n.attr.startswith("_"):
        _bad(n)
    _check(n.value)


def _chk_call(n):
    if not (isinstance(n.func, ast.Name) and n.func.id in _FUNCS and not n.keywords):
        _bad(n)
    for a in n.args:
        _check(a)


_CHECKERS = {ast.BoolOp: _chk_boolop, ast.UnaryOp: _chk_unary, ast.BinOp: _chk_binop, ast.Compare: _chk_compare, ast.Constant: _chk_constant,
             ast.Name: _chk_name, ast.Subscript: _chk_subscript, ast.Attribute: _chk_attribute, ast.Call: _chk_call}


def _check(node: ast.AST) -> None:
    handler = _CHECKERS.get(type(node))
    if handler is None:
        _bad(node)
    handler(node)


# ---- evaluation (run time) ------------------------------------------------------------------------
def _ev_boolop(n, snap):
    is_and = isinstance(n.op, ast.And)
    res = is_and
    for v in n.values:
        res = _ev(v, snap)
        if bool(res) != is_and:  # and: stop on first falsy · or: stop on first truthy
            return res
    return res


def _ev_unary(n, snap):
    v = _ev(n.operand, snap)
    return (not v) if isinstance(n.op, ast.Not) else -v


def _ev_compare(n, snap):
    left = _ev(n.left, snap)
    for op, comp in zip(n.ops, n.comparators):
        right = _ev(comp, snap)
        if not _CMP[type(op)](left, right):
            return False
        left = right
    return True


def _ev_attribute(n, snap):
    base = _ev(n.value, snap)
    return base[n.attr] if isinstance(base, dict) else getattr(base, n.attr)


_EVALUATORS = {
    ast.BoolOp: _ev_boolop,
    ast.UnaryOp: _ev_unary,
    ast.BinOp: lambda n, s: _BIN[type(n.op)](_ev(n.left, s), _ev(n.right, s)),
    ast.Compare: _ev_compare,
    ast.Constant: lambda n, s: n.value,
    ast.Name: lambda n, s: s,
    ast.Subscript: lambda n, s: _ev(n.value, s)[n.slice.value],
    ast.Attribute: _ev_attribute,
    ast.Call: lambda n, s: _FUNCS[n.func.id](*[_ev(a, s) for a in n.args]),
}


def _ev(node: ast.AST, snap: dict):
    handler = _EVALUATORS.get(type(node))
    if handler is None:
        raise RuleSyntaxError(type(node).__name__)  # unreachable after _check
    return handler(node, snap)


def compile_rule(expr: str):
    """Parse + whitelist-check once; returns a callable(snap) -> value."""
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise RuleSyntaxError(str(e)) from e
    _check(tree.body)
    body = tree.body
    return lambda snap: _ev(body, snap)
