# Mobile iteration 5 — notifications
- Unit check of routing: `node /app/memory/mobile/notification_route_test.ts` (Node 24 strips types) → "9/9 assertions passed".
- Seed has 0 notifications; verified empty state + API wiring (unread-count 200, list 200) at 390 & 1280. Row rendering/mark-read/navigation not exercised live (no data).
- Notification target for demand/stage switches active booking via ActiveBookingProvider.select before navigating.
