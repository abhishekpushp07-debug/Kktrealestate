All three front ends are now wired to every new or changed API capability, and the browser QA runs are clean. Every item in `docs/hardening/frontend-wiring.json` is either done or marked not applicable below. Typecheck passes for erp, web, portal and contracts; ERP and web builds and the portal web export pass. Nothing is committed.

**One mistake to fix first.** While formatting my new files I ran `prettier --write` on a list that also picked up 7 untracked files belonging to the API agent. The change is formatting only: the API still typechecks and none of those files' content changed meaningfully. No other agent was reachable to tell. The API agent should re-read these before their next edit:
- `apps/api/src/modules/money/services/ledgerRebuild.ts`
- `apps/api/src/seed/firstBoot.ts`
- `apps/api/test/integration/cross-track-money.test.ts`, `cross-track.test.ts`, `first-boot.test.ts`
- `apps/api/test/unit/cache.test.ts`, `logger-trace.test.ts`

## Results
| Check | Result |
|---|---|
| ERP unit tests | 158/158 (36 new) |
| Web unit tests | 16/16 (3 new) |
| Portal unit tests | 13/13 (5 new) |
| ERP full browser walk | 551 page checks, 164/164 assertions, 500 axe scans, 499 clean. Two defects, both handled (below) |
| ERP re-runs on the final build | crm 18/18, money + hardening 79/79, then roles + hardening + smoke on a fresh seed: 287 checks, 56/56, 0 defects, 236 axe scans with 0 serious/critical |
| Web full browser run | 145/145, 0 defects, 0 serious/critical |
| Portal browser run | 0 defects, 46 axe scans, 0 violations |

- **The two defects in the ERP full walk:**
  - A runner step still clicked the old "Verify / reject" KYC button; I updated the runner.
  - The known `target-size` axe finding on the cheques table while a toast covers it. It was already there after the frontend track and is unchanged.
- **Web first run:** it failed 6 checks only because Next.js was serving its disk cache from before a reseed, and earlier runs had used up a visit slot's seats. On a fresh seed with the cache cleared it is clean; no site code changed for this.
- **Lint:** my new files are lint-clean and touched files are back to their old error counts. ERP is at the 68-error baseline (I fixed the two errors my changes had added to `useBookingDraft.ts`), web stays at 16, portal at 25.
- **Cleanup:** servers on 4600, 5673, 3600 and 8681 are stopped. I used kkt_h6 and Redis 22 only.

## What I wired
**ERP**
- **New admin pages** (in a new `features/system/` folder, with sidebar entries and routes):
  - **Jobs** (`/admin/jobs`): last run, last success, failures, next run, Run now with a live run watcher, and recent runs with their errors. A duplicate run (409 `JOB_ALREADY_RUNNING`) says "already queued or running" and follows the existing run.
  - **System health** (`/admin/system`): versions, database and Redis status, and a summary parsed from `GET /metrics`.
  - **Backups** (`/admin/backups`, Super Admin only): create (optionally with secrets), status list, download link, restore instructions. The button is disabled while a backup is running.
  - **My exports** (`/exports`): status, error text and download.
- **"Export all" on list toolbars:** the CSV button gained a menu with a background export. Above 10,000 rows "Export all" becomes the main button, and a CSV cut at 10,000 rows offers it in its toast. Reports do the same. The 3-running-exports limit (429) has its own message.
- **Error messages:** one central table now explains every new error code and `FORBIDDEN` reason. Codes it doesn't know show the server's message. Error toasts and panels show the request id and trace id. Zod runs without JIT.
- **Customer 360:**
  - **Erase:** Super Admin types ERASE plus a reason; the record becomes read-only and co-applicant actions are hidden.
  - **KYC:** buttons follow the maker-checker rules, the submitter is shown, a missing-items list appears on 422, and changing a verified file needs a reason.
  - **Edits:** a warning when a PAN or Aadhaar change will reset KYC; co-applicant edits now send their version.
