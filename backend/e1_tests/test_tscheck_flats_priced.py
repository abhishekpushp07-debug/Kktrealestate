def test_every_flat_priced(api):
    it = api.get("/flats", params={"page_size": 200}).json()["items"]
    assert len(it) == 138
    assert not [f["flat_number"] for f in it if not f.get("saleable_sqft") or not f.get("price_paise")]
    assert sum(1 for f in it if f["status"] == "Available") == 56
