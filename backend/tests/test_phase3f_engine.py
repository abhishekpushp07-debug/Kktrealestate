import os

"""Phase 3F F1: report engine + Customer status pilot (REQ-259…278)."""

import pytest
import requests

from tests.conftest import BASE, TEST_PASSWORD, session_token

R = f"{BASE}/api/reports/v3/customer-status"


def _h(email):
    return {"Authorization": f"Bearer {session_token(email, TEST_PASSWORD)}"}


@pytest.fixture(scope="module")
def admin(admin_headers):
    return admin_headers


def test_ten_owner_columns_in_order(admin):
    d = requests.get(R, headers=admin, timeout=30).json()
    assert [c["label"] for c in d["cols"]] == [
        "Customer name",
        "Flat code",
        "Agreement value",
        "Cash component",
        "Bills raised till date",
        "Account received",
        "Cash received",
        "Account dues",
        "Cash dues",
        "Final status",
    ]
    t = d["totals"]
    assert t["bills_raised"] - t["account_received"] - t["cash_received"] - t["waived"] + t["instalment_advance"] == (
        t["account_dues"] + t["cash_dues"]
    )
    assert d["formula"].startswith("Bills raised ₹")


def test_hub_five_segments_ten_tiles(admin):
    d = requests.get(f"{BASE}/api/reports/v3", headers=admin, timeout=30).json()
    assert [s["segment"] for s in d["segments"]] == ["Customers", "Finance", "Bookings", "Project & inventory", "Leads"]
    assert all(len(s["tiles"]) == 10 for s in d["segments"])
    assert d["one_click"] == "customer-status"
    assert [t["key"] for t in d["control_room"]] == ["activity", "data-quality"]


def test_filters_narrow_and_sentence(admin):
    full = requests.get(R, headers=admin, timeout=30).json()
    pid = full["options"]["project"][0]["value"]
    d = requests.get(
        R, headers=admin, params={"project": pid, "status": "overdue", "overdue_days": 30}, timeout=30
    ).json()
    assert d["count"] <= full["count"]
    assert all(r["status_kind"] == "overdue" for r in d["rows"])
    assert "overdue 30+ days" in d["sentence"]
    towers = full["options"]["tower"]
    assert all("parent" in t for t in towers)


def test_unknown_filter_and_too_many_levels_422(admin):
    assert requests.get(R, headers=admin, params={"bogus": 1}, timeout=30).status_code == 422
    six = "project,tower,floor,flat,customer,sales"
    assert requests.get(R, headers=admin, params={"group": six}, timeout=30).status_code == 422


def test_group_subtotals_sum_to_total(admin):
    d = requests.get(R, headers=admin, params={"group": "project,tower"}, timeout=30).json()
    assert sum(g["totals"]["cash_dues"] for g in d["groups"]) == d["totals"]["cash_dues"]
    for g in d["groups"]:
        assert sum(c["totals"]["account_dues"] for c in g["children"]) == g["totals"]["account_dues"]


def test_as_of_past_reads_ledger(admin):
    d = requests.get(R, headers=admin, params={"as_of": "2026-03-31"}, timeout=30).json()
    assert d["as_of"] == "2026-03-31" and "as of 31 Mar 2026" in d["sentence"]
    now = requests.get(R, headers=admin, timeout=30).json()
    assert d["totals"]["bills_raised"] <= now["totals"]["bills_raised"]


def test_sales_role_denied(admin):
    assert requests.get(R, headers=_h("sales@kkt.in"), timeout=30).status_code == 403


def test_exports_open(admin):
    x = requests.get(f"{R}/export.xlsx", headers=admin, params={"group": "project"}, timeout=60)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    p = requests.get(f"{R}/export.pdf", headers=admin, timeout=60)
    assert p.status_code == 200 and p.content[:4] == b"%PDF"


