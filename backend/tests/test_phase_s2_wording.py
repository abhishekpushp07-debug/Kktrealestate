"""Phase S2.4 — user-facing wording guard. Admin → System / Audit surfaces are exempt (they keep operational terms)."""

import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"
EXEMPT = (
    "pages/AuditLog",
    "pages/Definitions",
    "pages/admin/",
    "components/common/JourneyPanel",
    "PropagationHealth",
    "Integrity",
    "Backups",
    "pages/Settings",
)
FORBIDDEN = [
    r"\(legacy\)",
    r"Legacy default amount",
    r"Setup readiness",
    r"Rooms snapshot",
    r"Areas snapshot",
    r"Allocation category",
    r">Display status<",
    r"Where did this go",
    r"[Mm]anual override<",
]


def test_user_facing_wording_is_clean():
    hits = []
    for f in SRC.rglob("*.jsx"):
        rel = str(f.relative_to(SRC))
        if any(e in rel for e in EXEMPT):
            continue
        text = f.read_text()
        for pat in FORBIDDEN:
            if re.search(pat, text):
                hits.append(f"{rel}: {pat}")
    assert not hits, hits


def test_sidebar_has_nine_primary_areas():
    shell = (SRC / "components/layout/AppShell.jsx").read_text()
    nav = shell[shell.index("const NAV = [") : shell.index("];", shell.index("const NAV = ["))]
    labels = re.findall(r'label: "([^"]+)"', nav)
    core = [l for l in labels if l != "Website"]
    assert core == [
        "Home",
        "Projects",
        "Customers",
        "Bookings",
        "Payments",
        "Construction",
        "Documents",
        "Reports",
        "Masters",
        "Admin",
    ], core
    for gone in ("Leads & Visits", "Demands", "Messaging", "Service"):
        assert gone not in labels


def test_booking_wizard_has_three_steps():
    src = (SRC / "pages/BookingWizard.jsx").read_text()
    assert 'const STEPS = ["Who", "Price & Plan", "Confirm"]' in src
    assert "plan_acceptance_mode" not in src
