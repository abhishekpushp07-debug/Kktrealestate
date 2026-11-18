"""G1: every Masters / Admin → Advanced link opens its own page — no silent fallback to another master or the dashboard."""

import pathlib
import re

from routers.master import MASTERS as BACKEND_MASTERS

SRC = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"
HUB = (SRC / "pages/masters/MastersHub.jsx").read_text()
CONFIG = (SRC / "pages/master/masterConfig.js").read_text()
PAGE = (SRC / "pages/master/MasterPage.jsx").read_text()
APP = (SRC / "apps/erp/ErpApp.jsx").read_text()

CONFIG_KINDS = re.findall(r'^\s{4}kind: "([a-z-]+)"', CONFIG, re.M)


def _routes():
    top = re.findall(r'^\s{2}\["([^"]+)", "[^"]*", \w+\],', APP, re.M)  # R table
    paths = [f"/{p}" for p in top] + re.findall(r'path="(/[^"*]+)"', APP)
    masters = APP[APP.index('path="/masters"') :]
    masters = masters[: masters.index('path="/site-visits"')]
    paths += [f"/masters/{p}" for p in re.findall(r'path="([^/"][^"]*)"', masters)]
    return [re.compile("^" + re.sub(r":\w+", "[^/]+", p) + "$") for p in paths]


ROUTES = _routes()


def _hub_links():
    return re.findall(r'\["([^"]+)", "(/[^"]+)", "[^"]+"\]', HUB)


def test_master_page_has_no_fallback_config():
    assert "|| MASTERS[0]" not in PAGE, "unknown kinds must not silently open the first master"
    assert 'testId="master-unknown"' in PAGE


def test_every_config_kind_is_a_backend_master_and_unique():
    assert len(CONFIG_KINDS) == len(set(CONFIG_KINDS)), CONFIG_KINDS
    missing = [k for k in CONFIG_KINDS if k not in BACKEND_MASTERS]
    assert not missing, f"config kinds with no backend master: {missing}"


def test_every_hub_and_advanced_link_resolves_to_its_own_page():
    links = _hub_links()
    assert len(links) >= 25, links  # 13 masters + advanced items
    bad = []
    for label, href in links:
        path = href.split("?")[0]
        m = re.fullmatch(r"/masters/m/([a-z-]+)", path)
        if m and m.group(1) not in CONFIG_KINDS:
            bad.append(f"{label}: {href} has no masterConfig entry")
        if not any(r.match(path) for r in ROUTES):
            bad.append(f"{label}: {href} matches no route (falls back to /dashboard)")
    assert not bad, bad


def test_hold_reasons_and_allocation_categories_have_their_own_config():
    assert {"hold-reasons", "allocation-categories"} <= set(CONFIG_KINDS)


def test_every_literal_masters_m_link_in_the_app_has_a_config():
    bad = []
    for f in SRC.rglob("*.js*"):
        for kind in re.findall(r'["`]/masters/m/([a-z-]+)', f.read_text()):
            if kind not in CONFIG_KINDS:
                bad.append(f"{f.relative_to(SRC)}: {kind}")
        for href in re.findall(r'(?:href|to)="(/masters/[a-z/-]+)', f.read_text()):
            if not any(r.match(href) for r in ROUTES):
                bad.append(f"{f.relative_to(SRC)}: {href} matches no route")
    assert not bad, bad
