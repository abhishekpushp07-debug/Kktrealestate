# Phase Q — design notes (written before code)

## Q1 Messaging channel layer
- **One `Message` record** (`messages`): who/what/where/how it went. Status vocabulary is closed: queued · sent · delivered · failed · skipped_no_contact · skipped_no_consent · not_configured. A channel either really sends or says "Not configured" — the UI never shows a green tick it did not earn.
- **Adapters** behind `Channel.send(msg) -> (status, provider_id, error)`. Email = Emergent-managed Resend proxy (managed sender address, `from_name` = company brand, reply-to = company letterhead email). WhatsApp / SMS adapters exist, return `not_configured`, and declare the fields they need (Twilio SID/token/from · Meta Cloud phone-number-id/token/template namespace) so the UI can render a "Connect provider" card. No mocks.
- **Outbox**: `queue()` inserts `queued`; `MESSAGE_SEND` job sends each message in isolation (job_runs), retries ×3 with 1·4·16 min backoff, then `failed` + alert. Manual "Send now" calls the same path synchronously so the user sees the real provider answer.
- **Contact & consent on the customer**: email, phone, whatsapp_phone (defaults to phone), preferred_channel, consent {email, whatsapp, sms}, language en/hi. Email consent defaults true when an email is given; nothing blocks creation.
- **Templates (Masters → Templates)**: code + channel + en/hi subject/body; placeholders rendered server-side with escaping; preview against a real booking. Seeded: reminder_day7/15/30, receipt_sent, demand_raised, welcome_booking.
- Layout: `/messaging` page — left: channel cards (Email live · WhatsApp/SMS "Connect provider" with field list), right: message log table (status chips by meaning: sage sent/delivered, brick failed, warm "skipped — reason", muted not_configured), filters, Reminder log tab with tie-out to `messages`. Empty state: "No messages yet — reminders will appear here nightly".

## Q2 Reminder automation
- Nightly `OVERDUE_REMINDERS` under the scheduler leader lease. Per booking: open demands from definitions, days overdue = as_of − due_date. Thresholds (default 7/15/30) fire exactly once per (booking, threshold) — unique index `{booking_id, threshold}` on `reminders` makes a double send impossible even under a retry. 45 days → escalation flag + RM notification (no customer message).
- Document first, then message: Reminder letter PDF via docgen (deterministic, registered type Reminder, `message_id` linked), then the message carries a signed https link to that PDF (the managed email proxy does not carry attachments — recorded under "not done").
- Channel choice: customer preferred → next configured; consent respected; no contact → `skipped_no_contact` (explicit, visible in the log and the Reminder log report).
- Owner controls in Masters → Company → Reminders: enabled, thresholds, IST send window (default 10:00–18:00; the job defers outside it), channel order, CC RM. "Send reminder now" on a demand row / booking card uses the same function, with the real result in the toast.
- Side effects: Customer 360 timeline (audit on customer + booking), RM notification, Documents Register entry.

## Q3 VOID watermark
- `services/pdf.watermark(bytes, word, footer)` overlays every page: diagonal 60° word at 12 % alpha + footer line "Voided on <date> by <name> — reason". Deterministic (fixed creation date). Applied at download/preview/share of a voided register document; receipts/letters of cancelled/reversed records keep their existing word.

## Q4 Monthly trend sparklines
- `/api/trends?scope=company|project|customer&id=&months=12` → `months[]`, `collections`, `demands`, `outstanding_eom`, `bookings`. Series come from `monthly_buckets` (read model, one doc per scope × month), recomputed from source on change events via the read-model dirty flush and backfilled once by a watermarked migration; tie-out test: Σ collections == Collections report for the same range.
- Sparkline: tiny inline SVG (72×28), `<title>` for AT, hover tooltip "Mon YYYY · ₹", last point highlighted; click → report filtered to that month. Home tiles: Collected, Outstanding, Demands raised, Bookings. Customer 360 tiles: Udhar, Jama, Net balance.
