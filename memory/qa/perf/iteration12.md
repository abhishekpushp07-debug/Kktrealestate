# Iteration 12 perf (REQ-211), 2026-11-17

Tool: `tools/perf_budget.py`, 30 warm requests per path, private backend on a scratch copy. Volume = `kkt_volume` (1,500 bookings, 19,508 receipts, 4,139 other-charge parts). Raw tables: `i12_volume.md`, `i12_demo.md`. Before = `phase3r_volume.md`, measured at §3R close.

## The three paths that were over budget on volume (p50 / p95 / first call, ms)

| Path | Before | After | Budget | Status |
|---|---|---|---|---|
| FY collections | 680 / 766 / 849 | **4.0 / 4.4 / 452** | cached ≤ 100, first ≤ 800 | within |
| Outstanding & ageing | 256 / 260 / 300 | **64 / 65 / 286** | cached ≤ 100 | within |
| Stage complete (33 bookings) | 2,824 / 2,895 | **444 / 553** | ≤ 600 | within |

Also on volume: Bills raised page went from 196 / 199 to **133 / 134**. Every other path is within budget on demo and on volume.

## What changed

The posting logic, rows, numbers and audit records are all unchanged.

- **Reports are cached per answer.** The key is user + params + business day + a data stamp. The data stamp is the newest audit row id plus the newest ledger row id, so any write on any worker makes the next read recompute. There is no TTL guesswork. Used for `collections-v2` and `outstanding-v2`; exports are never cached.
- **Carried from before is one server-side aggregation.** The running balance is Σ bills raised − Σ received (checked row by row), so all four numbers come from one `$group`. It no longer reads every ledger row.
- **Collections reads only receipts that touch the period.** These are receipts dated, posted (posted is restamped at clearance) or reversed in the period. Each branch uses an index, and only the 16 fields the report uses are read.
- **Stage complete, step 1, is done in one batch.** That means one read of what is already raised and one counter write per financial year, handing out numbers in the same booking order, then one insert. Step 2 (charges, ledger rebuild, audit) touches only its own booking, so up to 32 run at once. Tower notices are written in one insert.
- **New indexes:**
  - `audit_logs.id`. Every write marks its own outbox row by id; without this index each mark scanned 57k rows, about 29 ms.
  - `audit_logs(snapshot_ctx.booking_id, created_at)`.
  - `payments(company, status, posted_at)` and `payments(company, status, reversal.at)`.
  - `bookings(company, other_charges.demand_history.due_on)`.
- **Demand register** serialises and tags each cached answer once, not on every hit.

## Proof that the outputs are identical

`tools/run_equivalence.sh` runs the old code (git `af7bfa6`) and the new code, each on its own fresh copy of `kkt_volume`. Both run the same reports, a 41-booking stage complete, and the reports again after the write. `tools/perf_equivalence.py diff` compares them. Log: `equivalence.log`.

The comparison ignores the new `bill_day` field and the order of rows that tie on amount (that order follows storage order, which differs between two restores). On that basis these are **identical**:
- stage response
- every booking's summary and other charges
- demands, including demand numbers
- ledger rows
- notification counts
- audits
- Collections (3 variants)
- Outstanding totals
- the reports read after the write, so the cache does not serve a stale answer

Two differences are intended fixes, and totals are equal in both:
1. **Outstanding grouped by customer, project or tower is now keyed by id.** Before, it was keyed by name, so same-name customers were merged. On volume, 1,490 customers had been folded into 302 name rows, and 36 towers into 8. Re-merging the new rows by label gives back the old rows exactly. Preview had 10 duplicate customer names, so it was affected too.
2. **Tower labels now carry the project code or name**, for example "Villa Block P (Premium) · P2" instead of "P2".

Volume tieout: `tieout_volume.md`, 0 failed. To make it run at this scale, the tieout now pages through customer cards and respects a sheet's flagged display cap (`truncated` / `total_rows`).

Two real defects at scale were fixed:
- Cheques in hand stopped at 500, so the count and amount showed 500 / ₹132.5 Cr against a real 922 / ₹260.5 Cr. Count and amount are now taken over every pending cheque.
- The cheque register stopped at 2,000 rows.
