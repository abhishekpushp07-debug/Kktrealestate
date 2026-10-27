"""CR-3: the demo/test password is configuration (backend/.env DEMO_PASSWORD / TEST_PASSWORD), never a literal in source."""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCAN = ["backend", "frontend/src", "scripts"]
SKIP = {"node_modules", "venv", ".venv", "__pycache__", "build", ".git"}
EXT = (".py", ".js", ".jsx", ".ts", ".tsx", ".yaml", ".yml", ".json", ".sh", ".html")


def test_demo_password_not_in_source():
    pw = os.environ["DEMO_PASSWORD"]
    hits = []
    for base in SCAN:
        for dp, dn, fn in os.walk(os.path.join(ROOT, base)):
            dn[:] = [d for d in dn if d not in SKIP]
            for f in fn:
                if f.endswith(EXT) and f != ".env":
                    p = os.path.join(dp, f)
                    with open(p, errors="ignore") as fh:
                        if pw in fh.read():
                            hits.append(os.path.relpath(p, ROOT))
    assert hits == [], hits


def test_env_has_demo_and_test_password():
    assert os.environ.get("DEMO_PASSWORD") and os.environ.get("TEST_PASSWORD")
