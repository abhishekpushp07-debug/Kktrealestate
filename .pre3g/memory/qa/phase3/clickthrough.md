# Phase 3 · click-through (REQ-148, JRN-77)

Result: **PASS** · 14/14 steps · 40 s · private backend http://127.0.0.1:8031 (own DB, dropped after the run; preview demo untouched)

Run: `cd /app/tests_e2e/clickthrough && python -m pytest -q` (see README; never alongside the backend pytest)

| # | Step | Result | s | What the screen showed / asserted |
|---|---|---|---|---|
| 1 | Masters: new Flat Type + Charge Head | PASS | 5.6 | flat type E2EBE01 (screen indicative ₹45,00,000) · charge head CLUBBE01 |
| 2 | Project | PASS | 1.5 | project E2EBE01 (E2E Project BE01) · visit slots switched on via API (no ERP screen for it) |
| 3 | Tower from template | PASS | 3.2 | screen said “Tower E2E: 8 floors, 32 flats, stage plan and 2 payment plan(s) created” → 8 floors, 32 flats, 2 plan(s) |
| 4 | Flats: pricing sheet | PASS | 2.9 | E-101 · sheet preview ₹45,00,000 == saved price |
| 5 | Pricing | PASS | 0.0 | drawer price ₹45,00,000 · status Available |
| 6 | Lead | PASS | 3.3 | lead LD-2627-6522 · next step “Book site visit” offered |
| 7 | Site visit | PASS | 2.2 | visit SV-2627-1691 booked for 2026-11-18 10:00 from the picked slot · outcome “Interested” typed in the Complete dialog → Completed |
| 8 | Booking: 3-step wizard | PASS | 4.6 | BK-2627-2920 · agreement ₹44,90,000 + new head CLUBBE01 · screen total final ₹47,44,000 == booked · cash 40 % · discount ₹10,000 (list ₹45,00,000, reason typed) · bills at booking ₹4,71,450 |
| 9 | Stage complete → bills raised | PASS | 1.9 | stage “Possession/Handover” · screen preview ₹2,35,725 = instalment ₹2,24,500 + GST ₹11,225 == posted (bill DM-2627-20715 + GST share) · next step “Print bill letters” |
| 10 | Payment: 5-field sheet, auto adjustment | PASS | 2.0 | KKT/2627/39777 · ₹2,69,400 cash · auto adjustment preview 3 line(s) sum == amount |
| 11 | Reversal | PASS | 1.4 | KKT/2627/39777 reversed · booking received back to ₹0 |
| 12 | Reports: Outstanding, Collections, Roznamcha | PASS | 3.6 | Outstanding total shows ₹7,07,175 (= booking outstanding) · Collections today: 2 rows, reversals −₹2,69,400, net ₹0 · Roznamcha: receipt +₹2,69,400 and reversal −₹2,69,400 |
| 13 | Waiver: Give waiver sheet → self-approved credit note | PASS | 3.1 | WV-2627-0024 · CN-2627-0017 self-approved · ₹1,000 Account share + GST credit = ₹1,050 off outstanding · received unchanged |
| 14 | Reports: Discount + Waiver registers | PASS | 2.5 | Discount Register lists BK-2627-2920 · Waiver Register lists WV-2627-0024 / CN-2627-0017 |
