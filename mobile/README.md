# KKT Home — Customer Portal (Expo)

Buyer-facing app for the KKT real-estate ERP. One codebase for **web, iOS and Android** (Expo SDK 58, expo-router, TanStack Query). It talks only to the existing portal API at `${EXPO_PUBLIC_BACKEND_URL}/api/portal/*` — no backend code lives here.

## Environment

`/app/mobile/.env`

| Key | Purpose |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | Backend base URL, e.g. `https://royal-realty-hub-2.preview.emergentagent.com`. Every call goes to `${EXPO_PUBLIC_BACKEND_URL}/api/portal/...` |
| `EXPO_PACKAGER_HOSTNAME`, `EXPO_TUNNEL_SUBDOMAIN`, `EXPO_PACKAGER_PROXY_URL` | Preview tunnel settings (do not edit) |

Production: set `EXPO_PUBLIC_BACKEND_URL` to the API host (e.g. `https://api.kkt.in`) and add the web origin to the backend `CORS_ORIGINS`.

## Run

```bash
cd /app/mobile
yarn install                 # yarn only — never npm
yarn start                   # Metro on :3001 (supervisor already runs this in the preview pod)
yarn web                     # web in a browser
# Native: scan the QR code with Expo Go (iOS/Android), or build a dev client:
npx eas build --profile development --platform ios|android
```

Preview: https://royal-realty-hub-2.expo.preview.emergentagent.com — login with a seeded buyer, e.g. `9431012345` / `Buyer@12345` (two bookings) or `9431012346` (no booking).

## Build notes

- `app.json`: name **KKT Home**, ivory splash (`assets/images/splash-image.png`), navy/gold icon (`icon.png`, `adaptive-icon.png`, `favicon.png`). Bundle ids are unchanged from the scaffold — change `ios.bundleIdentifier` / `android.package` before store submission.
- Permissions: camera + photo library (expo-image-picker plugin, iOS `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`, Android `CAMERA`) — only used to attach photos to service requests.
- `eas build -p ios|android --profile production`; web: `npx expo export -p web` (static SPA in `dist/`, serve with SPA fallback to `index.html`).

## Architecture

```
app/                      expo-router routes
  _layout.tsx             fonts, providers, auth-gated Stack (Stack.Protected)
  login.tsx               sign-in + forced change-password
  (tabs)/                 Home · Payments · Construction · Requests · More (custom tab bar)
  flat/[id].tsx  documents.tsx  bank.tsx  profile.tsx  change-password.tsx
  notices/index.tsx  notices/[id].tsx  requests/new.tsx  requests/[id].tsx
src/
  api/client.ts           fetch wrapper, token store, silent refresh on 401, multipart helper
  api/pdf.ts              authenticated file opening per platform
  auth.tsx                AuthProvider (loading | out | pwchange | in)
  hooks.tsx               React Query hooks + shared active-booking selection
  format.ts               ₹ Indian grouping (₹1,00,00,000), short form (₹1.2 Cr / ₹45 L), dates
  theme.ts                ivory / navy / gold tokens, Manrope + Cormorant Garamond
  ui/                     design-system primitives (Card, Button, Chip, Pills, Skeleton, Lightbox, Markdown…)
  screens/                screen-specific components
```

### Auth & tokens
- `POST /auth/login {phone, password}` → access + refresh. Tokens are stored with `expo-secure-store` (Keychain / EncryptedSharedPreferences) on native and AsyncStorage (localStorage) on web, keys `kkt_portal_token` / `kkt_portal_refresh` (same as the web portal).
- `must_change_password` → the login screen switches to the forced change-password form using the 10-minute temp token (`POST /auth/change-password`).
- Any 401 triggers one shared `POST /auth/refresh` (rotation) and a retry; if refresh fails the user is signed out with a "session expired" toast.
- 423 → lockout message, 429 → "too many attempts".
- Logout: `/auth/logout` (this device) or `/auth/logout-all` (confirmation dialog); clears tokens, cached queries and the selected booking.

### Files
- **PDFs / documents (web):** in-app viewer modal (`src/ui/pdf-viewer.web.tsx`): bearer fetch → Blob → object URL shown in an iframe, or rendered with pdf.js (CDN, v3.11.174) when `navigator.pdfViewerEnabled` is false (Android Chrome, headless). Download = `<a download>`, Open in new tab = `<a target=_blank>`; error state with Retry; URLs revoked on close.
- **PDFs / documents (native):** `File.downloadFileAsync` (expo-file-system) into the cache with the `Authorization` header (retried once with a refreshed token) → `expo-sharing` share/preview sheet (Quick Look on iOS, chooser on Android).
- **Attachments:** expo-image-picker (camera on native, library everywhere; up to 5 photos, ≤ 8 MB) → multipart field `file` (repeated) via `expo/fetch` on native, browser fetch on web.

## Data / caching
React Query with 30 s stale time, 30 min in-memory cache, refetch on app foreground, pull-to-refresh on every list. No disk persistence (optional future work).
