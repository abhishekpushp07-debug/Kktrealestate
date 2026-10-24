## B. Error code catalogue (generated)

Every error is `{detail, code, request_id}`; HTTP status is the first match in code. `VERSION_CONFLICT` (409) is returned when `version` in the body is stale (optimistic concurrency).

| Code | HTTP | Message (example) | Raised in |
|---|---|---|---|
| `ACCOUNT_LOCKED` | 423 | Account locked due to repeated failed attempts. Try again after {LOCK_MINUTES} minutes. | `routers/auth.py` |
| `ACTIVE_BOOKING` | 409 | Customer has an active or completed booking; erasure not allowed | `routers/admin.py` |
| `ALREADY_COMPLETED` | 409 | Stage already completed | `routers/construction.py` |
| `ALREADY_DEMANDED` | 409 | Charge already demanded | `routers/bookings.py` |
| `AREA_HIERARCHY` | 422 | Carpet area ({carpet}) cannot exceed built-up area ({builtup}) | `routers/master.py` |
| `BELOW_PAID` | 409 | Cash agreed cannot be below cash already received ({present_money({'x_paise': s.get('cash_ | `routers/bookings.py` |
| `BOOKING_NOT_ACTIVE` | 409 | Booking is {b['status']} | `routers/bookings.py` |
| `BUCKET_EXCEEDS_AGREED` | 409 | {category} bucket agreed {inr(agreed)}; already received {inr(paid)}; cannot accept {inr(a | `routers/payments.py` |
| `CANNOT_REOPEN` | 409 | Cannot reopen (only within 7 days of resolution) | `routers/portal.py` |
| `CHARGE_EXCEEDS_TOTAL` | 409 | {line['name']}: total {inr(line['total_paise'])}; already received {inr(paid)}; cannot acc | `routers/payments.py` |
| `CLOSED` | 409 | Ticket is closed | `routers/portal.py` |
| `DUPLICATE` | 409 | Slot {body.number} already exists | `routers/parking.py` |
| `DUPLICATE_CODE` | 409 | Block code {body.code} already exists in this project | `routers/blocks.py` |
| `DUPLICATE_EMAIL` | 409 | A user with this email already exists | `routers/users.py` |
| `DUPLICATE_NAME` | 409 | A role with this name already exists | `routers/roles.py` |
| `DUPLICATE_PAN` | 409 | PAN already registered to {dup['full_name']} ({dup['customer_code']}) | `routers/customers.py` |
| `DUPLICATE_PHONE` | 409 | Phone already registered to {dup['full_name']} ({dup['customer_code']}) | `routers/customers.py` |
| `DUPLICATE_SLUG` | 409 | Slug '{data['slug']}' already exists | `routers/cms.py` |
| `EMPTY_CSV` | 422 | CSV has no data rows | `routers/imports.py` |
| `FLATS_NOT_AVAILABLE` | 409 | Cannot change floor plans: {n} flat(s) are not Available | `routers/blocks.py` |
| `FLAT_HELD_BY_OTHER` | 409 | Flat {flat['flat_number']} is on Hold by another user | `routers/bookings.py` |
| `FLAT_NOT_AVAILABLE` | 409 | Flat {flat['flat_number']} is {flat['status']} | `routers/bookings.py` |
| `FLOOR_PLAN_GAP` | 422 | No floor plan range covers floor {f} | `routers/blocks.py` |
| `FORBIDDEN` | 403 | Missing permission: {permission} | `deps.py` |
| `GATE_DISABLED` | 409 | Brochure gate is disabled for this project | `routers/visits.py` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Idempotency-Key header is required when posting payments | `routers/payments.py` |
| `INSUFFICIENT_CASH` | 409 | Cash in hand on {body.date} is only ₹{available / 100:,.2f} | `routers/roznamcha.py` |
| `INVALID_AMENITY` | 400 | One or more amenities are invalid or inactive | `routers/projects.py` |
| `INVALID_AREA_TYPE` | 400 | One or more area types are invalid or inactive | `routers/master.py` |
| `INVALID_AUDIENCE` | 401 | Token not valid for ERP | `deps.py` |
| `INVALID_BANK_ACCOUNT` | 400 | Escrow bank account not found | `routers/projects.py` |
| `INVALID_BLOCK_TYPE` | 400 | Block type not found | `routers/blocks.py` |
| `INVALID_CHARGE_TYPE` | 400 | Unknown charge type | `routers/bookings.py` |
| `INVALID_CO_APPLICANT` | 400 | Unknown co-applicant customer | `routers/bookings.py` |
| `INVALID_CREDENTIALS` | 401 | Invalid phone or password | `routers/portal.py` |
| `INVALID_FLAT_TYPE` | 400 | One or more flat types are invalid | `routers/rate_cards.py` |
| `INVALID_FLOOR_PLAN` | 400 | One or more floor plan templates are invalid or inactive | `services/flat_generation.py` |
| `INVALID_MILESTONE_TEMPLATE` | 400 | Milestone template not found | `routers/blocks.py` |
| `INVALID_PLC_TYPE` | 400 | One or more PLC types are invalid | `routers/rate_cards.py` |
| `INVALID_POSITIONS` | 422 | position_flat_types must cover positions 1..N exactly once | `routers/blocks.py` |
| `INVALID_REFRESH_TOKEN` | 401 | Invalid refresh token | `routers/auth.py` |
| `INVALID_ROLE` | 400 | Role not found | `routers/users.py` |
| `INVALID_ROOM_TYPE` | 400 | One or more room types are invalid or inactive | `routers/master.py` |
| `INVALID_SCOPE` | 400 | One or more projects in scope do not exist | `routers/users.py` |
| `INVALID_SPEC_ITEM` | 400 | One or more specification items are invalid or inactive | `routers/master.py` |
| `INVALID_STATE` | 409 | Visit is already {v['status']} | `routers/visits.py` |
| `INVALID_TEAM` | 400 | One or more team members are invalid | `routers/projects.py` |
| `INVALID_TOKEN` | 401 | Invalid token | `deps.py` |
| `IN_USE` | 409 | Cannot deactivate: block has {n} flat(s) not Available | `routers/blocks.py` |
| `LAST_SUPER_ADMIN` | 409 | Cannot remove the last active Super Admin | `routers/users.py` |
| `LEAD_CONVERTED` | 409 | Converted leads cannot be moved | `routers/leads.py` |
| `LINK_EXPIRED` | 410 | This link has expired | `routers/visits.py` |
| `LOCKED` | 423 | Account locked. Try again later. | `routers/portal.py` |
| `MFA_ENABLED` | 409 | MFA is already enabled | `routers/auth.py` |
| `MFA_INVALID` | 401 | Invalid authentication code | `routers/auth.py` |
| `NOTHING_TO_UNDO` | 409 | No completed stage to undo | `routers/construction.py` |
| `NOT_ACTIVE` | 409 | Activate the rate card before applying | `routers/rate_cards.py` |
| `NOT_AVAILABLE` | 409 | Customer import becomes available in Phase 2 | `routers/imports.py` |
| `NOT_CLEARED` | 409 | Only cleared payments can be reversed (status {p['status']}) | `routers/payments.py` |
| `NOT_DRAFT` | 409 | Only Draft rate cards can be edited; create a new card to supersede | `routers/rate_cards.py` |
| `NOT_FOUND` | 404 | Project not found | `deps.py` |
| `NOT_PENDING` | 409 | Payment is {p['status']} | `routers/payments.py` |
| `NO_BROCHURE` | 404 | This project has no brochure yet | `routers/visits.py` |
| `NO_CHANGE` | 409 | Flat is already {body.status} | `routers/flats.py` |
| `NO_CHANGES` | 400 | No changes supplied | `routers/blocks.py` |
| `PARKING_NOT_AVAILABLE` | 409 | One or more parking slots are not available | `routers/bookings.py` |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Password change required | `routers/portal.py` |
| `PASSWORD_REUSED` | 422 | Password was used recently; choose one not among your last {PASSWORD_HISTORY} | `routers/auth.py` |
| `PAYLOAD_TOO_LARGE` | 413 | File exceeds 15 MB | `routers/documents.py` |
| `PENDING_PAYMENTS` | 409 | Clear or bounce pending cheques before cancelling | `routers/bookings.py` |
| `PLAN_LOCKED` | 409 | An installment demand already has a payment; plan cannot be changed | `routers/construction.py` |
| `PLAN_NOT_APPLICABLE` | 409 | Chosen payment plan is not assigned to this tower | `routers/bookings.py` |
| `PLAN_STAGES_MISSING` | 409 | Plan '{plan['name']}' needs stages missing from {block['name']}'s sequence: {', '.join(nam | `routers/construction.py` |
| `RATE_LIMITED` | 429 | Rate limit exceeded ({limit}/{window_s}s). Retry in {retry}s. | `deps.py` |
| `REFRESH_TOKEN_EXPIRED` | 401 | Refresh token expired | `routers/auth.py` |
| `REFRESH_TOKEN_REUSED` | 401 | Refresh token reuse detected; all sessions revoked | `routers/auth.py` |
| `REFUND_EXCEEDS_PAID` | 409 | Refund cannot exceed amount received | `routers/bookings.py` |
| `SELF_DEACTIVATE` | 409 | You cannot deactivate your own account | `routers/users.py` |
| `SENSITIVE_DOCUMENT` | 409 | Sensitive KYC documents cannot be shared with the portal | `routers/support.py` |
| `SEQUENCE_LOCKED` | 409 | Cannot change the sequence once stages are completed; undo them first | `routers/construction.py` |
| `SLOT_FULL` | 409 | This slot is now full — please pick another | `routers/visits.py` |
| `SLOT_UNAVAILABLE` | 409 | That slot is not available | `routers/visits.py` |
| `STATUS_LOCKED` | 409 | Allotted slots are controlled by the booking | `routers/parking.py` |
| `STATUS_NOT_MANUAL` | 409 | Status {body.status} is set by the booking engine and cannot be set manually | `routers/flats.py` |
| `STORAGE_ERROR` | 502 | Object storage upload failed: {e} | `routers/documents.py` |
| `SYSTEM_ROLE` | 409 | System roles cannot be renamed or deactivated | `routers/roles.py` |
| `TOKEN_EXPIRED` | 401 | Access token expired | `deps.py` |
| `TOKEN_REUSE` | 401 | Refresh token reuse detected; all sessions revoked | `routers/portal.py` |
| `TOO_MANY_ROWS` | 422 | Max 5000 rows per import | `routers/imports.py` |
| `UNAUTHENTICATED` | 401 | Not authenticated | `deps.py` |
| `UNDO_BLOCKED_BY_PAYMENTS` | 409 | A demand raised by this stage already has a payment; undo is blocked | `routers/construction.py` |
| `UNKNOWN_PARAM` | 400 | Unknown query parameter(s): {', '.join(unknown)}. Accepted: {', '.join(sorted(allowed))} | `routers/reports.py` |
| `UNSUPPORTED_MEDIA` | 422 | Only PDF, JPG, PNG or WEBP files are allowed | `routers/documents.py` |
| `USER_INACTIVE` | 401 | User inactive or not found | `deps.py` |
| `USE_CONVERT` | 409 | Use /convert to convert a lead | `routers/leads.py` |
| `VALIDATION_ERROR` | 422 | Consent is required | `routers/public.py` |
| `VERSION_CONFLICT` | 409 | {entity} was modified by someone else (current version {current.get('version') if current  | `utils.py` |
| `VISITS_DISABLED` | 409 | Site visits are not open for this project | `routers/visits.py` |