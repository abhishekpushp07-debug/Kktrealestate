# 3I — background jobs at 1,500 bookings · duty cap 0.5 · one core (taskset 0)

| Job | Measured | Window | Inside? |
|---|---|---|---|
| OVERDUE_REMINDERS | 1513.4 s | 28,800 s — send window 10:00–18:00 IST; hourly loop | yes |
| DAILY_DUES | 5.2 s | 600 s — nightly budget (BUDGET_S) | yes |
| NIGHTLY_INTEGRITY | 4.0 s | 600 s — nightly budget (BUDGET_S) | yes |
| AUDIT_ARCHIVE | 0.1 s | 3,600 s — nightly slot, before the next job hour | yes |
| OVERDUE_NOTIFICATIONS | 0.0 s | 3,600 s — daily loop | yes |
| HOLD_EXPIRY_SWEEP | 0.0 s | 900 s — every 15 min | yes |
| MESSAGE_SEND | 0.0 s | 60 s — every minute | yes |
| SNAPSHOTS | 0.0 s | 60 s — read-model sweep every minute | yes |

## Two servers (6.0 min, 2 workers on one database) — scheduler lease owner: `agent-env-7e19496f-5cca-4a63-b4cd-232b17fee803:73208`

| Job | Runs | Owner processes | Overlapping runs |
|---|---|---|---|
| MESSAGE_SEND | 6 | agent-env-7e19496f-5cca-4a63-b4cd-232b17fee803:73208 | 0 |
