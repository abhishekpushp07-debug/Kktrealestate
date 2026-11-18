# Phase 3E · final gates (Part 6)

| Gate | Result |
|---|---|
| Frontend lint / build | LINT 0 · BUILD 0 (initial JS 112.6 KB gz) |
| Browser-control scan | 0 offenders · disabled-without-reason 62 → 0 (ceiling 0) |
| Backfill / migration | discount backfill: demo 80/80 recorded, money_identical; volume 85 recorded / 1415 not recorded (no list price on seeded rows — shown as "not recorded"), money_identical |
| Tieout + integrity | demo: tieout 0 failed, integrity ok · kkt_volume: tieout 0 failed, integrity ok (1498 bookings) |
| Connection matrix | all green (adds: booking with discount, waiver pending / rejected / approved / approved→cancelled) |
| Phone sweep | 106 checks, 0 fail (adds discount + waiver registers, booking bills tab) |
| Internal words | 0 hits (adds discount + waiver registers) |
| Click-through | 14/14 PASS (discount at booking, Give waiver sheet → self-approved CN, both registers) |
| Full pytest -n 2 | 837 passed, 10 failed, 5 skipped; the 10 (parallel-interference set: integrity mid-write, tower C grid, load-test purge, startup migrations, print, hold expiry) pass serially: 13 passed |
| Performance | demo 16/16 within budget · kkt_volume 16/16 within budget |
| Screens | memory/qa/phase3e/screens — Day + Night × 1440 + 390, 9 screens, 0 horizontal overflow |
