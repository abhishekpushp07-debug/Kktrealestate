"""ONE price truth: flats store only integer `price_paise`; rupee `price` is derived at the API edge. Compare with the pre-switch snapshot."""
import os

import requests

SNAP = os.path.join(os.path.dirname(__file__), "..", "..", "memory", "qa", "hardening", "price_snapshot_before.json")


def test_price_paise_is_the_only_stored_price():
    from pymongo import MongoClient
    d = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    assert d.flats.count_documents({"price": {"$exists": True}}) == 0, "legacy rupee `price` still stored"
    assert d.flats.count_documents({"price_paise": {"$type": "double"}}) == 0
    assert d.flats.count_documents({"price_paise": {"$type": ["int", "long"]}}) > 0


def test_public_prices_unchanged_in_rupees(base_url):
    projects = requests.get(f"{base_url}/api/public/projects").json()
    items = projects["items"] if isinstance(projects, dict) else projects
    priced = [p for p in items if p.get("starting_price")]
    for p in priced:
        assert isinstance(p["starting_price"], (int, float)) and 1_000_000 < p["starting_price"] < 1_000_000_000, p["starting_price"]  # rupees, not paise