def test_saved_view_shared_and_pin_limit(admin):
    made = []
    try:
        for i in range(6):
            r = requests.post(
                f"{BASE}/api/reports/presets",
                headers=admin,
                json={
                    "report_key": "customer-status",
                    "name": f"QA pin {i}",
                    "filters": {"status": "overdue"},
                    "pinned": True,
                },
                timeout=20,
            )
            if r.status_code == 409:
                break
            assert r.status_code == 201, r.text
            made.append(r.json()["id"])
        r = requests.post(
            f"{BASE}/api/reports/presets",
            headers=admin,
            json={"report_key": "customer-status", "name": "QA pin 7", "filters": {}, "pinned": True},
            timeout=20,
        )
        assert r.status_code == 409 and r.json()["code"] == "PIN_LIMIT"
    finally:
        for i in made:
            requests.delete(f"{BASE}/api/reports/presets/{i}", headers=admin, timeout=20)


@pytest.mark.parametrize(
    "params",
    [
        {"page": "abc"},
        {"page_size": "x"},
        {"overdue_days": "abc"},
        {"dues_min": "abc"},
        {"as_of": "2999-01-01"},
        {"booked_from": "nope"},
    ],
)
def test_bad_values_422(admin, params):
    assert requests.get(R, headers=admin, params=params, timeout=30).status_code == 422


F2 = [
    "customer-statement",
    "customer-ageing",
    "advance-holders",
    "call-list",
    "kyc-pending",
    "payment-behaviour",
    "customer-directory",
    "cancelled-customers",
]


@pytest.mark.parametrize("key", F2)
def test_f2_reports_open_and_export(admin, key):
    d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
    assert d["meta"]["segment"] == "Customers" and d["sentence"]
    assert set(d["totals"]) <= {c["key"] for c in d["meta"]["columns"]} | {
        "pending_n",
        "docs_missing_n",
        "overdue_amount",
        "bookings",
        "late_days",
        "late_n",
    }
    x = requests.get(f"{BASE}/api/reports/v3/{key}/export.xlsx", headers=admin, timeout=60)
    assert x.status_code == 200 and x.content[:2] == b"PK"


def test_statement_needs_customer(admin):
    d = requests.get(f"{BASE}/api/reports/v3/customer-statement", headers=admin, timeout=30).json()
    assert d["count"] == 0 and d["meta"]["needs"]["filter"] == "customer"
    cid = d["options"]["customer"][0]["value"]
    d = requests.get(
        f"{BASE}/api/reports/v3/customer-statement", headers=admin, params={"customer": cid}, timeout=30
    ).json()
    assert d["count"] > 0 and all(r["customer_id"] == cid for r in d["rows"])


def test_ageing_bands_sum(admin):
    t = requests.get(f"{BASE}/api/reports/v3/customer-ageing", headers=admin, timeout=30).json()["totals"]
    assert sum(t[k] for k in ("band_not_due", "band_0_30", "band_31_60", "band_61_90", "band_90p")) == t["total_due"]


def test_hub_customers_segment_live(admin):
    d = requests.get(f"{BASE}/api/reports/v3", headers=admin, timeout=60).json()
    tiles = {t["key"]: t for t in d["segments"][0]["tiles"]}
    assert all(tiles[k]["live"] for k in F2)


F3 = {
    "collections": "collections-v2",
    "day-book": "roznamcha-summary",
    "bank-receipts": "bank-receipts",
    "cheques": "cheques",
    "bills-vs-collection": "demand-vs-collection",
    "outstanding": "outstanding-v2",
    "cash-vs-account": "cash-vs-account",
    "other-charges": "other-charges",
    "receivables-forecast": "receivables-forecast",
    "waivers": "waiver-register",
}


@pytest.mark.parametrize("key", list(F3))
@pytest.mark.load_sensitive  # two live reports compared: no other worker may write between the reads
def test_f3_equals_existing_report(admin, key):
    new = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
    dflt = new.get("defaults") or {}
    q = {"from_date": dflt["period_from"], "to_date": dflt["period_to"]} if dflt.get("_default_period") else {}
    old = requests.get(f"{BASE}/api/reports/{F3[key]}", headers=admin, params=q, timeout=60).json()
    assert new["meta"]["segment"] == "Finance"
    same = [k for k in new["totals"] if k.endswith("_paise") and k in (old.get("totals") or {})]
    diff = {k: (new["totals"][k], old["totals"][k]) for k in same if round(new["totals"][k]) != round(old["totals"][k])}
    assert same and not diff, diff
    assert requests.get(f"{BASE}/api/reports/v3/{F3[key]}", headers=admin, timeout=60).json()["meta"]["key"] == key


