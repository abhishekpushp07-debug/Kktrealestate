# Click-through gate (REQ-148 · JRN-77)

The owner's story through the **real screens** (Playwright, 1440 px), on a private test copy:

1. Masters — new Flat Type (rooms, area, rate) + new Charge Head
2. Project — New project dialog
3. Tower from template — "+ Tower" with a tower template (floors, flats, plans in one go)
4. Flats — pricing sheet on one flat (new flat type, area, rate)
5. Pricing — flat drawer shows the saved price, flat Available
6. Lead — New lead form → next step "Book site visit"
7. Site visit — slot picked in the visit dialog → outcome Completed
8. Booking — lead converted, 3-step wizard (cash share, new charge head added) → next step "Record booking amount"
9. Stage complete — construction panel, confirm dialog preview → bills raised → next step "Print bill letters"
10. Payment — post-payment sheet, Cash, auto adjustment preview → receipt → next step "Print / share receipt"
11. Reversal — Bills & Receipts → Reverse
12. Reports — Outstanding total, Collections day totals, Roznamcha receipt + reversal rows

Every number asserted comes from what the screen itself previewed (indicative price, pricing-sheet price, wizard total
final value, stage preview, allocation preview, receipt) and is checked against what the system then saved/reported.

## Isolation

`conftest.py` reuses the backend suite's private-copy machinery: the preview DB is snapshotted into `kkt_e2e`, a
private backend runs on `127.0.0.1:8031`, and the browser loads the preview frontend with every `/api` call routed to
that backend. At the end the backend is stopped and `kkt_e2e` is dropped — zero residue on the preview demo.

One step is set up through the API because no ERP screen exposes it: switching on visit slots for the new project.

## Run (the gate)

```bash
cd /app/tests_e2e/clickthrough && python -m pytest -q
```

Serial only. It refuses to start while another pytest is running (memory-safe); never run it alongside the backend
suite. Log: `memory/qa/phase3/clickthrough.md` (failure screenshots in `/tmp/clickthrough_step<N>.png`).

Dev loop: `python dev_backend.py &` (keeps a private backend on :8031), then `python story.py --base http://127.0.0.1:8031`.
