def test_home_tiles(home):
    assert home["business_day"] == "2026-11-16"
    assert home["totals"]["collections_mtd"] == 15485546.0
    c = home["counts"]
    assert (c["cheques_pending"], c["visits_today"], c["followups_due"]) == (1, 1, 1)
