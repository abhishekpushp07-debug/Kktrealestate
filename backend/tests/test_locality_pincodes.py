"""Every seeded locality carries meta.pincode so the customer form can auto-fill it."""
import os

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_seeded_localities_have_pincode():
    rows = list(db.catalogue_items.find({"type": "locality", "is_system": True}, {"_id": 0, "label": 1, "meta": 1}))
    assert rows, "no seeded localities"
    missing = [r["label"] for r in rows if not (r.get("meta") or {}).get("pincode")]
    assert not missing, f"localities without pincode: {missing}"


def test_pincode_format():
    bad = [r["label"] for r in db.catalogue_items.find({"type": "locality", "meta.pincode": {"$exists": True}}, {"_id": 0, "label": 1, "meta": 1}) if not str(r["meta"]["pincode"]).isdigit() or len(str(r["meta"]["pincode"])) != 6]
    assert not bad, bad
