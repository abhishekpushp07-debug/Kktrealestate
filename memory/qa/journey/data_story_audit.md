# Phase F — Data story audit & Phase H story-dataset design (2026-10-26, demo DB)

## 1. What the demo DB looks like today (measured)
| Fact | Value | Reading |
|---|---|---|
| Bookings | 44: **39 Cancelled**, 4 Active, 1 Completed | the demo has been consumed by 10 months of test runs; almost nothing "live" remains |
| Customers | 99; **87 without any booking** | most are test artefacts (`TEST Replay User`, locktest…, QA) |
| Leads | 214; converted 22; **0 bookings carry a `lead_id`** | funnel and bookings are disconnected — no customer's journey can be traced lead → booking |
| Site visits | 91 (35 completed, 32 cancelled, 23 confirmed, 1 no-show), all linked to leads | ok shape, but none leads to a booking record |
| Payments | 167: Cleared 70, **Reversed 72**, Bounced 24, Pending 1 | reversal ratio 43 % — a test trail, not a business |
| Payment dates | 2025-11-03 → 2026-10-26; 0 payments before booking date | dates are internally consistent (good) |
| Demands | 282 (33 voided); 129 Open/Partially-Paid on **cancelled** bookings; 113 "overdue" of which only 6 belong to live bookings | the overdue picture is noise |
| Stages | seeded blocks: Villa Block P 9/9 (possession), Tower A/B partial, Tower B 2/11 (anchor) | fine, but completion dates are mostly "today" from tests |
| Service tickets | 21 (17 New) all linked to bookings | mostly on cancelled bookings |
| Documents / communications | 43 / 17 | sparse |
| Notifications | 6,325 | mostly engine spam from repeated overdue runs |

## 2. Incoherences (with examples)
1. **Journey breaks at conversion**: `leads` have no `booking_id`, `bookings` no `lead_id` → "Converted" is a manual stage, visits never show on a Customer 360.
2. **Cancelled bookings keep live demands** (older cancel path) and their money stays in dvc/overdue/ageing — ₹5.7 Cr of "overdue" belongs to cancelled deals.
3. **Refunds never left the books**: 38 cancelled bookings with payments, 0 refund ledger/roznamcha rows.
4. **Reversal-heavy history**: 72 reversals vs 70 cleared receipts; receipt numbering has gaps that look like fraud to an accountant.
5. **Stage dates**: 9/9 stages of Villa Block P completed on consecutive seeded dates (ok), but Tower A/B stage completions are dated 2026-10-26 (test day), while their demands are due in the past → everything looks overdue on day one.
6. **Single-day clustering**: 36 of 44 bookings dated 2026-01 (one seed batch) — no monthly velocity story.
7. **Customers without KYC/doc coherence**: KYC "Verified" without documents; documents on customers without bookings.
8. **Villa project (GGV) default 0 % cash**: every GGV booking is 100 % account unless the user intervenes — valid but produces zero cash ledger stories for a whole project.
9. **Service tickets** on cancelled bookings; none on possession-stage units where they would naturally occur.
10. **No personas**: names are random (`Amit Sinha_Convert`), no family/co-applicant, no loan-bank story on account payments (bank accounts exist but `instrument.bank_name` random).

## 3. Phase H "story dataset" design (replaces the demo seed; also the base for volume generation)

### Principles
- Deterministic (seeded RNG), replayed **through the APIs** (business rules, caps, numbering), dated across **FY 2025-26 (Apr-2025 → Mar-2026)** with "today" = a configurable as-of date so overdue/forecast look right on any day.
- Every customer has a complete, explainable journey; every edge case appears exactly once and is named in the data (notes/remarks) so testers can find it.
- Two projects: **Shree Ganesh Heights (SGH)** — 2 towers × 11 stages, 60/40 split, bank-loan heavy; **Ganesh Green Villas (GGV)** — 1 villa block × 9 stages, 0/100 default with two customers overriding to 30/70 cash.

