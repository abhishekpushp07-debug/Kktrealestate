# @kkt/portal — KKT customer portal (web + iOS + Android)

The buyers' app: each customer sees their flat, ledger, receipts, demands, schedule, construction photos,
documents and notices, and raises service requests. Built with Expo SDK 58 + expo-router, typed end-to-end
against `@kkt/contracts` (the `Portal*` schemas) and the fixed endpoint list in `docs/API-CONVENTIONS.md` Appendix C.

## Run

```bash
# from the repo root (pnpm workspace, node ≥ 22)
pnpm install

# environment (copy and edit)
cp apps/portal/.env.example apps/portal/.env
#   EXPO_PUBLIC_API_URL=http://localhost:4000      backend origin; the app talks to /api/v1/portal/*
#   EXPO_PUBLIC_ERP_URL=http://localhost:5173      "Staff? Go to ERP" link on the login screen

pnpm --filter @kkt/portal web        # web dev server (http://localhost:8081)
pnpm --filter @kkt/portal ios        # iOS simulator (Expo Go or a dev build)
pnpm --filter @kkt/portal android    # Android emulator / device
pnpm --filter @kkt/portal typecheck  # tsc --noEmit (strict, zero any)
pnpm --filter @kkt/portal build:web  # static export → apps/portal/dist (served by nginx in the Dockerfile)
pnpm --filter @kkt/portal generate:assets   # regenerates the navy/gold placeholder icon, splash and favicon PNGs
```

On a phone, point `EXPO_PUBLIC_API_URL` at a host the device can reach (your LAN IP, not `localhost`).
`EXPO_PUBLIC_*` variables are inlined at build time — restart the dev server after changing them.

## Structure

```
src/app/                 expo-router routes (file-based). Root _layout gates: login → change-password → (app)
  (app)/_layout.tsx      responsive shell: sidebar ≥ 1024 px, bottom tabs on phones (tab bar never covers content)
  (app)/{index,flat,payments,construction}.tsx   tab roots
  (app)/more/**          More hub + documents, requests, notices, notifications, profile, sessions, bank details
src/api/client.ts        the ONLY HTTP module: fetch, tokens (access in memory, refresh in SecureStore/localStorage),
                         single-flight refresh on 401 TOKEN_EXPIRED, Idempotency-Key on POST, error envelope → ApiError,
                         one typed function per Appendix C endpoint
src/api/queries.ts       TanStack Query hooks (keys scoped by booking id), AsyncStorage-persisted cache (7 days),
                         networkMode "offlineFirst" → cached screens render instantly, refresh in background
src/api/files(.web).tsx  signed PDF links: in-app viewer / new tab on web; download + share sheet on phones
                         (platform variants MUST share the default file's extension — Metro tries x.web.ts before x.ts
                         but x.ts before x.web.tsx — see metro.config.js)
src/auth/                AuthProvider (login with phone normalisation, lockout/rate-limit messages, must-change gate)
src/booking/             selected booking (persisted) for customers with several bookings
src/screens/             one component per screen
src/ui/                  design system: theme tokens, Text, Icon (drawn, no icon-font dependency), Button, Card, Chip,
                         Skeleton, States, Screen/Header, Field, Sheet, Toast, ProgressRing, SegmentedControl,
                         Money, Table, Markdown, ZoomableImage/Lightbox, Attachments, shell/ (Sidebar, TabBar, …)
src/lib/                 format (₹ Indian grouping, short forms, IST dates), storage, haptics, links, upload
```

## Fonts

Cormorant Garamond (display) and Manrope (body) load from Google Fonts on web (`src/app/+html.tsx`); native uses
Georgia/serif and the system sans. Swap the tokens in `src/ui/theme.ts` (`fonts.display` / `fonts.body`) once the
font files are bundled with `expo-font`.

## Builds (EAS)

```bash
npm i -g eas-cli && eas login
eas build:configure                       # creates eas.json (bundle ids are com.kkt.portal in app.json)
EXPO_PUBLIC_API_URL=https://api.example.in eas build --platform all --profile production
eas update --branch production            # OTA JS updates once expo-updates is added
```
Set `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_ERP_URL` as EAS environment variables for each profile. The web build is a
static export (`web.output: "static"`), deployed by `apps/portal/Dockerfile` behind nginx with an SPA fallback.

## Notes / assumptions about the API

* `GET /api/v1/portal/requests/categories` (not in Appendix C) is expected to return the active service-request
  categories (`{ id, name, default_priority }[]`, bare array or `{ items }`) so the "Raise a request" form can fill
  `category_id`. Priority is not part of `PortalRequestCreate` (strict object), so the form shows the category's
  default priority instead of sending one.
* Request photos are uploaded one per call to `POST /requests/:id/attachments` as multipart field `file`; on create
  the request is posted first (JSON, `attachment_ids: []`) and the photos follow with the text field `message_id` set to
  the opening message's id (so they show on the description bubble); on reply the uploads come first and their
  `document_id`s go into `attachment_ids`. Thread attachments carry `thumb_url` (grid) and `url` (full-size, for the viewer).
* `GET /auth/sessions` and `GET /bookings` are read as bare arrays, with `{ items }` tolerated.
* Lockout (423 `LOCKED`) reads `details.locked_until` when present; 429 reads the `Retry-After` header.