def test_f3_period_pushdown(admin):
    p = {"period_from": "2026-04-01", "period_to": "2026-06-30"}
    a = requests.get(f"{BASE}/api/reports/v3/collections", headers=admin, params=p, timeout=60).json()
    b = requests.get(
        f"{BASE}/api/reports/collections-v2",
        headers=admin,
        params={"from_date": p["period_from"], "to_date": p["period_to"]},
        timeout=60,
    ).json()
    assert a["totals"]["total_paise"] == b["totals"]["total_paise"]
    assert "period 01 Apr 2026 – 30 Jun 2026" in a["sentence"]


def test_registry_declares_full_filter_standard():
    """REQ-260…263: a flat column → Project→Tower→Floor→Flat; a customer / booking column → Customer; money → a value filter."""
    from reports_v3.registry import REGISTRY

    scoped = {"customer-statement"}  # one customer's statement: the customer is the scope
    bad = []
    for key, spec in REGISTRY.items():
        keys = {f["key"] for f in spec["filters"]}
        cols = {c["key"] for c in spec["columns"]}
        if key not in scoped and cols & {"flat_code", "unit"} and not {"project", "tower", "floor", "flat"} <= keys:
            bad.append((key, "location cascade"))
        if key not in scoped and cols & {"booking_number", "customer_name", "unit"} and "customer" not in keys:
            bad.append((key, "customer"))
        if any(c["type"] == "money" for c in spec["columns"]) and not any(
            f["kind"] == "range" for f in spec["filters"]
        ):
            bad.append((key, "value filter"))
        cascade = {f["key"]: f.get("parent") for f in spec["filters"]}
        if "floor" in cascade and (
            cascade["tower"] != "project" or cascade["floor"] != "tower" or cascade["flat"] != "floor"
        ):
            bad.append((key, "cascade"))
    assert not bad, bad


def test_dated_reports_default_this_fy_newest_first(admin):
    d = requests.get(f"{BASE}/api/reports/v3/collections", headers=admin, timeout=60).json()
    assert d["defaults"]["_default_period"] == "this_fy" and "period 01 Apr" in d["sentence"]
    dates = [r["date"] for r in d["rows"]]
    assert dates == sorted(dates, reverse=True)


F4 = [
    "booking-register",
    "sales-summary",
    "discount-register",
    "plan-position",
    "agreements",
    "cancellations",
    "transfers",
    "sales-team",
    "realised-rate",
    "booking-health",
]


@pytest.mark.parametrize("key", F4)
def test_f4_reports_open_and_export(admin, key):
    d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
    assert d["meta"]["segment"] == "Bookings" and d["sentence"] and d["formula"]
    x = requests.get(f"{BASE}/api/reports/v3/{key}/export.xlsx", headers=admin, timeout=60)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    p = requests.get(f"{BASE}/api/reports/v3/{key}/export.pdf", headers=admin, timeout=60)
    assert p.status_code == 200 and p.content[:4] == b"%PDF"


def test_f4_hub_bookings_live(admin):
    d = requests.get(f"{BASE}/api/reports/v3", headers=admin, timeout=60).json()
    seg = next(s for s in d["segments"] if s["name" if "name" in s else "segment"] == "Bookings")
    assert all(t["live"] for t in seg["tiles"])


def test_f4_dated_defaults(admin):
    for key in ("sales-summary", "discount-register", "cancellations", "transfers", "sales-team"):
        d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
        assert d["defaults"]["_default_period"] == "this_fy", key


