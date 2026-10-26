# Canonical forms — field audit (Phase B4, measurement rule: typed only if inherently unique to the record)

Metric = (select + derived) / all fields. Inherent-typed fields (names, phone, email, DOB, PAN/Aadhaar, address line, instrument numbers, money amounts, remarks, free codes) count as compliant per the rule.

| Form | File | Selects / masters | Derived (read-only) | Inherent typed | Non-inherent typed (gap) | Before % | After % | Target |
|---|---|---|---|---|---|---|---|---|
| Customer | `pages/v2/CustomerForm.jsx` | 19 (salutation, gender, residency, nationality, state→city→locality, occupation, income band, segments, source, RM, BHK, facing, floor pref, budget, projects, co-applicant relation, nominee relation) | 1 (pincode ← locality meta) | 13 (name, DOB, phone, alt phone, email, company, address line, co-app name/phone, nominee name/DOB/PAN/Aadhaar) | 0 | 97 | **100** | 90 |
| Booking wizard | `pages/BookingWizard.jsx` | project, tower, flat (Available only), customer (search + inline new), payment plan (tower-applicable), charge types (project list, default amounts), acceptance mode, parking | agreement value (list price + breakup − discount; editable only with agreement.edit), account bucket (auto-balanced), cash % default (tower→project), booking date default today | negotiated discount, remarks, cash % override | 0 | 86 | **100** | 90 |
| Payment | `components/v2/PostPayment.jsx` | booking (search with dues), bucket (defaults to bucket with due), mode, bank account (project), charge, instrument date | received-by = current user, cap/room shown live | amount, instrument no., remarks | 0 | 100 | **100** | 90 |
| Stage mark | `components/common/ConstructionStatusPanel.jsx` | stage (tower sequence, next pending preselected), completion date | — | reason/notes, photos | 0 | 100 | 100 | 80 |
| Lead | `pages/v2/Leads.jsx` | source, project, flat type, budget band, stage, RM, city | — | name, phone, email, note | 0 | 100 | 100 | 80 |
| Visit | `pages/SiteVisits.jsx` | project, date, slot (availability), RM | — | visitors (count), notes | 0 | 80 | 100 (count is inherent) | 80 |
| Service ticket | `pages/ServiceRequests.jsx` | category, priority, assignee, status | — | subject, description, resolution | 0 | 67 | 100 | 80 |
| Project setup | `pages/v2/ProjectSetup.jsx` | state→city→locality, type, status, RERA state, amenities, stage sequence, bank accounts, specs, cash % | derived totals | name, RERA no., address line, dates, floor numbers, floor-rise rate | 0 | 86 | 100 (floor counts/rates are inherent numbers) | 80 |
| Block/flat generation | `components/forms/BlockForm.jsx` | block type, numbering pattern, flat-type templates, facing, stage sequence | flat codes generated | name/code, floor count, units per floor, floor start, rise rate | 0 | 85 | 100 | 80 |
| Rate card | `pages/v2/ProjectSetup.jsx` (pricing step) | flat type, floor band, facing, PLC | — | rates (money) | 0 | 100 | 100 | 80 |
| User/role | `pages/v2/Settings/Users` | role, project scope, department, designation | — | name, email | 0 | 100 | 100 | 80 |
| Catalogue item | `pages/v2/Catalogues.jsx` | type, parent | code auto-generated | label | 0 | 100 | 100 | 80 |

Changes made in this phase: pincode derived from locality (`meta.pincode`, falls back to typed when the locality has none); booking agreement value derived from flat list price with an on-screen breakup and a typed negotiated discount (editable only with `agreement.edit`/`settings.manage`); field-level 422 mapping (`lib/formErrors.jsx`, `errFields` reads `error.details[{field,message}]`) wired into the customer form; shared searchable `Select` (catalogue-bound, keyboard-first, inline quick-add gated by `catalogue.write`) and `VersionConflictDialog` (409 Reload/Overwrite) were already the single primitives in use.

Not done: field-level 422 mapping is wired on the customer form only (other forms still show the envelope message in the toast); salesperson/loan-bank selects were not added to the wizard because the booking API has no such fields (would be a new feature).