- **Customers list:** bulk portal enable runs a dry-run count first, then shows the one-time passwords with a CSV download, warns before closing without downloading, and reports how many failed.
- **Users page:** your own row offers "Change my password" instead of Reset and Deactivate.
- **Booking wizard:**
  - Picking a flat reserves it, with a 15-minute countdown, an Extend button and automatic extension while you work. Cancelling or leaving releases it.
  - The draft id is generated in the browser.
  - The agreement value is locked to the list price without `agreement.edit`; with it, a reason is required whenever the value differs.
  - A 422 `PRICE_DEVIATION_NOT_ALLOWED` refetches the flat and sends you back to that step.
- **Bookings and payments:**
  - Booking 360 shows the list price at booking and any price deviation with its reason.
  - The handover dialog lists unraised installments and the cash or account shortfall.
  - The reverse dialog warns when the booking is completed.
- **Other screens:**
  - The integrity panel explains the new missing-plan-stage finding.
  - The construction photo toggle sends its version.
  - Rescheduling a site visit shows the visitor's new link once.
  - Notification links for held flats and integrity alerts land on the right pages.

**Website:** the visit manage page shows until when its link works and lets the visitor change date or time themselves. After moving, it switches to the new link and keeps the confirmation, and handles the expired, slot-full and invalid-slot errors. I also fixed a colour-contrast failure on the selected slot chip.

**Portal:** errors show request and trace ids; a retired operation (410 `GONE`) asks for an app update; a 429 at sign-in shows a calm "try again in a moment"; any response marked `Deprecation` shows a dismissible "please update the app" notice. Other-charge bells already reach the Demands screen from the API, so nothing was needed there.

**QA runners and docs:**
- The ERP runner has a new `hardening` section; the smoke walk and the crm KYC and reschedule steps are updated.
- The web runner now reschedules a visit.
- The portal runner checks the update notice.
- `docs/qa/erp.md`, `web.md` and `portal.md` each have an "Integration stage" section, and the screenshots are refreshed.

## Not applicable
Deploy-only items (database grants, webhook payload, `x-sunset`), plus `Idempotent-Replayed`, which clients already treat like any other success.

## For the API agent and the integration stage
- **Version policy:** the ERP now sends `If-Match` on `PATCH /construction/photos/:id`, and never calls `PATCH /payment-plan-assignments/:id`, so both can come off the exemption list. The photo row's `version` is still optional in the contract; it should always be returned first. Item 13 of `docs/TODO-integration.md` should be updated; I didn't edit it because it is outside my paths.
- **Rescheduled visit links:** an old link returns 404 after a reschedule, not 410, because the token is rotated. The website treats either as "no longer works". Answering 410 for rotated tokens would match the documentation.
- **Portal bells:** demand and other-charge bells come back with `booking_id: null`; resolving it would let the portal switch to the right booking.
- **Undeclared dependencies:** the portal imports `zod` (it resolves through the hoisted install but isn't declared). It and `vitest` should be added to the portal's and website's dependencies; I installed nothing.
- **Already done by the API agent:** exposing the `X-Export-*` headers to the browser and the report-paging fix for exports. The ERP also works without them by falling back to the list's total.

**Contract shapes the ERP now relies on:**
- `POST /exports {path:"/api/v1/<list>", query}` → 202
- `POST /exports/:id/link` and `POST /admin/backups/:id/link` → `{download_url, expires_at, file_name, …}`
- `POST /admin/jobs/:name/run` → 202 `{run_id, …}`, or 409 with `details.run_id`
- `POST /customers/:id/erase {confirm:"ERASE", reason}`
- `POST /customers/:id/kyc {version, kyc_status, kyc_remarks, reason?}`
- `POST /flats/:id/reserve {minutes:15}` and `POST /flats/:id/release {reason}`
- `POST /public/site-visits/:token/reschedule {date, start, website:""}`