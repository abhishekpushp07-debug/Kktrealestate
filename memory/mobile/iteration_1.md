# Mobile iteration 1 — KKT Home (Customer Portal)

## Web → mobile mapping
| Web route (frontend/src/apps/portal) | Mobile route | API |
|---|---|---|
| /portal/login (Login.jsx) | app/login.tsx | POST /auth/login, /auth/change-password, GET /config |
| / (Home.jsx) | app/(tabs)/index.tsx | /me, /bookings, /notices, /service-requests, statement.pdf |
| /flat/:id (Flat.jsx) | app/flat/[id].tsx | /bookings/{id}, allotment.pdf |
| /payments?tab= (Payments.jsx) | app/(tabs)/payments.tsx (?tab=receipts/ledger/demands/schedule/cheques) | /bookings/{id}/payments|demands|schedule|ledger, receipt.pdf, letter.pdf |
| bank tab | app/bank.tsx | /bank-details |
| /construction | app/(tabs)/construction.tsx | /bookings/{id}/construction, /api/public/media/photo/{id} |
| /documents | app/documents.tsx | /bookings/{id}/documents, …/download |
| /requests, /requests/:id | app/(tabs)/requests.tsx, app/requests/new.tsx, app/requests/[id].tsx | /service-requests, /service-categories, /reply, /reopen, /rate |
| /notices | app/notices/index.tsx, app/notices/[id].tsx | /notices, /notices/{id}/read |
| /profile | app/profile.tsx, app/change-password.tsx | /me GET/PATCH, /auth/logout, /auth/logout-all |
| /more | app/(tabs)/more.tsx | — |

## Decisions
- StyleSheet via `makeStyles` (theme.ts tokens), no NativeWind. Fonts: Manrope + Cormorant Garamond (subpath imports). Icons: @expo/vector-icons Feather.
- Auth gating with `Stack.Protected` (status in | out | pwchange | loading). Selected booking shared via ActiveBookingProvider (AsyncStorage key kkt_portal_booking).
- Custom tab bar uses expo-router v58 `BottomTabBarProps` (`navigateToTab(routeKey)` — no `navigation` prop in this version).
- Gesture-handler v3 hook API (usePinchGesture/usePanGesture/useTapGesture) for zoom.
- `Press` = Animated Pressable (style on the pressable). Avoid nesting Press inside Press (web nested <button> error).

## Dependencies added
expo-file-system, expo-sharing, expo-image-picker, react-native-svg, @expo/vector-icons, expo-application, expo-clipboard, @expo-google-fonts/manrope, @expo-google-fonts/cormorant-garamond

## Known issues / deferred
- No portal endpoint for SR attachment download (names only).
- No React Query disk persistence.
- Native verified by bundle compile only (no device in pod).
- Test ticket SR-2627-0008 created on BK-2526-0002 during QA.
