"""Frontend scans: every view/edit page for an audited entity exposes a History control, and no legacy coarse permission code is used in can()/nav guards."""
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"

# entity → files where its detail/edit surface lives (any one of them must render HistoryButton/HistoryTimeline for that entity)
HISTORY_SURFACES = {
    "booking": ["pages/BookingDetail.jsx"], "demand": ["pages/BookingDetail.jsx"], "refund": ["components/common/BookingOps.jsx"],
    "customer": ["pages/v2/Customer360.jsx", "pages/v2/Customers.jsx"], "lead": ["pages/Leads.jsx", "pages/v2/Leads.jsx"], "site_visit": ["pages/SiteVisits.jsx"],
    "payment": ["pages/v2/Payments.jsx", "components/common/LedgerTable.jsx"], "project": ["pages/ProjectDetail.jsx"], "block": ["pages/BlockDetail.jsx"],
    "flat": ["components/common/FlatDrawer.jsx"], "rate_card": ["components/common/ProjectTabs.jsx"], "catalogue_item": ["pages/v2/Catalogues.jsx"],
    "notice": ["pages/cms/Notices.jsx"], "role": ["pages/Roles.jsx"], "user": ["pages/Users.jsx"], "service_request": ["pages/ServiceRequests.jsx", "pages/v2/ServiceRequests.jsx"],
    "master": ["pages/master/MasterPage.jsx"], "company": ["pages/Settings.jsx"],
}


def _read(rel):
    p = SRC / rel
    return p.read_text() if p.exists() else ""


def test_every_entity_surface_has_history_control():
    missing = []
    for entity, files in HISTORY_SURFACES.items():
        texts = [_read(f) for f in files]
        if not any(("HistoryButton" in t or "HistoryTimeline" in t) for t in texts):
            missing.append(entity)
    assert not missing, missing


def test_no_legacy_coarse_codes_in_frontend():
    legacy = re.compile(r'(?:can(?:Any)?\(\s*|perm:\s*|perm=|,\s*)"([a-z_]+\.[a-z_]+)"')
    bad = []
    for f in list(SRC.rglob("*.jsx")) + list(SRC.rglob("*.js")):
        if f.name == "permissions.js":
            continue
        for m in legacy.finditer(f.read_text()):
            code = m.group(1)
            if code.count(".") == 1 and not code.endswith((".jsx", ".js", ".png", ".svg", ".com", ".in", ".json")):
                bad.append((str(f.relative_to(SRC)), code))
    assert not bad, bad
