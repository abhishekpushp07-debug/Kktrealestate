"""ONE price truth: flats store only integer `price_paise`; rupee `price` is derived at the API edge. Compare with the pre-switch snapshot."""
import json
import os

import requests

SNAP = os.path.join(os.path.dirname(__file__), "..", "..", "memory", "qa", "hardening", "price_snapshot_before.json")


def test_price_paise_is_the_only_stored_price():
    from pymongo import MongoClient
    d = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    assert d.flats.count_documents({"price": {"$exists": True}}) == 0, "legacy rupee `price` still stored"
    assert d.flats.count_documents({"price_paise": {"$type": "double"}}) == 0
    assert d.flats.count_documents({"price_paise": {"$type": ["int", "long"]}}) > 0


def test_flat_api_prices_match_pre_switch_snapshot(base_url, admin_headers):
    snap = json.load(open(SNAP))
    assert len(snap) >= 5
    compared = 0
    for s in snap:
        items = requests.get(f"{base_url}/api/flats", params={"search": s["flat_number"], "page_size": 20}, headers=admin_headers).json()["items"]
        f = next((x for x in items if x["flat_number"] == s["flat_number"]), None)
        assert f, s["flat_number"]
        # invariant on every flat: stored paise == rupee breakup × 100 and the API rupee price derives from it
        assert isinstance(f["price_paise"], int) and abs(f["price"] - f["price_paise"] / 100) < 0.005, (s["flat_number"], f["price"], f["price_paise"])
        if f.get("price_breakup"):
            assert f["price_paise"] == round(sum(b["amount"] for b in f["price_breakup"]) * 100), s["flat_number"]
        if [b["amount"] for b in f.get("price_breakup", [])] != [b["amount"] for b in s.get("price_breakup", [])]:
            continue  # re-priced by a bulk-price/rate-card test after the snapshot — not a price-switch effect
        assert f["price_paise"] == round(float(s["price"]) * 100), (s["flat_number"], f.get("price_paise"), s["price"])
        compared += 1
    assert compared >= 1, compared  # on a fresh seed all 6 match (see qa/hardening/price_snapshot_before.json)


def test_public_prices_unchanged_in_rupees(base_url):
    projects = requests.get(f"{base_url}/api/public/projects").json()
    items = projects["items"] if isinstance(projects, dict) else projects
    priced = [p for p in items if p.get("starting_price")]
    for p in priced:
        assert isinstance(p["starting_price"], (int, float)) and 1_000_000 < p["starting_price"] < 1_000_000_000, p["starting_price"]  # rupees, not paise
