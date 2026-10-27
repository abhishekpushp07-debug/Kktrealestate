"""Import hygiene (Phase CR-1): no import cycles at module level, leaf layers never import upward, every module imports in isolation.

Static: Tarjan SCC over module-level imports of every backend module (excluding tests/) → zero cycles. Layering: core/*, events,
services.read_models never import routers/infra/deps/utils (even lazily). Dynamic: each module is imported in a fresh interpreter
(parallel subprocesses) so hidden order-dependence between modules is caught."""
import ast
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP_DIRS = {"tests", "venv", ".venv", "__pycache__", "node_modules", "load", "loadtest", "docs"}
# Standalone scripts (argparse/side effects at import) — syntax-checked only, not imported
SCRIPT_ONLY_PREFIX = ("tools.",)


def _modules() -> dict[str, str]:
    out = {}
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in SKIP_DIRS and not d.startswith(".")]
        for f in fn:
            if f.endswith(".py"):
                rel = os.path.relpath(os.path.join(dp, f), ROOT)[:-3].replace(os.sep, ".")
                out[rel[:-9] if rel.endswith(".__init__") else rel] = os.path.join(dp, f)
    return out


def _imports(path: str, local: set[str], top_level_only: bool) -> set[str]:
    with open(path) as fh:
        tree = ast.parse(fh.read())
    nodes = tree.body if top_level_only else list(ast.walk(tree))
    deps = set()
    for n in nodes:
        if isinstance(n, ast.Import):
            deps.update(a.name for a in n.names if a.name in local)
        elif isinstance(n, ast.ImportFrom) and n.module:
            if n.module in local:
                deps.add(n.module)
            deps.update(f"{n.module}.{a.name}" for a in n.names if f"{n.module}.{a.name}" in local)
    return deps


def _sccs(graph: dict[str, set[str]]) -> list[list[str]]:
    sys.setrecursionlimit(10000)
    idx, low, stack, on, out, c = {}, {}, [], set(), [], [0]

    def visit(v):
        idx[v] = low[v] = c[0]
        c[0] += 1
        stack.append(v)
        on.add(v)
        for w in graph.get(v, ()):
            if w not in idx:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                out.append(sorted(comp))

    for m in graph:
        if m not in idx:
            visit(m)
    return out


def test_no_module_level_import_cycles():
    mods = _modules()
    local = set(mods)
    graph = {m: _imports(p, local, top_level_only=True) for m, p in mods.items()}
    assert _sccs(graph) == []


def test_leaf_layers_never_import_upward_even_lazily():
    mods = _modules()
    local = set(mods)
    upper = {"routers", "infra", "deps", "utils", "server"}
    for m, p in mods.items():
        if m.startswith("core.") or m in ("events", "services.read_models", "event_registry"):
            bad = {d for d in _imports(p, local, top_level_only=False) if d.split(".")[0] in upper}
            assert not bad, f"{m} imports upward: {sorted(bad)}"


def test_named_review_cycles_are_gone():
    """deps→utils→events→read_models→infra→deps · routers.auth↔owner_bootstrap · invariants↔validators (all imports, incl. lazy)."""
    mods = _modules()
    local = set(mods)
    g = {m: _imports(p, local, top_level_only=False) for m, p in mods.items()}
    assert "utils" not in g["deps"] and "infra" not in g["services.read_models"] and "utils" not in g["events"]
    assert "routers.auth" not in g["services.owner_bootstrap"]
    assert "services.invariants" not in g["services.validators"]


def _import_in_fresh_interpreter(mod: str) -> tuple[str, int, str]:
    env = {**os.environ, "PYTHONWARNINGS": "ignore"}
    r = subprocess.run([sys.executable, "-c", f"import {mod}"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    return mod, r.returncode, (r.stderr or "")[-400:]


def test_every_module_imports_in_isolation():
    mods = [m for m in _modules() if not m.startswith(SCRIPT_ONLY_PREFIX)]
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(_import_in_fresh_interpreter, mods))
    failed = [(m, err) for m, rc, err in results if rc != 0]
    assert not failed, failed


def test_scripts_compile():
    import py_compile
    for m, p in _modules().items():
        if m.startswith(SCRIPT_ONLY_PREFIX):
            py_compile.compile(p, doraise=True)