def test_f4_booking_health_buckets(admin):
    d = requests.get(
        f"{BASE}/api/reports/v3/booking-health",
        headers=admin,
        params={"health": "At risk", "page_size": 500},
        timeout=60,
    ).json()
    assert all(r["health"] == "At risk" for r in d["rows"])
    assert all(r["days_overdue"] > 60 or r["gap"] > 20 for r in d["rows"])


F5 = [
    "inventory-status",
    "stacking-plan",
    "price-list",
    "hold-register",
    "landowner",
    "parking",
    "construction-vs-plan",
    "stage-bills",
    "sales-velocity",
]


@pytest.mark.parametrize("key", F5)
def test_f5_reports_open_and_export(admin, key):
    d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
    assert d["meta"]["segment"] == "Project & inventory" and d["sentence"] and d["formula"]
    for ext, magic in (("xlsx", b"PK"), ("pdf", b"%PDF")):
        x = requests.get(f"{BASE}/api/reports/v3/{key}/export.{ext}", headers=admin, timeout=60)
        assert x.status_code == 200 and x.content[: len(magic)] == magic, ext


def test_f5_project_statement_needs_project(admin):
    d = requests.get(f"{BASE}/api/reports/v3/project-statement", headers=admin, timeout=60).json()
    assert d["count"] == 0 and d["meta"]["needs"]["filter"] == "project" and d["options"]["project"]
    pid = d["options"]["project"][0]["value"]
    d = requests.get(
        f"{BASE}/api/reports/v3/project-statement", headers=admin, params={"project": pid}, timeout=60
    ).json()
    assert d["count"] > 0


def _login(email):
    return {"Authorization": f"Bearer {session_token(email, TEST_PASSWORD)}"}


def test_f5_display_layer_viewer_never_sees_real_inventory():
    """Accounts has the inventory report but not real-status: display layer only, no Shown-as / booking names."""
    h = _login("accounts@kkt.in")
    for key in ("inventory-status", "stacking-plan", "price-list"):
        d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=h, params={"page_size": 500}, timeout=60).json()
        assert {r["status"] for r in d["rows"]} <= {"Available", "Hold", "Sold"}, key
        assert not {"shown_as", "display_reason", "display_since"} & {c["key"] for c in d["meta"]["columns"]}
        assert all(r.get("customer_name") in (None, "—") and "masked" not in r for r in d["rows"])
        x = requests.get(
            f"{BASE}/api/reports/v3/{key}/export.xlsx",
            headers=h,
            params={"cols": "flat_code,status,shown_as"},
            timeout=60,
        )
        assert x.status_code in (200, 403) and b"Shown as" not in x.content
    d = requests.get(f"{BASE}/api/reports/v3/stacking-plan", headers=h, timeout=60).json()
    assert {
        c["status"] for p in d["illustration"]["projects"] for t in p["towers"] for f in t["floors"] for c in f["flats"]
    } <= {"Available", "Hold", "Sold"}
    assert set(d["illustration"]["legend"]) <= {"Available", "Hold", "Sold"}
    assert requests.get(f"{BASE}/api/reports/v3/landowner", headers=h, timeout=60).status_code == 403


SALES_OK = ["inventory-status", "stacking-plan", "price-list", "hold-register", "parking", "sales-velocity"]


def test_f5_sales_opens_display_layer_reports():
    """REQ-282 / JRN-114: Sales sees the display (masked) status, list prices, no money received, names only on own bookings."""
    import pymongo

    h = _login("sales@kkt.in")
    me = requests.get(f"{BASE}/api/auth/me", headers=h, timeout=30).json()
    me = me.get("user", me)["id"]
    db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    own = {b["customer_name"] for b in db.bookings.find({"sales_user_id": me}, {"customer_name": 1})}
    for key in SALES_OK:
        d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=h, params={"page_size": 500}, timeout=60).json()
        assert d.get("count") is not None, (key, d)
        cols = {c["key"] for c in d["meta"]["columns"]}
        assert not cols & {
            "shown_as",
            "display_reason",
            "display_since",
            "received",
            "collected_paise",
            "bills_raised",
        }, key
        assert all(r.get("status") in (None, "Available", "Hold", "Sold") for r in d["rows"]) or key in (
            "parking",
            "sales-velocity",
        ), key
        assert {r.get("customer_name") for r in d["rows"]} - {None, "—"} <= own, key
        assert d["formula"], key
    tiles = {
        t["key"]
        for s in requests.get(f"{BASE}/api/reports/v3", headers=h, timeout=60).json()["segments"]
        for t in s["tiles"]
    }
    assert set(SALES_OK) <= tiles
    st = requests.get(f"{BASE}/api/reports/v3/stacking-plan", headers=h, timeout=60).json()["illustration"]
    assert set(st["legend"]) <= {"Available", "Hold", "Sold"}