### Personas (12 customers → 14 bookings)
| # | Persona | Project / unit | Journey & edge case |
|---|---|---|---|
| 1 | Rajeev & Sunita Verma (co-applicants, salaried) | SGH-A-402 | Website lead Apr-25 → visit → booking May-25 → SBI loan 40 % → all stage demands paid on time → **fully paid, possession-ready** |
| 2 | Dr. Meera Iyer (NRI) | SGH-A-1203 | Referral → booking Jun-25 → **advance payments** ahead of demands (advances report) → NEFT only |
| 3 | Imran Qureshi (business) | SGH-B-701 | Walk-in → booking Jul-25 → **cheque bounce** Sep-25 → re-presented → cleared; bounce charge raised |
| 4 | Kavita Jha | SGH-B-305 | Booking Aug-25 → **agreement revision** Nov-25 (cash 60→50 %, added parking other-charge) |
| 5 | Anil & Pooja Thakur | SGH-A-805 → SGH-B-805 | Booking Sep-25 → **flat transfer** Dec-25 (same tower type) |
| 6 | Suresh Pandey | SGH-B-1101 | Booking Oct-25 → **cancellation Jan-26 with refund & deduction** (refund as cash-out line) |
| 7 | Nandini Rao (first-time buyer) | SGH-A-203 | Lead → 2 visits (one **no-show**) → booking Nov-25 → **overdue** 2 demands as of today → follow-ups & notice |
| 8 | Vikram Singh (investor) | SGH-A-1501 + SGH-A-1502 | Two bookings Dec-25; one on **hold** first (hold → release → book) |
| 9 | Fatima Begum | GGV-V-07 | GGV default 100 % account; **plan acceptance** via portal-style record; service ticket at possession stage |
| 10 | Harish Mehta | GGV-V-12 | **Cash 30/70 override**; DD payments; partially paid, not overdue |
| 11 | Ritu & Dev Malhotra | GGV-V-03 | Booked Jan-26, **payment reversal** (wrong amount keyed, same-day contra) |
| 12 | Mohan Lal (senior citizen) | SGH-B-102 | **Completed/possession** with 3 service tickets (plumbing, lift, rating) |
| — | 30 open leads across sources (Website 10, Brochure 6, Walk-in 8, Referral 6) with 18 visits scheduled/completed over the last 60 days | — | funnel with visit conversion; 3 Lost with reasons |

### Timeline rules
- Bookings spread Apr-25…Feb-26 (≥1 per month). Stage completions per tower follow a realistic cadence (SGH-A ahead of SGH-B by 2 stages; GGV at 7/9). Demands dated at stage completion; due = +15 days; payments dated due−5…+20 days except personas 7 (late) and 2 (early).
- Cheques: 15 % of account payments by cheque, with 6-day pending; exactly one bounce (persona 3).
- Roznamcha: at least one receipt on 70 % of working days in the last 90 days; the refund (persona 6) as a cash-out day.
- Notifications pruned to the last 30 days; audit log complete (generated by the API calls themselves).
- Inventory: SGH 2×11×4 = 88 flats + GGV 24 villas; 14 booked/sold, 3 hold, 2 blocked (legal), rest available with a rate card + PLC on corner/park-facing units; one **price edit** event in Dec-25 on unsold stock.
- Users: 6 staff personas (owner, PM, accounts, 2 sales, support); assignments so "my bookings / my leads" tiles are non-empty for each.

### Edge cases included (each once, discoverable by `remarks`)
advance payment · cheque bounce + re-present · agreement revision · other charge added later · cancellation with refund + deduction · transfer · hold → release → book · overdue with notice · fully paid & possession · payment reversal · 0 % cash project · co-applicants · NRI/NEFT-only · DD mode · stage undo attempt blocked (recorded in audit) · lost lead with reason · no-show visit.

### Acceptance for Phase H
- `tieout.py` all PASS; integrity 0 findings; every persona's Customer 360 timeline reads top-to-bottom as a story; `effects_probe.py all` on the story DB produces the same effect sets as on demo; volume generator (`volume_seed.py`) consumes the same persona templates for scale.
