# 3I — noise actions × surfaces (connection-matrix cells, both servers)

Since 3I, reminder / letter / message / notification writes (`ttlcache._NOISE`: `reminder.*`, `document.generated`, `message.*`, `notification.*`) move **no** report stamp and mark **no** read model.
Every surface that shows them reads them live or through a stamp that its own action moves. Proved by `backend/tests/test_phase3i_noise_surfaces.py`: write on server A, read on server A **and** on a second backend process (B) on the same database, both caches warm beforehand.

| Action | Surface | How it stays right | A | B |
|---|---|---|---|---|
| Bill "reminder sent" (`demand.reminder_sent`) | Bills raised register → row `reminder_sent_at` | a demand action: moves the money + bills stamp | 🟢 | 🟢 |
| Letter / statement generated (`document.generated`) | Booking page "Letters & documents" (`/docgen/register?booking_id`) | read live (no cache) | 🟢 | 🟢 |
| Letter / statement generated | Customer 360 generated documents (`/customers/{id}/panels`) | read live (no cache) | 🟢 | 🟢 |
| Alert written by the overdue / reminder jobs | Notifications bell count + list | read live (no cache) | 🟢 | 🟢 |
| Lead follow-up (`lead.*`) | Call list "Last follow-up" | leads domain, which the Call list reads | 🟢 rule | 🟢 rule |
| any noise action | Payment behaviour | reads bills, ledgers, bounced receipts, waivers only — no reminder / letter / message field | 🟢 rule | 🟢 rule |

Automated reminders (`reminder.sent`) update `generated_documents.message_status` / messages, which the booking page and Customer 360 also read live.
