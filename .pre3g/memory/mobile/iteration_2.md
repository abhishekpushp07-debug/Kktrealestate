# Mobile iteration 2
- Attachment idx = ticket-wide running index over public thread messages' attachments (matches backend). Images fetched once per (ticket, idx) via React Query `["p-att", id, idx, name]` → web blob: URL / native cache file → expo-image + Lightbox. Blob URLs are not revoked (small, per session).
- Ledger: label = "Demand" for DEMAND rows, else API `bucket`; split shown on its own line (mobile) / under chip (desktop table).
- Login: SiteLinks component below the card.
- Test data: reply with photo (icon.png) posted on SR-2627-0002 (Rahul Verma, 9431034567) at 07:01 UTC — ticket moved out of "Awaiting Customer". SR-2627-0008 from iteration 1 was wiped by the reseed.
- Not done: native device run (bundles compile); testing_agent not available to this agent.
