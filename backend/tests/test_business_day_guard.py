"""REQ-64: server code never derives a date from the UTC clock. Every 'today' / as-of / default date goes through
services.clock (today(), today_iso(), day_of(), day_start_utc(), day_end_utc(), day_range()). Fails naming file:line."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# server code + the tools the server runs on the rebuild / verify path (CLI test drivers are client-side: they pick dates)
SERVER_TOOLS = ("story_seed", "story_logic_check", "demo_journeys", "tieout", "tieout_reports", "backup")
RULES = [
    (r"now_iso\(\)\s*\[\s*:\s*\d+\s*\]", "now_iso()[:n] is the UTC date"),
    (r"\bdate\.today\(\)", "date.today() is the container (UTC) date"),
    (r"\bdatetime\.(utcnow|today)\(\)", "naive/UTC now"),
    (
        r"\.now\((UTC|timezone\.utc|tz=UTC|tz=timezone\.utc)?\)\s*\.\s*(date\(\)|strftime\(|replace\(hour)",
        "UTC now → date",
    ),
    (r"\b_now\(\)\s*\.\s*date\(\)", "UTC now → date"),
    (r"now\([^)]*\)\s*\.\s*isoformat\(\)\s*\[\s*:\s*(7|10)\s*\]", "now sliced to a UTC date"),
    (r"_at\b[\"']?\]?\)?\s*\[\s*:\s*(7|10)\s*\]", "stored UTC timestamp sliced to a date (use clock.day_of)"),
    (r"\b(ts|at)\s*\[\s*:\s*(7|10)\s*\]", "stored UTC timestamp sliced to a date (use clock.day_of)"),
    (r"[\"']T23:59", "UTC day end appended to a date (use clock.day_end_utc / day_range)"),
    (r"\)\s*\[\s*:\s*10\s*\]", "value sliced to a date (a stored timestamp is UTC: use clock.day_of)"),
]
ALLOW = "business-day: ok"


def server_files() -> list[Path]:
    skip = {"tests", "e1_tests", "tools", "loadtest", "docs", "__pycache__", ".ruff_cache"}  # e1_tests: tester-owned
    out = [p for p in ROOT.rglob("*.py") if not (set(p.relative_to(ROOT).parts[:-1]) & skip)]
    return sorted(out + [ROOT / "tools" / f"{t}.py" for t in SERVER_TOOLS])


def scan(path: Path, text: str | None = None) -> list[str]:
    hits = []
    raw = (path.read_text(encoding="utf-8") if text is None else text).splitlines()
    code = "\n".join(ln.split("#", 1)[0] if not ln.lstrip().startswith(("'", '"')) else ln for ln in raw)
    name = path.relative_to(ROOT) if path.is_absolute() else path
    for rx, why in RULES:
        for m in re.finditer(rx, code):
            i = code.count("\n", 0, m.start()) + 1
            if ALLOW not in raw[i - 1]:
                hits.append(f"{name}:{i}: {why}: {raw[i - 1].strip()[:120]}")
    return sorted(set(hits), key=lambda h: int(h.split(":")[1]))


def test_no_utc_derived_dates_in_server_code():
    hits = [h for f in server_files() if f.name != "clock.py" for h in scan(f)]
    assert not hits, "UTC-derived dates (use services.clock):\n" + "\n".join(hits)


def test_guard_catches_a_planted_utc_date():
    planted = "def f():\n    x = 1\n    return now_iso()[:10]\n"
    hits = scan(Path("routers/planted.py"), planted)
    assert hits and hits[0].startswith("routers/planted.py:3:"), hits
    for bad in (
        "d = date.today()",
        "d = datetime.now(UTC).date()",
        "d = datetime.now(timezone.utc).date().isoformat()",
        "d = clock.now().date()",
        "d = b['created_at'][:10]",
        "d = p.get('cleared_at')[:10]",
        "q = {'$lte': t + 'T23:59:59'}",
        'd = (a.get("x") or b)[\n    :10\n]',
    ):
        assert scan(Path("x.py"), bad), bad
    for ok in ("d = clock.today_iso()", "d = clock.day_of(b['created_at'])", "d = datetime.now(IST).date()"):
        assert not scan(Path("x.py"), ok), ok


# E6: the frontend takes calendar dates from lib/businessDay.js only — no UTC slicing of a Date in components/pages
FRONT = ROOT.parent / "frontend" / "src"
FRONT_PAT = re.compile(r"toISOString\(\)\s*\.\s*(slice|substr|substring|split)\(")


def front_scan(path: Path, text: str | None = None) -> list[str]:
    text = text if text is not None else path.read_text()
    return [
        f"{path.relative_to(FRONT)}:{i}: {ln.strip()[:120]}"
        for i, ln in enumerate(text.splitlines(), 1)
        if FRONT_PAT.search(ln) and ALLOW not in ln
    ]


def test_no_utc_date_slicing_in_frontend():
    bad = [h for p in sorted(FRONT.rglob("*.js*")) for h in front_scan(p)]
    assert bad == [], "use @/lib/businessDay (businessToday / businessDayOf / addDays):\n" + "\n".join(bad)


def test_frontend_guard_catches_a_planted_utc_slice():
    planted = "const today = () => new Date().toISOString().slice(0, 10);\n"
    assert front_scan(FRONT / "pages" / "x.jsx", planted)
