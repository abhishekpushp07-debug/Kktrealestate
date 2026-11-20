# REQ-38 rebuild determinism (as-of 2026-11-14, two consecutive story reseeds)
Snapshots `rebuild_run5.json` and `rebuild_run6.json` (money totals, counts and statuses of bookings, payments, demands, refunds, flats, leads, visits): **IDENTICAL**.
Numbers differ between rebuilds by design (counters carry on — REQ-28); `counters_reseed.json` shows every counter before/after the last rebuild, lowered = none.
Inside the last rebuild every FY sequence is gap-free (`tools/story_logic_check.py` → `gaps()` = 0; also `tests/test_story_logic.py`).
After the last rebuild: chronology 0 problems · integrity ok (78 bookings, 0 findings) · tieout 118 PASS / 0 FAIL (`tieout_final.txt`) · reseed status `done` (REQ-37 verification passed).
Note: run4 (as-of 2026-11-13) vs run5 (as-of 2026-11-14) differ only by one lead (the day rolled over at 00:00 UTC) — same as-of → identical.