def test_f5_sales_role_blocked():
    h = _login("sales@kkt.in")
    for key in ["project-statement", "construction-vs-plan", "stage-bills", "landowner"]:
        assert requests.get(f"{BASE}/api/reports/v3/{key}", headers=h, timeout=60).status_code == 403, key


def test_f5_report_access_matrix_file():
    """security/report_access_matrix.json is the reviewed who-opens-what list; it must equal the registry."""
    import json

    from reports_v3.registry import REGISTRY

    want = {
        k: {"view": [s["permission"], *s.get("permission_any", [])], "export": s["export_permission"]}
        for k, s in sorted(REGISTRY.items())
    }
    have = json.load(open(os.path.join(os.path.dirname(__file__), "..", "security", "report_access_matrix.json")))
    assert have == want, "run: python tools/gen_report_matrix.py"


def test_natural_flat_order(admin):
    d = requests.get(f"{BASE}/api/reports/v3/stacking-plan", headers=admin, timeout=60).json()
    for p in d["illustration"]["projects"]:
        for t in p["towers"]:
            for f in t["floors"]:
                nums = [int("".join(ch for ch in c["flat"].split("-")[-1] if ch.isdigit()) or 0) for c in f["flats"]]
                assert nums == sorted(nums), (t["name"], [c["flat"] for c in f["flats"]])


F6 = [
    "lead-funnel",
    "lead-register",
    "source-performance",
    "follow-ups",
    "visit-register",
    "visit-conversion",
    "lost-leads",
    "response-time",
    "team-pipeline",
    "lead-ageing",
]


@pytest.mark.parametrize("key", F6 + ["service-sla"])
def test_f6_reports_open_and_export(admin, key):
    d = requests.get(f"{BASE}/api/reports/v3/{key}", headers=admin, timeout=60).json()
    assert d["meta"]["segment"] in ("Leads", "Customers") and d["sentence"] and d["formula"]
    for ext, magic in (("xlsx", b"PK"), ("pdf", b"%PDF")):
        x = requests.get(f"{BASE}/api/reports/v3/{key}/export.{ext}", headers=admin, timeout=60)
        assert x.status_code == 200 and x.content[: len(magic)] == magic, ext


def test_hub_is_fifty_live_reports(admin):
    d = requests.get(f"{BASE}/api/reports/v3", headers=admin, timeout=60).json()
    tiles = [t for s in d["segments"] for t in s["tiles"]]
    assert len(tiles) == 50 and all(t["live"] for t in tiles), [t["key"] for t in tiles if not t["live"]]


def test_f6_aggregate_filters_push_down(admin):
    """Funnel / sources / team aggregate the lead rows after the lead filters (project, source, owner) apply."""
    allr = requests.get(f"{BASE}/api/reports/v3/lead-funnel", headers=admin, timeout=60).json()
    src = allr["options"]["source"][0]["value"]
    one = requests.get(f"{BASE}/api/reports/v3/lead-funnel", headers=admin, params={"source": src}, timeout=60).json()
    reg = requests.get(
        f"{BASE}/api/reports/v3/lead-register",
        headers=admin,
        params={
            "source": src,
            "period_from": allr["defaults"]["period_from"],
            "period_to": allr["defaults"]["period_to"],
        },
        timeout=60,
    ).json()
    assert one["totals"]["leads"] == reg["count"] < allr["totals"]["leads"]
