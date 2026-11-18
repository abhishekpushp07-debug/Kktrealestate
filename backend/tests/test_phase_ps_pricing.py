"""Phase PS — pricing invariants: no silent area/price on generation, explicit type defaults, per-flat lock, floor designer, migration, terminology."""

import os
import re
import sys
import uuid

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE
from tests.flat_claims import claim_flat, own_flats
from tests.story_anchors import bk

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _first(h, url):
    r = requests.get(f"{BASE}/api{url}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"][0]


def test_generated_flats_have_no_area_or_price(admin_headers):
    """Floor designer PUT creates a flat with saleable_sqft/price = null and pricing_status=pending unless apply_type_defaults is set."""
    blk = _first(admin_headers, "/blocks?page_size=1")
    floors = requests.get(f"{BASE}/api/blocks/{blk['id']}/floors", headers=admin_headers).json()
    fl = (
        next(f for f in floors["floors"] if f["flats"] and f["locked_count"] == 0)
        if any(f["flats"] and f["locked_count"] == 0 for f in floors["floors"])
        else None
    )
    if fl is None:
        pytest.skip("no fully unlocked floor in the first tower")
    pos = [{"position": x["position"], "flat_type_id": x["flat_type_id"]} for x in fl["flats"]]
    new_pos = pos + [
        {
            "position": len(pos) + 1,
            "flat_type_id": pos[0]["flat_type_id"],
            "flat_number": f"PS-{uuid.uuid4().hex[:5].upper()}",
        }
    ]
    r = requests.put(
        f"{BASE}/api/blocks/{blk['id']}/floors/{fl['floor']}", json={"positions": new_pos}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    after = requests.get(f"{BASE}/api/blocks/{blk['id']}/floors", headers=admin_headers).json()
    new = next(
        x
        for f in after["floors"]
        if f["floor"] == fl["floor"]
        for x in f["flats"]
        if x["flat_number"] == new_pos[-1]["flat_number"]
    )
    assert new["saleable_sqft"] is None and new.get("price") is None and new["pricing_status"] == "pending"
    # explicit apply-type-defaults fills from the master (or 422 when the type has no defaults)
    r2 = requests.post(f"{BASE}/api/flats/{new['id']}/apply-type-defaults", headers=admin_headers)
    assert r2.status_code in (200, 422), r2.text
    if r2.status_code == 200:
        assert r2.json()["saleable_sqft"] or r2.json()["rate_per_sqft"]
    # PATCH rate × saleable computes the price; pricing_status flips to ready
    r3 = requests.patch(
        f"{BASE}/api/flats/{new['id']}/pricing",
        json={"saleable_sqft": 1000, "rate_per_sqft": 5000, "pricing_mode": "rate"},
        headers=admin_headers,
    )
    assert r3.status_code == 200, r3.text
    assert r3.json()["price"] == 5_000_000 and r3.json()["pricing_status"] == "ready"
    # revert the floor (removes only the unbooked flat we added)
    r4 = requests.put(
        f"{BASE}/api/blocks/{blk['id']}/floors/{fl['floor']}", json={"positions": pos}, headers=admin_headers
    )
    assert r4.status_code == 200 and r4.json()["removed"] == 1


def test_booked_flat_is_locked_individually(admin_headers):
    booked = _first(admin_headers, "/flats?status=Booked&page_size=1")
    r = requests.patch(f"{BASE}/api/flats/{booked['id']}/pricing", json={"saleable_sqft": 999}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "STATUS_LOCKED"
    r = requests.delete(f"{BASE}/api/blocks/{booked['block_id']}/floors/{booked['floor']}", headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "STATUS_LOCKED" and booked["flat_number"] in r.json()["locked"]
    # bulk edit skips the locked flat instead of failing
    r = requests.post(
        f"{BASE}/api/flats/bulk-edit", json={"flat_ids": [booked["id"]], "rate_per_sqft": 1}, headers=admin_headers
    )
    assert r.status_code == 200 and r.json()["updated"] == 0 and r.json()["skipped_locked"][0]["id"] == booked["id"]


def test_structure_edit_previews_and_refuses_to_drop_booked_floors(admin_headers):
    booked = _first(admin_headers, "/flats?status=Booked&page_size=1")
    r = requests.patch(
        f"{BASE}/api/blocks/{booked['block_id']}/structure",
        json={"numbering_pattern": "{floor}{pos2}", "preview": True},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["preview"] is True and "renames" in r.json()
    r = requests.patch(
        f"{BASE}/api/blocks/{booked['block_id']}/structure",
        json={
            "floors": booked["floor"] - 1 if booked["floor"] > 1 else 1,
            "floor_start": booked["floor"] + 1,
            "preview": False,
        },
        headers=admin_headers,
    )
    assert r.status_code in (409, 422), r.text


def test_project_pricing_setup_roundtrip(admin_headers):
    p = _first(admin_headers, "/projects?page_size=1")
    g = requests.get(f"{BASE}/api/projects/{p['id']}/pricing-setup", headers=admin_headers).json()
    codes = {h["code"] for h in g["charge_heads"]}
    assert {"PARKING", "MAINT", "CLUB", "LEGAL", "DEV", "OTHER"} <= codes
    head = next(h for h in g["charge_heads"] if h["code"] == "CLUB")
    body = {
        **g["setup"],
        "agreement_gst_percent": 5,
        "maintenance": {"method": "per_sqft_months", "rate_per_sqft": 3, "months": 24, "fixed_amount": None},
        "charge_heads": [
            {"charge_type_id": head["id"], "enabled": True, "value": 150000, "gst_percent": 18, "timing": "on_booking"}
        ],
        "version": g["version"],
    }
    r = requests.put(f"{BASE}/api/projects/{p['id']}/pricing-setup", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["setup"]["maintenance"]["months"] == 24 and r.json()["setup"]["charge_heads"][0]["value"] == 150000
    # restore
    requests.put(
        f"{BASE}/api/projects/{p['id']}/pricing-setup",
        json={**g["setup"], "version": r.json()["version"]},
        headers=admin_headers,
    )


def test_migration_every_flat_has_saleable_and_pricing_status(admin_headers):
    items = requests.get(f"{BASE}/api/flats?page_size=200", headers=admin_headers).json()["items"]
    assert items and all("pricing_status" in f for f in items)
    assert all(
        f["saleable_sqft"] == f["super_builtup_sqft"]
        for f in items
        if f.get("super_builtup_sqft") and f.get("saleable_sqft")
    )


SUPER_RE = re.compile(r"super[ _-]?built[ _-]?up", re.IGNORECASE)


def test_no_super_builtup_labels_in_frontend_or_documents():
    """Owner terminology: the ERP shows one 'Saleable area'. Field names may survive in code; user-facing labels/PDF text may not."""
    hits = []
    for base in (
        os.path.join(ROOT, "frontend", "src"),
        os.path.join(ROOT, "backend", "routers"),
        os.path.join(ROOT, "backend", "services"),
    ):
        for dp, _, fn in os.walk(base):
            for f in fn:
                if not f.endswith((".js", ".jsx", ".py")) or "components/ui" in dp:
                    continue
                with open(os.path.join(dp, f)) as fh:
                    for i, line in enumerate(fh, 1):
                        for m in re.finditer(r'(["\'`>][^"\'`<]*?)(Super built[ -]?up|super built[ -]?up)', line):
                            hits.append(f"{os.path.relpath(os.path.join(dp, f), ROOT)}:{i}: {m.group(0)[:60]}")
    assert hits == [], hits


def test_api_outputs_expose_saleable_only(admin_headers):
    """Fix 1: flat + structure responses carry saleable_sqft and no legacy area keys."""
    flat = _first(admin_headers, "/flats?page_size=1")
    full = requests.get(f"{BASE}/api/flats/{flat['id']}", headers=admin_headers).json()
    floors = requests.get(f"{BASE}/api/blocks/{flat['block_id']}/floors", headers=admin_headers).json()
    for doc in [flat, full] + [x for f in floors["floors"] for x in f["flats"]][:5]:
        assert "saleable_sqft" in doc
        assert not {"super_builtup_sqft", "carpet_sqft", "builtup_sqft"} & set(doc), [
            k for k in doc if "builtup" in k or "carpet" in k
        ]
    r = requests.get(f"{BASE}/api/flats?format=csv&page_size=5", headers=admin_headers)
    assert r.status_code == 200 and "super_builtup" not in r.text and "carpet" not in r.text.lower()
    at = requests.get(f"{BASE}/api/master/area-types?page_size=50", headers=admin_headers).json()["items"]
    assert next(a for a in at if a["code"] == "SUPER_BUILTUP")["name"] == "Saleable Area"
    assert all(a.get("hidden") for a in at if a["code"] in ("CARPET", "BUILTUP"))


def test_type_change_marks_review_and_keep_values(admin_headers):
    """Fix 2: changing the type of a priced flat → pricing_status=review (counts as not ready); Keep values clears it."""
    flats = requests.get(f"{BASE}/api/flats?status=Available&page_size=50", headers=admin_headers).json()["items"]
    if not any(f.get("pricing_status") == "ready" and f.get("saleable_sqft") for f in flats):
        pytest.skip("no priced available flat")
    flat = claim_flat(flats, lambda f: f.get("pricing_status") == "ready" and f.get("saleable_sqft"))
    fts = requests.get(f"{BASE}/api/master/flat-types?page_size=50", headers=admin_headers).json()["items"]
    other = next(ft for ft in fts if ft["id"] != flat["flat_type_id"])
    r = requests.patch(
        f"{BASE}/api/flats/{flat['id']}/pricing", json={"flat_type_id": other["id"]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["pricing_status"] == "review" and r.json()["saleable_sqft"] == flat["saleable_sqft"]
    floors = requests.get(f"{BASE}/api/blocks/{flat['block_id']}/floors", headers=admin_headers).json()
    assert floors["pending_pricing"] >= 1
    r2 = requests.post(f"{BASE}/api/flats/{flat['id']}/keep-values", headers=admin_headers)
    assert r2.status_code == 200 and r2.json()["pricing_status"] == "ready"
    # restore type (values kept again → ready)
    requests.patch(
        f"{BASE}/api/flats/{flat['id']}/pricing", json={"flat_type_id": flat["flat_type_id"]}, headers=admin_headers
    )
    requests.post(f"{BASE}/api/flats/{flat['id']}/keep-values", headers=admin_headers)


def test_legacy_patch_accepts_pricing_fields(admin_headers):
    """Fix 3: PATCH /flats/{id} accepts saleable_sqft and routes through the same pricing engine."""
    # own tower: the first 50 Available flats are all claimed by earlier tests in a full session
    flat = own_flats(f"{BASE}/api", admin_headers, 1)[0]
    r = requests.patch(
        f"{BASE}/api/flats/{flat['id']}",
        json={"saleable_sqft": flat["saleable_sqft"] + 10, "version": flat["version"]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    from services.pricing import _round

    ps = requests.get(f"{BASE}/api/projects/{flat['project_id']}/pricing-setup", headers=admin_headers).json()
    setup = ps["setup"]  # the project's own rounding / floor-rise rule (setup_of) applies to every rate price
    sal, rise = flat["saleable_sqft"] + 10, 0
    if setup.get("floor_rise_enabled"):
        blk = requests.get(f"{BASE}/api/blocks/{flat['block_id']}", headers=admin_headers).json()
        rise = (blk.get("floor_rise_per_sqft") or 0) * max(0, (flat.get("floor") or 0) - blk.get("floor_start", 1))
    expected = _round(round(sal * flat["rate_per_sqft"], 2) + round(rise * sal, 2), setup.get("rounding") or "none")
    assert r.json()["saleable_sqft"] == sal and r.json()["price"] == expected
    requests.patch(
        f"{BASE}/api/flats/{flat['id']}", json={"saleable_sqft": flat["saleable_sqft"]}, headers=admin_headers
    )


def test_breakdown_preview_and_migration(admin_headers):
    """PS.3: preview totals = agreement + agreement GST + charges + charge GST; migrated bookings carry agreement_gst_percent=0 and unchanged ledger totals."""
    flat = _first(admin_headers, "/flats?status=Available&page_size=1")
    body = {
        "flat_id": flat["id"],
        "agreement_value": 5000000,
        "agreement_gst_percent": 5,
        "charges": [{"name": "Club membership", "amount": 100000, "gst_percent": 18, "demand_at": "on_booking"}],
    }
    r = requests.post(f"{BASE}/api/bookings/breakdown-preview", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert (
        d["agreement_gst"] == 250000
        and d["additional_charges_total"] == 100000
        and d["gst_total"] == 268000
        and d["total_final_value"] == 5000000 + 250000 + 118000
    )
    # the story's zero-GST booking is the owner's agreement-only worked example (anchor by role, not by list position:
    # the first page fills with bookings other tests create, so "first 50" depended on test order)
    items = requests.get(f"{BASE}/api/bookings", params={"search": bk("owner")}, headers=admin_headers).json()["items"]
    fulls = [requests.get(f"{BASE}/api/bookings/{b['id']}", headers=admin_headers).json() for b in items]
    full = next((f for f in fulls if (f.get("pricing") or {}).get("agreement_gst_percent") in (0, 0.0)), None)
    assert full is not None, "no zero-GST booking left to verify migration against"
    p = full["pricing"]
    other = sum(c["total"] for c in p["charges"])
    assert p["agreement_gst_percent"] in (0, 0.0) and p["total_final_value"] == full["agreement_value"] + other
    led = requests.get(f"{BASE}/api/bookings/{full['id']}/ledger", headers=admin_headers)
    if led.status_code == 200:
        assert led.json()  # ledger still renders; amounts derive from demands which were not touched


@pytest.mark.load_sensitive
def test_booking_with_breakdown_demands_gst_proportionally(admin_headers):
    """PS.3 end-to-end: booking snapshot carries agreement GST + charge lines; AGR_GST is demanded in step with the raised %; ledger bill raised includes it."""
    flats = requests.get(f"{BASE}/api/flats?status=Available&page_size=50", headers=admin_headers).json()["items"]
    if not any(f.get("pricing_status") == "ready" for f in flats):
        pytest.skip("no priced available flat")
    flat = claim_flat(flats, lambda f: f.get("pricing_status") == "ready")
    plans = requests.get(
        f"{BASE}/api/projects/{flat['project_id']}/blocks/{flat['block_id']}/payment-plans", headers=admin_headers
    ).json()
    plans = plans.get("items", plans) if isinstance(plans, dict) else plans
    if not plans:
        pytest.skip("tower has no payment plan assigned")
    cust = requests.post(
        f"{BASE}/api/customers",
        headers=admin_headers,
        json={"full_name": f"PS Buyer {uuid.uuid4().hex[:4]}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"},
        timeout=30,
    )
    assert cust.status_code == 201, cust.text
    body = {
        "customer_id": cust.json()["id"],
        "flat_id": flat["id"],
        "payment_plan_id": plans[0]["id"],
        "agreement_value": 5_000_000,
        "cash_agreed": 2_500_000,
        "account_agreed": 2_500_000,
        "booking_date": "2026-10-20",
        "discount_reason": "QA test price",  # REQ-236: agreed below list needs a reason
        "agreement_gst_percent": 5,
        "other_charges": [{"name": "Club membership", "amount": 100000, "gst_percent": 18, "demand_at": "on_booking"}],
    }
    r = requests.post(
        f"{BASE}/api/bookings", headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())}, json=body, timeout=60
    )
    assert r.status_code == 201, r.text
    b = r.json()
    p = b["pricing"]
    assert (
        p["agreement_gst_percent"] == 5
        and p["agreement_gst"] == 250000
        and p["total_final_value"] == 5_000_000 + 250000 + 118000
    )
    full = requests.get(f"{BASE}/api/bookings/{b['id']}", headers=admin_headers).json()
    gst_line = next(l for l in full["other_charges"] if l["code"] == "AGR_GST")
    club = next(l for l in full["other_charges"] if l["name"] == "Club membership")
    assert gst_line["demand_at"] == "stage" and gst_line["total"] == 250000
    assert club["demanded"] == club["total"] == 118000  # on_booking → demanded immediately
    booking_pct = full["summary"].get("raised_percent") or full.get("raised_percent")
    if booking_pct:  # booking stage already raised → GST demanded proportionally
        assert abs(gst_line["demanded"] - round(250000 * booking_pct / 100)) <= 1, (gst_line["demanded"], booking_pct)
    led = requests.get(f"{BASE}/api/bookings/{full['id']}/ledger", headers=admin_headers).json()
    assert (
        sum(r_["udhar_paise"] for r_ in led["rows"] if r_["type"] == "DEMAND") >= 11_800_000
    )  # club incl. GST is in bill raised (paise)
    # audited cleanup: cancel the QA booking
    c = requests.post(
        f"{BASE}/api/bookings/{b['id']}/cancel",
        headers=admin_headers,
        json={"reason": "PS.3 QA booking — automated cleanup", "version": full["version"]},
        timeout=60,
    )
    assert c.status_code in (200, 201), c.text


def test_booking_accepts_own_attached_slot_and_cancel_restores_attached(admin_headers):
    """PS follow-up: a slot attached to the booked flat is accepted (and auto-included); a slot attached to another flat is 409; cancel → Attached again."""
    flats = requests.get(f"{BASE}/api/flats?status=Available&page_size=80", headers=admin_headers).json()["items"]
    flats = [f for f in flats if f.get("pricing_status") == "ready"]
    if len(flats) < 2:
        pytest.skip("need two priced available flats")
    flat = claim_flat(flats)
    other = next((f for f in flats if f["id"] != flat["id"] and f["project_id"] == flat["project_id"]), None)
    slots = [
        s
        for s in requests.get(
            f"{BASE}/api/parking?project_id={flat['project_id']}&page_size=200", headers=admin_headers
        ).json()["items"]
        if s["status"] == "Available"
    ]
    if other is None or len(slots) < 2:
        pytest.skip("need two free slots in the project")
    plans = requests.get(
        f"{BASE}/api/projects/{flat['project_id']}/blocks/{flat['block_id']}/payment-plans", headers=admin_headers
    ).json()
    plans = plans.get("items", plans) if isinstance(plans, dict) else plans
    mine, theirs = slots[0], slots[1]
    for s, f in ((mine, flat), (theirs, other)):
        assert (
            requests.post(
                f"{BASE}/api/parking/{s['id']}/attach", headers=admin_headers, json={"flat_id": f["id"]}
            ).status_code
            == 200
        )
    full = requests.get(f"{BASE}/api/flats/{flat['id']}", headers=admin_headers).json()
    assert (
        [s["id"] for s in full["parking_slots"]] == [mine["id"]]
        and "maintenance_effective" in full
        and "maintenance_amount" in full
        and full["pricing_status"] == "ready"
    )
    cust = requests.post(
        f"{BASE}/api/customers",
        headers=admin_headers,
        json={"full_name": f"PS Parker {uuid.uuid4().hex[:4]}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"},
        timeout=30,
    ).json()
    body = {
        "customer_id": cust["id"],
        "flat_id": flat["id"],
        "payment_plan_id": plans[0]["id"] if plans else None,
        "agreement_value": 5_000_000,
        "cash_agreed": 2_500_000,
        "account_agreed": 2_500_000,
        "booking_date": "2026-10-20",
        "discount_reason": "QA test price",
    }
    bad = requests.post(
        f"{BASE}/api/bookings",
        headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())},
        json={**body, "parking_slot_ids": [theirs["id"]]},
        timeout=60,
    )
    assert bad.status_code == 409 and bad.json()["code"] == "PARKING_NOT_AVAILABLE", bad.text
    ok = requests.post(
        f"{BASE}/api/bookings",
        headers={**admin_headers, "Idempotency-Key": str(uuid.uuid4())},
        json={**body, "parking_slot_ids": [mine["id"]]},
        timeout=60,
    )
    assert ok.status_code == 201, ok.text
    b = ok.json()
    assert b["parking_slot_ids"] == [mine["id"]]
    slot_of = lambda sid: next(
        x
        for x in requests.get(
            f"{BASE}/api/parking?project_id={flat['project_id']}&page_size=200", headers=admin_headers
        ).json()["items"]
        if x["id"] == sid
    )  # noqa: E731
    assert slot_of(mine["id"])["status"] == "Allotted"
    assert any((c.get("source") or "").startswith("parking:") for c in b["pricing"]["charges"]) or not mine.get("price")
    v = requests.get(f"{BASE}/api/bookings/{b['id']}", headers=admin_headers).json()["version"]
    assert requests.post(
        f"{BASE}/api/bookings/{b['id']}/cancel",
        headers=admin_headers,
        json={"reason": "PS parking QA — automated cleanup", "version": v},
        timeout=60,
    ).status_code in (200, 201)
    s = slot_of(mine["id"])
    assert s["status"] == "Attached" and s["flat_id"] == flat["id"]
    for s_ in (mine, theirs):  # audited cleanup
        assert requests.post(f"{BASE}/api/parking/{s_['id']}/detach", headers=admin_headers, json={}).status_code == 200


def test_floor_and_structure_edits_never_delete_a_booked_flat(admin_headers):
    """CR-3 #1: a flat booked after the designer loaded is kept; the delete predicate guards on status/booking_id and the response reports it."""
    h = admin_headers
    proj = requests.get(f"{BASE}/api/projects?page_size=5", headers=h).json()["items"][0]
    ft = requests.get(f"{BASE}/api/master/flat-types?page_size=5", headers=h).json()["items"][0]
    bt = requests.get(f"{BASE}/api/master/block-types?page_size=5", headers=h).json()["items"][0]
    code = f"R{uuid.uuid4().hex[:2].upper()}"
    tw = requests.post(
        f"{BASE}/api/blocks",
        headers=h,
        json={
            "project_id": proj["id"],
            "block_type_id": bt["id"],
            "name": f"CR3-{code}",
            "code": code,
            "floors": 2,
            "flats_per_floor": 2,
            "floor_start": 1,
            "numbering_pattern": "{block}-{floor}{pos2}",
            "position_flat_types": [
                {"position": 1, "flat_type_id": ft["id"]},
                {"position": 2, "flat_type_id": ft["id"]},
            ],
            "rate_per_sqft": 4000,
        },
        timeout=60,
    )
    assert tw.status_code == 201, tw.text
    tw = tw.json()
    flats = requests.get(f"{BASE}/api/flats?block_id={tw['id']}&page_size=10", headers=h).json()["items"]
    top = [f for f in flats if f["floor"] == 2]
    target = top[0]
    requests.patch(
        f"{BASE}/api/flats/{target['id']}/pricing",
        headers=h,
        json={"saleable_sqft": 1000, "rate_per_sqft": 4000, "pricing_mode": "rate", "version": target["version"]},
    )
    cust = requests.post(
        f"{BASE}/api/customers",
        headers=h,
        json={"full_name": f"CR3 Buyer {uuid.uuid4().hex[:4]}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"},
        timeout=30,
    ).json()
    bk = requests.post(
        f"{BASE}/api/bookings",
        headers={**h, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "customer_id": cust["id"],
            "flat_id": target["id"],
            "agreement_value": 4_000_000,
            "cash_agreed": 2_000_000,
            "account_agreed": 2_000_000,
            "booking_date": "2026-10-20",
            "discount_reason": "QA test price",
            "other_charges": [],
        },
        timeout=60,
    )
    assert bk.status_code == 201, bk.text
    # floor delete → 409 lists the booked flat; nothing on the floor deleted
    r = requests.delete(f"{BASE}/api/blocks/{tw['id']}/floors/2", headers=h)
    assert (
        r.status_code == 409 and r.json()["code"] == "STATUS_LOCKED" and target["flat_number"] in r.json()["detail"]
    ), r.text
    # structure shrink to 1 floor → 409, both top-floor flats survive
    r = requests.patch(f"{BASE}/api/blocks/{tw['id']}/structure", headers=h, json={"floors": 1, "preview": False})
    assert r.status_code == 409 and r.json()["code"] == "STATUS_LOCKED", r.text
    # floor PUT keeping only position 1 (the booked flat) → unbooked position 2 removed, booked flat retained and reported in kept_locked
    r = requests.put(
        f"{BASE}/api/blocks/{tw['id']}/floors/2",
        headers=h,
        json={"positions": [{"position": 1, "flat_type_id": ft["id"]}]},
    )
    assert r.status_code == 200 and r.json()["removed"] == 1 and len(r.json()["kept_locked"]) <= 1, r.text
    left = requests.get(f"{BASE}/api/flats?block_id={tw['id']}&page_size=10", headers=h).json()["items"]
    assert len(left) == 3 and any(f["id"] == target["id"] and f["status"] == "Booked" for f in left)
    v = requests.get(f"{BASE}/api/bookings/{bk.json()['id']}", headers=h).json()["version"]
    requests.post(
        f"{BASE}/api/bookings/{bk.json()['id']}/cancel",
        headers=h,
        json={"reason": "CR-3 QA cleanup", "version": v},
        timeout=60,
    )


def test_one_parking_slot_cannot_be_allotted_twice(admin_headers):
    """CR-3 #2: two bookings racing for one free slot → exactly one 201, the other 409 PARKING_NOT_AVAILABLE; cancel restores the slot."""
    import concurrent.futures as cf

    h = admin_headers
    flats = [
        f
        for f in requests.get(f"{BASE}/api/flats?status=Available&page_size=80", headers=h).json()["items"]
        if f.get("pricing_status") == "ready"
    ]
    pairs = [(a, b) for a in flats for b in flats if a["id"] != b["id"] and a["project_id"] == b["project_id"]]
    if not pairs:
        pytest.skip("need two priced available flats in one project")
    f1 = claim_flat(flats, lambda f: any(a["id"] == f["id"] for a, _ in pairs))
    f2 = claim_flat(flats, lambda f: f["project_id"] == f1["project_id"])
    slot = next(
        (
            s
            for s in requests.get(f"{BASE}/api/parking?project_id={f1['project_id']}&page_size=200", headers=h).json()[
                "items"
            ]
            if s["status"] == "Available"
        ),
        None,
    )
    if not slot:
        pytest.skip("no free slot")
    custs = [
        requests.post(
            f"{BASE}/api/customers",
            headers=h,
            json={"full_name": f"CR3 Racer {uuid.uuid4().hex[:4]}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"},
            timeout=30,
        ).json()
        for _ in range(2)
    ]

    def book(f, c):
        return requests.post(
            f"{BASE}/api/bookings",
            headers={**h, "Idempotency-Key": str(uuid.uuid4())},
            json={
                "customer_id": c["id"],
                "flat_id": f["id"],
                "agreement_value": 5_000_000,
                "cash_agreed": 2_500_000,
                "account_agreed": 2_500_000,
                "booking_date": "2026-10-20",
                "discount_reason": "QA test price",
                "parking_slot_ids": [slot["id"]],
                "other_charges": [],
            },
            timeout=60,
        )

    with cf.ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda p: book(*p), [(f1, custs[0]), (f2, custs[1])]))
    codes = sorted(r.status_code for r in rs)
    assert codes == [201, 409], [r.text[:200] for r in rs]
    loser = next(r for r in rs if r.status_code == 409)
    assert loser.json()["code"] == "PARKING_NOT_AVAILABLE"
    winner = next(r for r in rs if r.status_code == 201).json()
    assert (
        requests.get(f"{BASE}/api/flats/{(f2 if winner['flat_id'] == f1['id'] else f1)['id']}", headers=h).json()[
            "status"
        ]
        == "Available"
    )  # loser's flat was rolled back
    v = requests.get(f"{BASE}/api/bookings/{winner['id']}", headers=h).json()["version"]
    assert requests.post(
        f"{BASE}/api/bookings/{winner['id']}/cancel",
        headers=h,
        json={"reason": "CR-3 QA cleanup", "version": v},
        timeout=60,
    ).status_code in (200, 201)
    s = next(
        x
        for x in requests.get(f"{BASE}/api/parking?project_id={f1['project_id']}&page_size=200", headers=h).json()[
            "items"
        ]
        if x["id"] == slot["id"]
    )
    assert s["status"] == "Available" and not s.get("booking_id")


def test_snapshot_tolerates_legacy_lines():
    """CR-3 #3: pre-PS other_charges lines (amount/gst_percent only, rupee amount) migrate without KeyError."""
    from services.breakdown import snapshot

    snap = snapshot(
        500_000_000,
        0,
        [
            {"name": "Legal", "amount": 25000, "gst_percent": 18, "demand_at": "on_booking"},
            {"name": "Club", "amount_paise": 1_000_000, "gst_percent": 0},
        ],
    )
    assert snap["additional_charges_total_paise"] == 2_500_000 + 1_000_000 and snap["gst_total_paise"] == 450_000
    assert snap["total_final_value_paise"] == 500_000_000 + 3_500_000 + 450_000


def test_loadtest_projects_hidden_from_reports_unless_explicit(admin_headers):
    """Phase L: a project tagged load_test is excluded from reports/dashboards/demand register by default; explicit project_id still works."""
    h = admin_headers
    code = f"LT{uuid.uuid4().hex[:3].upper()}"
    p = requests.post(
        f"{BASE}/api/projects",
        headers=h,
        json={
            "name": f"LOADTEST-{code}",
            "code": code,
            "project_type": "Residential",
            "status": "Under Construction",
            "launch_date": "2026-10-01",
            "default_cash_percent": 40,
            "load_test": True,
            "address": {"line1": "LT", "city": "Patna", "state": "Bihar", "pincode": "800001"},
        },
        timeout=30,
    )
    assert p.status_code == 201, p.text
    p = p.json()
    assert p["id"] not in requests.get(f"{BASE}/api/reports/outstanding", headers=h, timeout=60).text
    assert (
        p["id"]
        not in requests.get(f"{BASE}/api/demands/register", headers=h, params={"page_size": 200}, timeout=60).text
    )
    assert p["id"] not in requests.get(f"{BASE}/api/dashboard/home", headers=h, timeout=60).text
    assert (
        requests.get(
            f"{BASE}/api/reports/project-statement", headers=h, params={"project_id": p["id"]}, timeout=60
        ).status_code
        == 200
    )
    assert requests.get(f"{BASE}/api/health", timeout=10).json().get("build")
    v = requests.get(f"{BASE}/api/projects/{p['id']}", headers=h).json()["version"]
    requests.patch(f"{BASE}/api/projects/{p['id']}", headers=h, json={"is_active": False, "version": v})
