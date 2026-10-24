# KKT Quality Audit — screenshots + per-page notes

Captured with Playwright (Chromium headless) at 1440x900 and 390x844 (mobile emulation). Timing: `visible` = navigation/action start → key selector visible; `idle` = → networkidle (500 ms no traffic; ERP polls notifications so idle is ~2.15 s floor on most pages). API timings = Playwright resource timing (responseEnd). Visual notes per page = AI vision review (Gemini 2.5 Flash) of each screenshot + automated DOM checks (horizontal overflow, broken images); vision notes are a punch-list starting point and may include false positives — items marked **[verified]** were confirmed via DOM.

## Headline metrics

| Metric | Value |
|---|---|
| ERP /erp/login cold load — total JS transferred | 886 KB (942 KB total page) |
| ERP app JS only (bundle.js + chunks, excl. Emergent/PostHog/Cloudflare tooling) | 454 KB — **served as unminified CRA dev `bundle.js` (dev server, not a production build)** |
| Marketing home total weight (cold, after full scroll) | 2.66 MB over 47 requests |
| Home by type | Document 68 KB, Script 1527 KB, Stylesheet 63 KB, XHR 2 KB, Fetch 14 KB, Font 116 KB, Image 931 KB |
| Home largest assets | bundle.js 544 KB; base.js 505 KB; photo-1545324418-cc1a3fa10c00?auto=format&fit=crop 343 KB; m=r78Drb 241 KB; photo-1613490493576-7fde63acd811?auto=format&fit=c 205 KB; m=root,base 172 KB |

ERP JS files on /erp/login:

- `beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092` — 10.2 KB
- `https://assets.emergent.sh/scripts/emergent-main.js` — 5.8 KB
- `2.preview.emergentagent.com/__emergent_overlay__/recorder.js` — 81.5 KB
- `l-realty-hub-2.preview.emergentagent.com/static/js/bundle.js` — 418.9 KB
- `https://ap.emergent.sh/static/array.js` — 104.7 KB
- `cgi/challenge-platform/h/b/scripts/jsd/d2d3316b729e/main.js?` — 11.0 KB
- `bell_js-node_modules_lucide-react_dist_esm_i-c7ff3c.chunk.js` — 98.4 KB
- `emergentagent.com/static/js/src_apps_erp_ErpApp_jsx.chunk.js` — 35.4 KB
- `y/phc_DbsPb39SRc8z3EiQ6Dhj6ikv4H4rTKcht9d4sZSesceP/config.js` — 1.5 KB
- `p.emergent.sh/static/1.438.21/web-vitals-with-attribution.js` — 7.3 KB
- `https://ap.emergent.sh/static/1.438.21/surveys.js` — 36.1 KB
- `://ap.emergent.sh/static/1.438.21/dead-clicks-autocapture.js` — 9.1 KB
- `https://ap.emergent.sh/static/1.438.21/posthog-recorder.js` — 65.8 KB

## Top punch list (objective, prioritized)

1. **Perf: production build not served.** ERP + marketing load CRA dev `bundle.js` (ERP 419 KB + 98 KB lucide chunk; marketing `site-assets/.../bundle.js` 544 KB) — unminified, no tree-shaking/code-splitting. Biggest single perf win.
2. **Perf: marketing home 2.7 MB**; YouTube embed iframe loads ~1 MB of player JS on first paint (base.js 505 KB + 2 more chunks) — use click-to-load facade. Unsplash hero images at w=1800 (343 KB, 205 KB) — serve WebP/AVIF and responsive srcset. Home visible-to-idle ≈5.7 s.
3. **Mobile (390px) page-level horizontal overflow [verified]:** Customer 360 (scrollWidth 662px), Customers list (407px), Booking wizard unit grid (425px). Marketing sticky bottom bar `A.btn-gold` (Enquire) overflows viewport on every marketing page.
4. **Mobile booking wizard is blocked [verified]:** at 390px after choosing a unit on step 2, `Next` (data-testid=wiz-next) could not be clicked within 30 s (unit grid overflows; button obscured/out of view) — step 3 not reachable on mobile in automation.
5. **ERP tables on mobile:** Projects, Bookings, Payments, Payment Plans, Reports, Ledger tables overflow their containers (internal scroll, no affordance); headers/values clipped (vision).
6. **Dashboard 'Due ageing' donut renders only its legend [verified: text is just '0-30 31-60 61-90 90+ Not due']** — looks broken; needs empty-state message or data. Outstanding & Ageing report donut does render (2 sectors).
7. **Tower A header shows raw pattern `pattern {block}-{floor}{pos2}` [verified]** — reads like an unrendered template to users; show an example (e.g. 'A-101').
8. **Marketing 'See the craftsmanship' video block** renders as a blank white card in headless screenshots (YouTube iframe) — HUMAN check in real browser; at minimum add a poster image.
9. **Marketing mobile: 'Why Shree Ganesh' feature icons render as '?' placeholders (vision, 390px)**; testimonial text clipped in cards; gallery on project page shows 2–3 empty white cards after 4 images (vision, both widths).
10. **Portal on desktop (1440px)** uses mobile bottom tab bar which overlaps last table row on Payments→Ledger; RN-web scroll containers mean full-page screenshots only capture the viewport (900px) — content below fold is inside inner scroll views.
11. **Consistent low-contrast** secondary text: ERP login demo-accounts strip, footer disclaimers on all marketing pages, portal secondary labels/dates, unit tiles with dark grey bg in wizard grid.
12. **Console:** no errors on any page. Only warning: `No available adapters.` (×1 on home, ×3 on project detail) — likely the YouTube/embed or a lib probe. No failed (>=400) network requests on any page.
13. Notification badge shows '27' and is offset/clipped on the bell icon across ERP pages (vision).

## Per-page notes

### erp_login
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/login
- Files: `erp_login_1440.png`, `erp_login_390.png`
- **Desktop:** visible 1058 ms / idle 1592 ms · API calls 0 · slowest — · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
- **Mobile 390:** visible 836 ms / idle 1358 ms · API calls 0 · slowest — · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   **Low-contrast text:** "DEMO ACCOUNTS · PASSWORD KKT@12345" text is illegible against its light grey background.
  *   **Inconsistent spacing:** Horizontal spacing between role tags ("Super Admin", "Project Admin", etc.) in the demo accounts section is inconsistent.
  *   **Misalignment:** The "Employee" role tag in the demo accounts section is horizontally misaligned/indented compared to the preceding line of tags.
  *   **Awkward background styling:** The light grey background block for the "DEMO ACCOUNTS" section lacks proper visual definition and integration with the surrounding white background.
  *   **Inconsistent internal spacing:** The arrows within the "Projects -> Blocks -> Flats" text (left feature box) are tightly spaced, appearing cramped.
  Overall: 6.5/10

- Visual review @390:

  *   **Low-contrast text**: "DEMO ACCOUNTS · PASSWORD KKT@12345" header text.
  *   **Low-contrast text**: Text within demo account role tags (e.g., "Super Admin", "Project Admin").
  *   **Information disclosure**: Password "KKT@12345" is explicitly displayed for demo accounts.
  Overall: 6/10


### erp_dashboard
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/dashboard
- Files: `erp_dashboard_1440.png`, `erp_dashboard_390.png`
- **Desktop:** visible 654 ms / idle 654 ms · API calls 6 · slowest POST auth/login 304 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 3371px
  - Top API timings: POST auth/login 304ms, GET notifications?limit=20 132ms, GET dashboard 129ms, GET dashboard/widgets 118ms, GET settings/company 68ms
- **Mobile 390:** visible 671 ms / idle 671 ms · API calls 6 · slowest POST auth/login 303 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 6804px
- Visual review @1440:

  Here are the concrete visible defects:
  *   **Search Bar:** Placeholder text "Search projects, flats, users..." is clipped.
  *   **Top Header:** "Welcome back" tooltip overlaps the search input field.
  *   **Collections - last 12 months Chart:** Y-axis labels (e.g., "₹1.2 Cr") are vertically truncated.
  *   **Inventory by status Chart:** Legend items "Sold 1" and "Blocked 2" have inconsistent tight spacing.
  *   **Due ageing Widget:** Chart area is entirely blank despite showing a legend.
  *   **Construction progress Widget:** "Villa Block P (Premium)" progress bar is 100% full, but text states "5/6 available", indicating a data/UI mismatch.
  *   **Blocks progress Widget:** "Villa Block P (Premium)" progress bar is 100% full, but text states "5 available out of 6 units", indicating a data/UI mismatch.
  *   **Recent activity Widget:** All list item timestamps (e.g., "24 Oct, 02:32 pm") are identical, indicating placeholder data.
  Overall: 6/10

- Visual review @390:

  *   **Clipped Text:** Y-axis labels in 'Units per project' graph, specifically '1' in '120' is partially obscured.
  *   **Truncated Data/Text:** 'VALUE' column in 'Inventory by project' table; numerical values and currency symbol (₹) are missing/clipped, only 'Cr' is visible or wrapped onto a new line.
  *   **Awkward Blank Area / Missing Data:** The 'Due ageing' card displays an entirely blank chart area, suggesting missing data or a broken visualization.
  *   **Awkward Blank Area:** The 'Sales velocity (bookings / month)' scatter plot has data points clustered centrally, leaving large empty margins within the chart's boundaries.
  *   **Low Contrast Text:** X-axis labels (e.g., '25-11', '26-03') in the 'Sales velocity' chart are small and blend with the background, impairing readability.
  *   **Inconsistent Spacing/Alignment:** In 'Blocks progress' cards, the descriptive text "X units · Y available · Z floors" shows inconsistent line wrapping and vertical alignment across different blocks.
  Overall: 7.5/10


### erp_projects
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/projects
- Files: `erp_projects_1440.png`, `erp_projects_390.png`
- **Desktop:** visible 1056 ms / idle 2155 ms · API calls 9 · slowest GET notifications?limit=20 138 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET notifications?limit=20 138ms, GET auth/me 131ms, GET settings/company 130ms, GET settings/company 119ms, GET notifications?limit=20 75ms
- **Mobile 390:** visible 1063 ms / idle 2168 ms · API calls 9 · slowest GET notifications?limit=20 153 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   **Clipped text:** The "Under Construction" status badge (row 2, STATUS column) shows the "Construction" text slightly clipped on the right.
  *   **Inconsistent styling:** The "HK" element within the global header search bar has sharp corners, contrasting with the rounded corners of the search bar input and other interactive elements like the "+ New project" button.
  *   **Low contrast:** The pagination arrow buttons (`<`, `>`) in the table footer have very low contrast borders/backgrounds, making them less distinct and harder to perceive as interactive elements.
  Overall: 8/10

- Visual review @390:

  *   Clipped text: Table header 'TYPE'.
  *   Clipped text: Table header 'STATUS'.
  *   Clipped text: 'Planning' status label for 'Ganesh Green Villas'.
  *   Clipped and awkwardly wrapped text: 'Under Construction' status label for 'Shree Ganesh Heights'.
  *   Horizontal overflow: Table content exceeds viewport width, causing content clipping.
  Overall: 5/10


### erp_project_SGH_detail
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/projects/e677b47c-8eff-4678-80d9-09f4412fc5b9
- Files: `erp_project_SGH_detail_1440.png`, `erp_project_SGH_detail_390.png`
- **Desktop:** visible 1709 ms / idle 2158 ms · API calls 11 · slowest GET notifications?limit=20 142 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 991px
  - Top API timings: GET notifications?limit=20 142ms, GET master/construction-stages?page_size=100 138ms, GET auth/me 125ms, GET settings/company 124ms, GET projects/e677b47c-8eff-4678-80d9-09f4412fc5b9 107ms
- **Mobile 390:** visible 1546 ms / idle 2170 ms · API calls 11 · slowest GET auth/me 214 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2177px
- Visual review @1440:

  - Notification badge '27' on bell icon slightly overlaps the icon's outline.
  - "INVENTORY VALUE" label in the top card is misaligned vertically compared to other card labels, resulting in inconsistent top/bottom padding.
  - 'ADDRESS' text second line ("Patna, Bihar, 801503") has tight line height, making it visually cramped with the 'PARKING' label below.
  - 'POSSESSION' tag text in 'Construction stage sequence' has low contrast against the white background.
  - 'POSSESSION' tag is slightly misaligned vertically with "9. Possession/Handover" text.
  Overall: 8/10

- Visual review @390:

  *   **Misalignment:** Numbers (3, 2) in 'HOLD' and 'BLOCKED' summary cards are not consistently left-aligned with other numbers in similar cards.
  *   **Horizontal scroll:** Navigation tabs ('Payment Plans', 'Inventory', 'Pricing', 'Parking') are clipped and extend beyond the viewport, causing a horizontal scroll.
  *   **Awkward large blank area:** Significant vertical empty space between the 'Fire NOC' approval card and the 'Team' heading.
  *   **Low-contrast text:** 'POSSESSION' label next to '9. Possession/Handover' in the 'Construction stage sequence' is very light yellow on a white background, making it hard to read.
  Overall: 7/10


### erp_towerA_inventory
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/blocks/05b195d4-402f-4f24-954e-988c9a7ec872
- Files: `erp_towerA_inventory_1440.png`, `erp_towerA_inventory_390.png`
- **Desktop:** visible 1535 ms / idle 2156 ms · API calls 11 · slowest GET notifications?limit=20 138 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1095px
  - Top API timings: GET notifications?limit=20 138ms, GET auth/me 134ms, GET settings/company 133ms, GET blocks/05b195d4-402f-4f24-954e-988c9a7ec872 88ms, GET blocks/05b195d4-402f-4f24-954e-988c9a7ec872/grid 76ms
- **Mobile 390:** visible 1250 ms / idle 2154 ms · API calls 11 · slowest GET notifications?limit=20 145 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2244px
- Visual review @1440:

  *   **Placeholder text:** Subtitle below "Tower A" displays `[block]-[floor] {pos2}` which appears to be unrendered variable/internal text.
  *   **Low-contrast text:** The number "4" in the "BOOKED" summary card is hard to read against the dark blue background.
  *   **Clipped text:** The letter "L" in currency values like "₹46.7 L" is consistently clipped at the bottom in multiple table cells (e.g., A-503, A-504, A-403).
  *   **Inconsistent spacing/alignment:** Content within table cells (text and diamond icon) shows inconsistent spacing and vertical alignment between 'dark' (selected) and 'light' (available) states (e.g., compare the layout of elements within A-801 vs A-802).
  Overall: 6.5/10

- Visual review @390:

  Here are the concrete visible defects:
  *   **Placeholder/Truncated Text:** "Tower A" subtitle: "{block}-{floor} {pos2}" contains placeholders and is truncated.
  *   **Truncated Text:** "Construction Status" button text is clipped.
  *   **Horizontal Overflow:** Floor grid (POS 3+) is clipped, indicating missing content or forcing horizontal scroll.
  *   **Low Contrast Text:** "Ctrl / click to multi-select Shift for range" text is difficult to read.
  *   **Missing Icon/Broken Character:** Command symbol (&#x2318;) next to "Ctrl" is not rendered correctly.
  *   **Misalignment:** Actions buttons below "Tower A" (e.g., "Print", "Construction Status") are vertically misaligned.
  *   **Inconsistent Spacing:** Vertical spacing between summary cards ("UNITS", "AVAILABLE", "HOLD", etc.) is not uniform.
  *   **Truncated Text:** "Block details" -> "Floor Plans" descriptions are truncated on the right.
  Overall: 4/10


### erp_bookings_list
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings
- Files: `erp_bookings_list_1440.png`, `erp_bookings_list_390.png`
- **Desktop:** visible 1033 ms / idle 2156 ms · API calls 9 · slowest GET settings/company 148 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 934px
  - Top API timings: GET settings/company 148ms, GET notifications?limit=20 139ms, GET auth/me 134ms, GET bookings?page=1&page_size=20&sort=-booking_date 106ms, GET notifications?limit=20 77ms
- **Mobile 390:** visible 1059 ms / idle 2160 ms · API calls 9 · slowest GET settings/company 194 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 934px
- Visual review @1440:

  Here are the visible defects:
  *   **Misalignment (Customer column):** Customer IDs (e.g., 'CUST-2526-0008') are inconsistently indented below the customer names.
  *   **Low-contrast text (Status badges):** Text in the 'Active' and 'Cancelled' status badges has low contrast against their background colors.
  *   **Inconsistent spacing (Table action icons):** The filter, list view, and download icons are tightly spaced next to the 'CSV' button.
  *   **Broken state (Pagination controls):** The left and right pagination arrows are enabled despite showing "page 1 of 1".
  *   **Misalignment (Search input row):** The search input field is slightly vertically misaligned with the adjacent filter and action icons.
  *   **Clipped icon (STATUS column header):** The sort/dropdown icon in the 'STATUS' column header is slightly clipped at its bottom edge.
  Overall: 8/10

- Visual review @390:

  *   **UNIT table header:** Missing sort icon, inconsistent with other column headers.
  *   **Last table row:** Incomplete data displayed, only "SGH" visible in the UNIT column, with other cells empty.
  *   **CSV button group:** Download icon is too close to the "CSV" text, creating inconsistent spacing.
  *   **Filter/Sort icon (left of CSV):** Low contrast, making it difficult to discern its function clearly.
  *   **Table right border:** Missing a visible right border, making the 'DATE' column appear uncontained.
  *   **Pagination arrows:** The `<` and `>` arrow icons are not vertically centered within their square button containers.
  *   **Pagination footer:** The text "10 records · page 1 of 1" is vertically misaligned with the pagination arrow controls.
  Overall: 6/10


### erp_payments_list
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/payments
- Files: `erp_payments_list_1440.png`, `erp_payments_list_390.png`
- **Desktop:** visible 1021 ms / idle 2150 ms · API calls 10 · slowest GET notifications?limit=20 144 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1121px
  - Top API timings: GET notifications?limit=20 144ms, GET settings/company 140ms, GET auth/me 132ms, GET payments?page=1&page_size=500&sort=-payment_date 90ms, GET notifications?limit=20 73ms
- **Mobile 390:** visible 1154 ms / idle 2189 ms · API calls 10 · slowest GET notifications?limit=20 239 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 1580px
- Visual review @1440:

  Here are the concrete visible defects:
  *   **CUSTOMER column:** Secondary text (e.g., "BK-2526-0002 SGH-A-201") is slightly misaligned to the left relative to the primary name above it.
  *   **TOWARDS column:** The "Legal Charges" badge appears wider and has inconsistent padding compared to other badges like "Account" or "Cash."
  *   **STATUS column:** Inconsistent styling, "Pending" uses a badge while "Cleared" uses plain text.
  *   **STATUS column (Row 1):** The "Clear" action text is vertically misaligned compared to the "Bounce" action text next to it.
  *   **STATUS column:** The action/detail icon (looks like an eye) is present next to "Cleared" statuses but is missing for the "Pending" status in the first row.
  *   **Pagination controls:** The arrow buttons at the bottom right appear to use default browser styles or an inconsistent component library compared to other icons on the page.
  Overall: 8/10

- Visual review @390:

  *   Page content overflows, causing a horizontal scrollbar at the bottom.
  *   Header description text "Only cleared payments count toward dues." is clipped on the right.
  *   "Cleared (Filtered)" label: "Filtered" text is clipped.
  *   "Cheques in hand" tab text is severely truncated ("Cheques in ha").
  *   Search bar placeholder "Receipt, customer, booking, UTR..." is clipped.
  *   Calendar icons within the date input fields are partially clipped.
  *   Table column header "TOW..." and associated content are truncated due to overflow.
  *   "CSV" text is vertically misaligned with its download icon.
  Overall: 4/10


### erp_reports
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/reports
- Files: `erp_reports_1440.png`, `erp_reports_390.png`
- **Desktop:** visible 1511 ms / idle 2157 ms · API calls 12 · slowest GET settings/company 171 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1100px
  - Top API timings: GET settings/company 171ms, GET notifications?limit=20 133ms, GET auth/me 127ms, GET settings/company 116ms, GET auth/me 114ms
- **Mobile 390:** visible 1558 ms / idle 2158 ms · API calls 12 · slowest GET settings/company 244 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2039px
- Visual review @1440:

  *   Notification count '27' is slightly misaligned (too high) relative to the bell icon in the top right header.
  *   Calendar icons in 'From' and 'To' date input fields are vertically misaligned (too low) relative to the input text.
  *   'Cleared' and 'month' filter dropdowns are vertically misaligned (slightly higher) with 'Presets...' button and 'Preset name' input field.
  *   Horizontal spacing between summary text elements below the graph (e.g., "Cash:...", "NEFT / RTGS:...") is inconsistent.
  *   'GST on charges: ₹77,850' text is awkwardly placed, orphaned below the summary cards without clear alignment or grouping.
  *   Y-axis labels on the graph (e.g., '₹1.2 Cr', '₹90 L') are not consistently aligned vertically with their corresponding grid lines.
  *   Clipped text: The total value '₹3,48,05,350' in the 'TOTAL' column of the final 'Total' row is horizontally clipped.
  *   Default browser styles: The 'mm/dd/yyyy' placeholder text in the date input fields appears to use a default browser style, clashing with other custom-styled inputs.
  Overall: 6/10

- Visual review @390:

  *   **Table Header:** "ACCOUN" text is clipped/truncated.
  *   **Table Data (last column):** Values in the last column are clipped/truncated (e.g., "₹4,00,00").
  *   **Table Total Row:** Last column total "₹2,04,25,00" is clipped/truncated.
  *   **Data Table:** Horizontal content overflow is present, not ideal for a 390px viewport.
  *   **Summary Statistics (below chart):** "GST on charges" pill is vertically misaligned and too close to the "UPI" text.
  *   **Summary Statistics (below chart):** Inconsistent vertical spacing between text lines (e.g., between "NEFT / RTGS" and "Loan Disbursement").
  Overall: 6/10


### erp_report_outstanding
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/reports/outstanding
- Files: `erp_report_outstanding_1440.png`, `erp_report_outstanding_390.png`
- **Desktop:** visible 1536 ms / idle 2156 ms · API calls 12 · slowest GET settings/company 183 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1477px
  - Top API timings: GET settings/company 183ms, GET notifications?limit=20 143ms, GET auth/me 136ms, GET settings/company 118ms, GET settings/company 82ms
- **Mobile 390:** visible 1603 ms / idle 2169 ms · API calls 12 · slowest GET settings/company 192 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2124px
- Visual review @1440:

  *   **Empty Chart State:** The main donut chart in the center is completely empty, despite having a legend.
  *   **Table Text Wrapping:** Text in the 'UNIT' column (e.g., 'SGH A-A-201') and table headers ('ACCOUNT DUE', 'CHARGES DUE') wraps to multiple lines, making cells vertically oversized.
  *   **Horizontal Table Scrollbar:** A horizontal scrollbar is present on the main data table, indicating content overflow.
  *   **Misaligned Total Row:** Numerical values in the 'Total' row at the bottom of the table are not consistently right-aligned with their respective columns above.
  *   **Low Contrast Text:** The subtitle "Server-side aggregations with CSV / PDF export and saved presets." below the main title has poor contrast against the background.
  *   **Wrapped User Name:** The user name "Rajesh Kumar" in the top-right user profile is wrapped onto two lines.
  *   **Vertical Misalignment (Top Control Bar):** Dropdowns ("All projects", "customer", "Presets") are vertically misaligned with the input field ("Preset name") and action buttons (CSV, PDF, Print).
  *   **Awkward Blank Area (Top Overdue):** The right side of the "Top overdue customers" section appears sparsely populated, leaving a large, awkward blank area.
  Overall: 6/10

- Visual review @390:

  *   **Wrong mobile layout:** Left sidebar is fully open, consuming significant screen real estate, causing main content to be compressed into a very narrow column unsuitable for a 390px viewport.
  *   **Clipped text:** Table 'RAISED' column monetary values (e.g., '₹1,00,00,000', '₹82,50,000') are clipped on the right edge.
  *   **Clipped text:** 'Total' amount in the table footer ('₹3,52,35,000') is clipped on the right edge.
  *   **Awkward wrapping:** Table 'UNIT' column values (e.g., 'SGH B-B-301', 'SGH C-C-301') excessively wrap onto multiple lines due to insufficient column width in the narrow viewport.
  *   **Low-contrast text:** Donut chart legend colors for age groups (0-30, 31-60, 61-90, 90+) are too similar, hindering differentiation and accessibility.
  *   **Low-contrast text:** 'Top overdue customers' tags (red text on light pink background) may fail accessibility contrast ratio requirements.
  Overall: 3/10


### erp_master_payment_plans
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/master/payment-plans
- Files: `erp_master_payment_plans_1440.png`, `erp_master_payment_plans_390.png`
- **Desktop:** visible 1075 ms / idle 2154 ms · API calls 9 · slowest GET notifications?limit=20 134 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET notifications?limit=20 134ms, GET auth/me 128ms, GET settings/company 128ms, GET settings/company 112ms, GET master/payment-plans?page=1&page_size=20&sort=name 77ms
- **Mobile 390:** visible 1197 ms / idle 2170 ms · API calls 9 · slowest GET notifications?limit=20 391 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 1071px
- Visual review @1440:

  *   **Clipped Text:** All entries in the 'INSTALLMENTS' table column are horizontally truncated.
  *   **Inconsistent Spacing/Overflow:** Filter buttons (e.g., "Flat Types", "Room Types", "Area Types", "Block Types", "Amenities", "Construction Stages") are poorly laid out, clashing with the "New Payment Plan" button and creating a visually separated second row ("Payment Modes", "Bank Accounts", "Document Types").
  *   **Inconsistent Spacing:** The 'Edit' (pencil) and 'Delete' (cross) icons in the table's last column are too close to the 'STATUS' content and each other.
  *   **Awkward Large Blank Area:** There is a significant empty space below the table, reducing content density.
  *   **Misalignment:** The 'INSTALLMENTS' table header text is slightly left-aligned compared to the content of its cells below.
  *   **Misalignment:** The sidebar collapse/expand arrow icon at the bottom left is positioned too close to the bottom edge of the sidebar.
  Overall: 6/10

- Visual review @390:

  *   **Clipped text:** Description "Canonical reference data. Structural entities always reference these by id." is clipped on the right side.
  *   **Clipped table header:** Table column header "INS" is truncated.
  *   **Clipped table content:** All values in the last table column (e.g., "109%", "5%") are clipped/truncated.
  *   **Implied horizontal overflow:** The table content is clipped on the right without a visible horizontal scrollbar, indicating an overflow issue.
  *   **Ambiguous icon:** The icon button between "Show inactive" and "CSV" lacks a clear label or tooltip, making its function unclear.
  *   **Misaligned elements:** The text "4 records · page 1 of 1" is vertically misaligned with the adjacent pagination arrow buttons.
  *   **Low-contrast text:** The pagination text "4 records · page 1 of 1" has low contrast against its background.
  Overall: 4/10


### erp_customers
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/customers
- Files: `erp_customers_1440.png`, `erp_customers_390.png`
- **Desktop:** visible 1157 ms / idle 2155 ms · API calls 9 · slowest GET notifications?limit=20 134 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 934px
  - Top API timings: GET notifications?limit=20 134ms, GET settings/company 130ms, GET auth/me 129ms, GET settings/company 112ms, GET customers?page=1&page_size=20&sort=-created_at 76ms
- **Mobile 390:** visible 1044 ms / idle 2155 ms · API calls 9 · slowest GET settings/company 177 ms · console err/warn 0 · page scrollWidth 407 (viewport 390) · page height 934px
  - **[verified] page-level horizontal overflow at 390px** (scrollWidth 407); overflowing: ['DIV.flex gap-2', 'BUTTON.inline-flex items-center justify-center gap-2 whitesp', 'TABLE.w-full text-sm', 'THEAD.sticky top-0 z-10 bg-slate-50/95 backdrop-blur', 'TR.border-b border-slate-200', 'TH.whitespace-nowrap px-4 py-2.5 text-left label-xs cursor-p']
- Visual review @1440:

  *   **Clipped text:** "Enable portal for active buyers" button text is too close to the right edge.
  *   **Misalignment:** In the `CUSTOMER` column, email addresses are horizontally indented relative to customer names.
  *   **Low-contrast text:** Email addresses in the `CUSTOMER` column (e.g., `ravi.sp@example.com`).
  *   **Misalignment:** `KYC` column 'Pending' and 'Submitted' badge text is horizontally off-center within the badge.
  *   **Misalignment:** Top header 'HK' icon button is vertically misaligned with the adjacent search input field.
  *   **Misalignment:** Table header sort icons (e.g., `CODE ↑↓`, `CUSTOMER ↑↓`) are vertically misaligned with their column titles.
  Overall: 7/10

- Visual review @390:

  *   **Clipped text**: "PHONE" column header is truncated on the right.
  *   **Clipped text**: Phone numbers in the 'PHONE' column are all truncated on the right.
  *   **Clipped text**: 'CODE' values in the first column (e.g., "CUST-") are truncated.
  *   **Misalignment**: Notification badge '27' overlaps the top edge of the bell icon.
  *   **Inconsistent spacing**: The left margin of the hamburger menu icon is narrower than the left margin of the 'Customers' title and the table content below.
  *   **Low-contrast text**: Pagination arrows ('<' and '>') are light grey on a white background, potentially failing accessibility.
  *   **Wrong mobile layout**: The table content is truncated horizontally (specifically 'CODE' and 'PHONE' columns), forcing a hidden horizontal scroll or poor readability of essential data on a mobile viewport.
  Overall: 4/10


### erp_customer360
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/customers/1c179390-185a-44fa-aed2-a34a4a398ada
- Files: `erp_customer360_1440.png`, `erp_customer360_390.png`
- **Desktop:** visible 1518 ms / idle 2160 ms · API calls 17 · slowest GET customers/1c179390-185a-44fa-aed2-a34a4a398ada/portal 166 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1061px
  - Top API timings: GET customers/1c179390-185a-44fa-aed2-a34a4a398ada/portal 166ms, GET customers/1c179390-185a-44fa-aed2-a34a4a398ada/payments 159ms, GET notifications?limit=20 155ms, GET customers/1c179390-185a-44fa-aed2-a34a4a398ada 155ms, GET customers/1c179390-185a-44fa-aed2-a34a4a398ada/payments 145ms
- **Mobile 390:** visible 1032 ms / idle 1567 ms · API calls 17 · slowest GET settings/company 220 ms · console err/warn 0 · page scrollWidth 662 (viewport 390) · page height 1797px
  - **[verified] page-level horizontal overflow at 390px** (scrollWidth 662); overflowing: ['DIV.lg:col-span-3', 'DIV.card-elev p-5', 'DIV.mb-3 flex items-center gap-2', 'SPAN.ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ', 'DL.grid grid-cols-2 gap-2 text-xs text-slate-600', 'DD.font-mono text-navy']
- Visual review @1440:

  *   **Misalignment**: 'AGREEMENT VALUE' amount (`₹68,00,000`) is left-aligned, not centered within its card like the other info cards.
  *   **Misalignment**: Values (`9431067890`, `24 Oct, 02:32 pm`, `3`, `No`) under 'Customer portal access' are vertically misaligned (shifted upwards) with their corresponding labels.
  *   **Clipped text**: 'Login link' URL under 'Customer portal access' is truncated (`...emergentagent.com`).
  *   **Broken/empty state**: 'OCCUPATION', 'SERVICE', and 'COMPANY' fields under 'Personal' section display missing data with a single dash or awkward large blank areas instead of explicit "N/A" or "Not provided".
  *   **Low-contrast text**: Labels 'OCCUPATION', 'SERVICE', 'COMPANY' under 'Personal' section are light grey, making them difficult to read.
  *   **Inconsistent spacing**: Vertical spacing between 'Must change password' and 'Login link', and between the login link and the action buttons ('Reset password', 'Disable', 'Revoke sessions') in 'Customer portal access' appears cramped.
  Overall: 7/10

- Visual review @390:

  *   **Clipped/truncated text:** "Login link" URL in "Customer portal access" section is severely truncated.
  *   **Wrong mobile layout:** Tabs ("Documents", "Leads", "History") wrap onto a second line instead of displaying horizontally.
  *   **Missing icon:** Placeholder square icon visible next to the "Customer portal access" title.
  *   **Misalignment:** "Share login link" text in "Customer portal access" wraps, pushing its copy icon to a new line.
  *   **Low-contrast text:** "KYC Submitted" button text (white) on the yellow background has insufficient contrast (WCAG AA failure).
  *   **Misalignment:** Notification badge ('27') is slightly off-center over the bell icon in the top right header.
  Overall: 6/10


### erp_booking_BK0001_ledger
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings/473d1218-3478-42f9-bb10-3de2ccdae62f
- Files: `erp_booking_BK0001_ledger_1440.png`, `erp_booking_BK0001_ledger_390.png`
- **Desktop:** visible 1637 ms / idle 1638 ms · API calls 12 · slowest GET bookings/473d1218-3478-42f9-bb10-3de2ccdae62f/ledger 152 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1504px
  - Top API timings: GET bookings/473d1218-3478-42f9-bb10-3de2ccdae62f/ledger 152ms, GET notifications?limit=20 149ms, GET bookings/473d1218-3478-42f9-bb10-3de2ccdae62f 147ms, GET auth/me 140ms, GET settings/company 140ms
- **Mobile 390:** visible 1648 ms / idle 1649 ms · API calls 12 · slowest GET settings/company 176 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2098px
- Visual review @1440:

  *   **Clipped text:** Subtitle "Pl (4BHK-VILLA) · booked 01 Nov 2025" is truncated below the main booking ID.
  *   **Clipped text:** Table column headers "CONSTR. %", "CASH ORDER RAISED", "ACCOUNT ORDER RAISED", "CASH DUE", "ACCOUNT DUE", "TOTAL DUE" are truncated.
  *   **Horizontal scroll:** A horizontal scrollbar is present at the bottom of the table, indicating content overflow.
  *   **Misalignment/Overlapping text:** In the table, the "(advance)" text in the "ACCOUNT DUE" column overlaps or is poorly aligned with the numerical value (e.g., rows 6, 8, 12, 14, 16, 18, 19).
  *   **Inconsistent styling:** The value `₹0` is inconsistently styled (bold vs. regular font weight) across different columns in the table (e.g., "TOTAL DUE" column vs. "CASH PAID (CUM)" column).
  Overall: 6/10

- Visual review @390:

  Here are the visible defects:
  *   **Clipped Text:** Booking details description, "booked 01 Nov 2025" is clipped at the end.
  *   **Overlap:** "no pending cheques" text is partially obscured by the top header bar.
  *   **Misalignment:** Icons within "Statement PDF" and "Allotment letter" buttons are vertically misaligned with their text.
  *   **Inconsistent Layout:** "Revisions" and "History" sub-tabs are detached and misaligned from other sub-tabs ("Payments", "Charges", "Documents").
  *   **Clipped Header Text:** Table column headers "CONSTR. %" and "CATEGORY" are clipped.
  *   **Missing Data/Overflow:** The final column of the ledger table (likely 'Amount') is entirely missing, indicating severe data truncation or a missing horizontal scroll.
  Overall: 4/10


### erp_wizard_step1
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings/new
- Files: `erp_wizard_step1_1440.png`, `erp_wizard_step1_390.png`
- **Desktop:** visible 1005 ms / idle 2146 ms · API calls 11 · slowest GET notifications?limit=20 140 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET notifications?limit=20 140ms, GET settings/company 140ms, GET auth/me 129ms, GET settings/company 127ms, GET projects?page_size=50 80ms
- **Mobile 390:** visible 1019 ms / idle 2157 ms · API calls 11 · slowest GET notifications?limit=20 144 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  Here are the visible defects:
  *   **Clipped text:** Notification badge '27' on the bell icon in the header is partially clipped at the top-right.
  *   **Default browser style/Hidden element:** A default browser scrollbar is visible on the sidebar, and an arrow icon at the very bottom of the sidebar is almost entirely hidden.
  *   **Misalignment:** Dropdown arrow icons in the "Project" and "Block" input fields are vertically misaligned with the "Select..." placeholder text.
  *   **Misalignment:** Arrow icons within the "Back" and "Next" buttons are vertically misaligned with their respective text labels.
  Overall: 7.5/10

- Visual review @390:

  *   **Clipped/truncated text**: Description text "demands." under "New booking" is cut off on the right.
  *   **Inconsistent spacing**: Vertical spacing between wizard step pills is too tight (e.g., between "3 Customer" and "4 Agreement").
  *   **Awkward layout**: Wizard step pills (e.g., "6 Charges & Parking", "7 Review") wrap onto a new line too aggressively, creating an inefficient vertical layout for steps.
  *   **Misalignment**: 'Back' button text is vertically misaligned with 'Next' button text (text in 'Back' button appears higher).
  *   **Awkward large blank area**: Significant unused vertical space at the bottom of the white content card.
  Overall: 5/10


### erp_wizard_step2_grid
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings/new
- Files: `erp_wizard_step2_grid_1440.png`, `erp_wizard_step2_grid_390.png`
- **Desktop:** visible 2054 ms / idle 2054 ms · API calls 4 · slowest GET parking?project_id=e677b47c-8eff-4678-80d9-09f4412fc5b9&page_size=100 104 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET parking?project_id=e677b47c-8eff-4678-80d9-09f4412fc5b9&page_size=100 104ms, GET blocks/05b195d4-402f-4f24-954e-988c9a7ec872/grid 90ms, GET projects/e677b47c-8eff-4678-80d9-09f4412fc5b9/blocks/05b195d4-402f-4f24-954e-988c9a7ec872/ 79ms, GET blocks?project_id=e677b47c-8eff-4678-80d9-09f4412fc5b9&page_size=50 74ms
- **Mobile 390:** visible 2060 ms / idle 2060 ms · API calls 4 · slowest GET parking?project_id=e677b47c-8eff-4678-80d9-09f4412fc5b9&page_size=100 81 ms · console err/warn 0 · page scrollWidth 425 (viewport 390) · page height 1059px
  - **[verified] page-level horizontal overflow at 390px** (scrollWidth 425); overflowing: ['BUTTON.min-w-[88px] rounded-md border px-2 py-1.5 text-left ', 'P.font-semibold', 'P.text-[10px] opacity-80']
- Visual review @1440:

  - Clipped text: Top right notification badge number '27'.
  - Default browser styles: Left navigation scrollbar.
  - Inconsistent/incorrect data formatting: Unit price values (e.g., `₹63.43.750`) use non-standard and confusing dot separators.
  - Low-contrast text: Unit A-503 text ("3BHK-A ₹46.72.500") on grey background.
  - Low-contrast text: Unit A-201 text ("3BHK-A ₹66.33.750") on grey background.
  Overall: 5/10

- Visual review @390:

  *   **Clipped Content:** The unit selection grid is horizontally clipped on the right side, cutting off content (e.g., the full width of A-x04 units). No horizontal scrollbar is available to access the hidden content. (Location: Right edge of the unit grid)
  *   **Low-contrast Text:** Unit type and price text (e.g., "3BHK-A", "₹66,33,750") on dark gray background units (e.g., A-201, A-302, A-402, A-503) has insufficient contrast, making it difficult to read. (Location: Dark gray unit cards in the grid)
  *   **Inconsistent/Low-contrast Border:** The 'A-101' unit card has a yellow background and a yellow border, which blends into the background and lacks visual distinction compared to other unit cards' borders. (Location: Unit card A-101)
  *   **Misalignment:** The row numbers (1 through 8) on the left of the unit grid are top-aligned with the first unit in their respective row, instead of being vertically centered to the entire row of unit cards. (Location: Row numbers 1-8)
  Overall: 6/10


### erp_wizard_step3_customer
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings/new
- Files: `erp_wizard_step3_customer_1440.png`, `erp_wizard_step3_customer_390.png`
- **Desktop:** visible 118 ms / idle 118 ms · API calls 0 · slowest — · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
- **Mobile 390:** visible None ms / idle None ms · API calls 1 · slowest GET notifications?limit=20 74 ms · console err/warn 1 · page scrollWidth 425 (viewport 390) · page height 1059px
  - Console/script (390): script: Page.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator("[data-testid=wiz-next]")
    - locator resolved to <button x-column="22" x-dynamic="false" x-line-number="117" x-component="But
  - **[verified] page-level horizontal overflow at 390px** (scrollWidth 425); overflowing: ['BUTTON.min-w-[88px] rounded-md border px-2 py-1.5 text-left ', 'P.font-semibold', 'P.text-[10px] opacity-80']
- Visual review @1440:

  *   **Awkward large blank area/Empty-looking state:** The main content card for Step 3 (Customer) is largely empty below the search input, lacking any visual elements for customer display, selection, or explicit guidance for adding/selecting a customer.
  *   **Misalignment:** The collapse/expand arrow icon at the bottom of the left sidebar is positioned too close to the bottom edge.
  *   **Low-contrast text/Small text:** The '27' notification count within the bell icon's badge is quite small and has relatively low contrast against its orange background, potentially affecting legibility.
  Overall: 6/10

- Visual review @390:

  *   **Clipped Text:** "Unit" in "2 Unit" wizard step.
  *   **Clipped Text:** "Parking" in "6 Charges & Parking" wizard step.
  *   **Misalignment:** Notification badge '27' is too far right from the bell icon.
  *   **Low-Contrast Text:** Unit details (type, price) inside dark grey unit boxes (e.g., A-201, A-301, A-402) are illegible.
  *   **Clipped Text (Minor):** Price text in all unit boxes is consistently too close to or slightly touching the bottom border.
  *   **Inconsistent Formatting:** Price values use inconsistent thousands/decimal separators (e.g., A-803 uses '.' while A-802 uses ',').
  *   **Vertical Scrollbar:** Visible scrollbar on the right side of the main content area.
  *   **Inconsistent Spacing:** Horizontal spacing between wizard step buttons (e.g., "3 Customer" and "4 Agreement" vs "4 Agreement" and "5 Payment Plan").
  Overall: 6/10


### erp_wizard_step3_search
URL: https://royal-realty-hub-2.preview.emergentagent.com/erp/bookings/new
- Files: `erp_wizard_step3_search_1440.png`, `erp_wizard_step3_search_390.png`
- **Desktop:** visible 1514 ms / idle 1514 ms · API calls 1 · slowest GET customers?search=Amit&page_size=8 84 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET customers?search=Amit&page_size=8 84ms
- **Mobile 390:** visible None ms / idle None ms · API calls 1 · slowest GET notifications?limit=20 176 ms · console err/warn 1 · page scrollWidth 425 (viewport 390) · page height 1059px
  - Console/script (390): script: Page.fill: Timeout 30000ms exceeded.
Call log:
  - waiting for locator("[data-testid=wiz-customer-search]")

  - **[verified] page-level horizontal overflow at 390px** (scrollWidth 425); overflowing: ['BUTTON.min-w-[88px] rounded-md border px-2 py-1.5 text-left ', 'P.font-semibold', 'P.text-[10px] opacity-80']
- Visual review @1440:

  *   **Awkward large blank area:** Below the "Mr Amit Kumar Sinha" customer details card.
  *   **Default browser scrollbar:** Visible at the bottom of the left navigation sidebar.
  *   **Misalignment:** The "+ New customer" button is vertically misaligned with the "Amit" input field.
  Overall: 8/10

- Visual review @390:

  *   **Clipped element:** Notification badge (27) is partially clipped at the top right.
  *   **Inconsistent spacing:** Stepper navigation items (1 Project & Block, 2 Unit, 3 Customer) have uneven horizontal spacing.
  *   **Misalignment:** "3 Customer" stepper item is pushed too close to the right edge.
  *   **Low-contrast text:** Text (e.g., "3BHK-A", price) within dark grey unit tiles (e.g., A-503, A-402, A-302, A-201) has insufficient contrast with its background.
  Overall: 6.5/10


### mkt_home
URL: https://royal-realty-hub-2.preview.emergentagent.com/
- Files: `mkt_home_1440.png`, `mkt_home_390.png`
- **Desktop:** visible 5799 ms / idle 5799 ms · API calls 8 · slowest GET public/published-projects 118 ms · console err/warn 1 · page scrollWidth 1440 (viewport 1440) · page height 7230px
  - Top API timings: GET public/published-projects 118ms, GET public/home 104ms, GET public/flat-types 104ms, GET public/site 101ms, GET public/flat-types 95ms
- **Mobile 390:** visible 5659 ms / idle 5659 ms · API calls 8 · slowest GET public/flat-types 143 ms · console err/warn 1 · page scrollWidth 390 (viewport 390) · page height 11746px
  - Console/script (1440): warning: No available adapters.
  - Console/script (390): warning: No available adapters.
- Visual review @1440:

  *   **Broken state:** Large blank area present under 'See the craftsmanship' heading where a visual element is expected.
  *   **Clipped text:** 'Updates & insights' section, 2nd article description is truncated ("...familly befor...").
  *   **Unclear text:** 'Our Projects' section, 'Shree Ganesh Heights' card, the 'L' in "Starting ₹44 L" is too small/unreadable.
  *   **Misalignment:** 'The people behind the promise' section, employee cards: job titles are center-aligned, but descriptions are left-aligned.
  *   **Inconsistent spacing:** 'Book a private site visit' section: left content (heading/description) is vertically misaligned with the contact form on the right.
  *   **Low-contrast text:** Footer disclaimer and copyright text are very small and have insufficient contrast against the background.
  Overall: 7/10

- Visual review @390:

  Here are the visible defects:
  *   **Clipped Element**: "ENQUIRER" button in the bottom navigation bar is partially clipped.
  *   **Broken/Missing Icons**: Placeholder question mark icons are displayed for all four features (RERA-registered, On-time, Transparent pricing, Thoughtful design) in the "Why Shree Ganesh" section.
  *   **Empty-looking State**: Large blank white card in the "See the craftsmanship" section, implying missing video/image content.
  *   **Clipped/Truncated Text**: Testimonial text for "Mr Rahul Ranjan" is clipped at the bottom of its card.
  *   **Clipped/Truncated Text**: Testimonial text for "Ms Neha Singh" is clipped at the bottom of its card.
  *   **Misalignment**: "DELIVERED" text above "3.2 Mn" is misaligned, and the alignment of "HAPPY FAMILIES" (left) differs from "SQ. FT. DELIVERED" (right) in their respective columns.
  *   **Low-contrast Text**: "SHREE GANESH BUILDERS • PATNA" text in the hero section has poor contrast against the background image.
  *   **Awkward Large Blank Area**: Below the "VIEW ALL PROJECTS" button and above the "Why Shree Ganesh" section.
  Overall: 5/10


### mkt_projects
URL: https://royal-realty-hub-2.preview.emergentagent.com/projects
- Files: `mkt_projects_1440.png`, `mkt_projects_390.png`
- **Desktop:** visible 2256 ms / idle 2257 ms · API calls 4 · slowest GET public/projects 193 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1400px
  - Top API timings: GET public/projects 193ms, GET public/site 176ms, GET public/projects 127ms, GET public/site 103ms
- **Mobile 390:** visible 2260 ms / idle 2260 ms · API calls 4 · slowest GET public/site 135 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 2489px
- Visual review @1440:

  *   **Misalignment:** Text "4 BHK" and "Price on request" in 'Ganesh Green Villas' card, and "2 & 3 BHK" and "Starting ₹44 L" in 'Shree Ganesh Heights' card are vertically misaligned with their respective arrow icons.
  *   **Clipped/truncated text:** The 'L' character in "Starting ₹44 L" within the 'Shree Ganesh Heights' project card is slightly clipped/truncated on its bottom-right edge.
  *   **Low-contrast text:** The disclaimer text and copyright information in the footer (e.g., "All projects are registered under...", "Prices shown are indicative...", "© 2026 Shree Ganesh Builders...") have insufficient contrast against the dark background, making them difficult to read.
  *   **Awkward large blank area:** A significant empty vertical space exists between the project cards section and the footer, making the page appear sparse with only two project cards displayed.
  Overall: 7/10

- Visual review @390:

  *   Clipped/truncated text: Project card, location "@ Danapur-Bihta Road, Patna"
  *   Clipped/truncated button: Project card, "ENQUIRE" button on the right
  *   Misalignment/Clipped element: "Price on request" card, right-aligned arrow icon
  *   Awkward large blank area: Below the 'Price on request' card, before the footer
  *   Low-contrast text: Footer email address "sales@shreeganeshbuilders.in"
  *   Low-contrast text: Footer disclaimer text block
  *   Low-contrast text: Footer copyright notice "© 2026 Shree Ganesh Builders. All rights reserved."
  Overall: 4/10


### mkt_project_SGH
URL: https://royal-realty-hub-2.preview.emergentagent.com/projects/shree-ganesh-heights
- Files: `mkt_project_SGH_1440.png`, `mkt_project_SGH_390.png`
- **Desktop:** visible 2791 ms / idle 2791 ms · API calls 22 · slowest GET public/projects/shree-ganesh-heights 189 ms · console err/warn 3 · page scrollWidth 1440 (viewport 1440) · page height 9151px
  - Top API timings: GET public/projects/shree-ganesh-heights 189ms, GET public/published-projects 185ms, GET public/flat-types 182ms, GET public/site 141ms, GET public/projects/shree-ganesh-heights 126ms
- **Mobile 390:** visible 2833 ms / idle 2833 ms · API calls 23 · slowest GET public/published-projects 173 ms · console err/warn 3 · page scrollWidth 390 (viewport 390) · page height 11733px
  - Console/script (1440): warning: No available adapters.; warning: No available adapters.; warning: No available adapters.
  - Console/script (390): warning: No available adapters.; warning: No available adapters.; warning: No available adapters.
- Visual review @1440:

  *   **Low-contrast text:** Active sub-navigation item 'OVERVIEW' text is difficult to read against its background.
  *   **Awkward large blank area:** Significant empty white space between the sub-navigation bar and the 'Construction progress' section.
  *   **Misalignment:** In 'Construction progress', some milestone items (e.g., 'Plastering - 63.64%', 'Finishing - 72.73%') are right-aligned while others are left-aligned within their row.
  *   **Default browser styles:** Checkboxes in the unit availability legend ('Available - tap to enquire', 'Not available').
  *   **Empty-looking states:** Two large blank cards/placeholders appear below the four gallery images.
  *   **Inconsistent spacing:** Vertical spacing between location items (Patna Junction, AIIMS Patna, Saguna More Metro) in the 'Location' section is uneven.
  Overall: 6/10

- Visual review @390:

  *   **Clipped element:** Sticky navigation bar at the bottom; the 'ENQUIRE' button is partially clipped off-screen to the right.
  *   **Awkward large blank area:** Significant empty white space below the sticky navigation bar, before the 'Children's Play Area' amenity cards.
  *   **Misalignment:** Apartment availability grid (e.g., 'A-101' buttons) is not horizontally centered and is skewed to the left within its content area.
  *   **Inconsistent spacing:** Floor numbers (1 through 8) on the left of the apartment availability grid are not vertically aligned with the center of their respective button rows.
  *   **Low-contrast text:** Location text "Bailey Road, Near Saguna More, Patna" in the hero section has insufficient contrast against the dark, busy background image, making it hard to read.
  *   **Empty-looking states:** Three large, blank white cards are present at the bottom of the 'Gallery' section, suggesting missing content or placeholder elements.
  Overall: 6/10


### mkt_contact
URL: https://royal-realty-hub-2.preview.emergentagent.com/contact
- Files: `mkt_contact_1440.png`, `mkt_contact_390.png`
- **Desktop:** visible 2311 ms / idle 2311 ms · API calls 36 · slowest GET public/published-projects 191 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 1947px
  - Top API timings: GET public/published-projects 191ms, GET public/site 142ms, GET public/flat-types 141ms, GET js/StaticMapService.GetMapImage?1m2&1i6177433&2i3576318&2e1&3u15&4m2&1u411&2u231&5m6&1e0&5 96ms, GET js/StaticMapService.GetMapImage?1m2&1i6175666&2i3576194&2e1&3u15&4m2&1u411&2u231&5m6&1e0&5 80ms
- **Mobile 390:** visible 2301 ms / idle 2301 ms · API calls 34 · slowest GET public/published-projects 189 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 3231px
- Visual review @1440:

  *   Awkward large blank area: Significant unused vertical space in the hero section below "Let's find your home".
  *   Awkward large blank area: Significant unused vertical space in the left contact panel below "SGH Site Office".
  *   Low-contrast text: Email address "sales@shreeganeshbuilders.in" in the Email contact card.
  *   Low-contrast text: Placeholder text in all form input fields (e.g., "Full name *", "Mobile (10 digits) *").
  *   Default browser styles: All form input fields (text, dropdowns, textarea) and the checkbox use default browser styling.
  *   Default browser styles: Google Maps iframe displays default Google Maps attribution and controls.
  *   Low-contrast text: Legal disclaimer text in the footer is very difficult to read.
  *   Misalignment: Contact icons (phone, chat, envelope) are vertically misaligned with their corresponding text.
  Overall: 6/10

- Visual review @390:

  *   **Clipped/truncated text & Missing icon:** The "ENQUIRE" button in the sticky footer bar is clipped on the right, and its icon is missing.
  *   **Broken/empty-looking states & Misalignment:** The text "800001" (likely part of the Corporate Office address) is floating above the sticky footer bar, overlapping content.
  *   **Awkward large blank area:** There is excessive empty white space between the "SGH Site Office" card and the footer section.
  *   **Low-contrast text:** The legal disclaimer text in the footer (starting "All projects are registered...") is very small and has low contrast against the dark background, making it difficult to read.
  *   **Inconsistent information display:** Phone number (+916122234567) and email (sales@shreeganeshbuilders.in) are duplicated directly under "SGH Site Office" in the footer without specific labels, inconsistent with the styled contact cards above.
  Overall: 5/10


### portal_login
URL: https://royal-realty-hub-2.expo.preview.emergentagent.com/login
- Files: `portal_login_1440.png`, `portal_login_390.png`
- **Desktop:** visible 1719 ms / idle 1928 ms · API calls 1 · slowest GET portal/config 153 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET portal/config 153ms
- **Mobile 390:** visible 1258 ms / idle 1888 ms · API calls 1 · slowest GET portal/config 154 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   **Low-contrast text:** "Forgot your password? Call your Relationship Manager to reset it." below the "Sign in" button.
  *   **Low-contrast text:** "Staff? Go to ERP" and "Visit website" links at the bottom of the login card.
  *   **Low-contrast text:** "Shree Ganesh Builders - Customer portal" at the very bottom left of the page.
  *   **Awkward large blank area:** Excessive vertical blank space in the left column above the main marketing text "Your home, always within reach."
  *   **Inconsistent spacing/alignment:** "Staff? Go to ERP" and "Visit website" links at the bottom of the login card are excessively spaced and not consistently aligned within the login card's content width.
  Overall: 7/10

- Visual review @390:

  *   Awkward text wrapping and inconsistent alignment for "Forgot your password? Call your Relationship Manager to reset it."
  *   Inconsistent horizontal spacing between footer links ("Staff? Go to ERP" and "Visit website"), causing "Visit website" to be too close to the right edge for a 390px viewport.
  Overall: 7.5/10


### portal_home
URL: https://royal-realty-hub-2.expo.preview.emergentagent.com/
- Files: `portal_home_1440.png`, `portal_home_390.png`
- **Desktop:** visible 4078 ms / idle 4078 ms · API calls 6 · slowest POST portal/auth/login 389 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: POST portal/auth/login 389ms, GET portal/bookings 233ms, GET portal/notices 223ms, GET portal/notifications/unread-count 195ms, GET portal/me 154ms
- **Mobile 390:** visible 4074 ms / idle 4075 ms · API calls 6 · slowest POST portal/auth/login 376 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   `P1 - Villa Block P (Premium)` button: Inconsistent vertical padding, making text appear cramped.
  *   `2 NEW NOTICES` description text: Truncated with ellipsis (`"...a hap..."`).
  *   `Payments` card, `ACCOUNT` column: The "L" in `₹5.5 L` is vertically misaligned with other "L" values.
  *   `Payments` card, bottom section: Text `Cheques awaiting clearance: ₹5,00,000` is clipped by the card's boundary.
  Overall: 8/10

- Visual review @390:

  Here are the visible defects:
  *   **Clipped/truncated text:** "Diwali office hours & site visit sl..." in the '2 NEW NOTICES' section.
  *   **Clipped/truncated text:** "Our offices will remain open 10 am – 4 pm..." in the '2 NEW NOTICES' section description.
  *   **Misalignment:** Numerical values (e.g., ₹30 L, ₹10 L, ₹5 L, ₹5.5 L) in the 'CASH' and 'ACCOUNT' payment details table columns are not consistently aligned by the currency symbol or decimal point, causing a jagged appearance.
  *   **Content visible under fixed navigation bar:** Text (e.g., '2.65', '5.000') from content below is visible through/underneath the bottom navigation bar.
  Overall: 7.5/10


### portal_payments_ledger
URL: https://royal-realty-hub-2.expo.preview.emergentagent.com/payments?tab=ledger
- Files: `portal_payments_ledger_1440.png`, `portal_payments_ledger_390.png`
- **Desktop:** visible 3031 ms / idle 3032 ms · API calls 2 · slowest GET portal/bookings/c2cdb026-e096-4d0c-9307-c15cbfbf3852/payments 155 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET portal/bookings/c2cdb026-e096-4d0c-9307-c15cbfbf3852/payments 155ms, GET portal/bookings/c2cdb026-e096-4d0c-9307-c15cbfbf3852/ledger 143ms
- **Mobile 390:** visible 3039 ms / idle 3040 ms · API calls 2 · slowest GET portal/bookings/c2cdb026-e096-4d0c-9307-c15cbfbf3852/payments 148 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   **Clipped text**: Table, "BUCKET" column for "01 Nov 2025" entry ("Cash ₹3,00,000 . Account ₹3,50,000") is clipped.
  *   **Clipped text**: Table, "DESCRIPTION" column for partially visible "01 Dec 2025" row ("Demand raised – Foundation (5...") is truncated.
  *   **Low-contrast text**: Table, "DATE" column for partially visible "01 Dec 2025" row ("01 Dec 2025") is faint and hard to read.
  *   **Wrong layout**: Mobile bottom navigation bar is present on a 1440px desktop viewport.
  *   **Clipped/Obscured content**: The mobile bottom navigation bar covers and obscures the last visible row of the table content, including the "DUE / ADVANCE" column for "01 Dec 2025".
  Overall: 5/10

- Visual review @390:

  *   **Clipped text:** "P1 · Villa Block P (Premium)" selection pill is truncated.
  *   **Clipped text:** "Schedule" tab in the horizontal navigation is truncated.
  *   **Clipped text:** Transaction details such as "+ charges ₹4,13,000 due" are clipped on the right.
  *   **Layout overlap:** Bottom navigation bar labels ("Home", "Payments", etc.) are partially obscured by the main scrollable content.
  *   **Misalignment:** "Statement" button is vertically misaligned with the "Payments" title and subtitle.
  *   **Misalignment:** Card titles (e.g., "Demand raised - Booking (10.0%)") and their corresponding main amounts (e.g., "₹6,50,000") are vertically misaligned.
  *   **Low contrast text:** Dates and other secondary details (e.g., "01 Nov 2025", "Cash ₹3,00,000") are light grey on a white background.
  *   **Low contrast text:** "Paid to date ₹0" and 'due' amounts (e.g., "₹6,50,000 due") are light red/orange on a white background, making them hard to read.
  Overall: 6/10


### portal_construction
URL: https://royal-realty-hub-2.expo.preview.emergentagent.com/construction
- Files: `portal_construction_1440.png`, `portal_construction_390.png`
- **Desktop:** visible 1523 ms / idle 1523 ms · API calls 12 · slowest GET public/media/photo/86acc24d-bdca-4bc5-a074-0084de823c0a 1022 ms · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
  - Top API timings: GET public/media/photo/86acc24d-bdca-4bc5-a074-0084de823c0a 1022ms, GET public/media/photo/8ecffdf4-63fe-40be-aa9f-839637c50250 1016ms, GET public/media/photo/ec7911e2-1c36-40d8-bab1-eee24131e252 1000ms, GET public/media/photo/c51dc32d-7a0a-4dc2-81a5-c2d20e8e3f07 980ms, GET public/media/photo/b916afc0-b2ea-43b2-8847-5a3106aa3486 960ms
- **Mobile 390:** visible 1545 ms / idle 1545 ms · API calls 12 · slowest GET public/media/photo/c51dc32d-7a0a-4dc2-81a5-c2d20e8e3f07 976 ms · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  Here are the visible defects:
  *   **Clipped Images:** The third image in the 'Foundation', 'Plinth', and '1st Slab' sections is clipped on the right.
  *   **Clipped Text:** The 'Completed 30 Jan 2026' text for '1st Slab' is obscured by the bottom navigation bar.
  *   **Clipped Text:** The 'Home' label in the bottom navigation is partially clipped at the bottom.
  *   **Misalignment:** The vertical timeline line for stages (e.g., 'Foundation') does not consistently align with the start of the stage's details.
  *   **Low Contrast Text:** The text on the inactive 'P1 - Villa Block P (Premium)' button has low contrast against its background, affecting readability.
  Overall: 7/10

- Visual review @390:

  *   Clipped text: "up next: Brickwork" in header subtitle.
  *   Clipped text: "P1 - Villa Block P (Premium)" in the project selection button.
  *   Clipped text: "11 site photos - tap any photo to view full screen" in the progress card.
  *   Low contrast text: Date labels (e.g., "Completed 01 Dec 2025") in timeline stages.
  *   Low contrast text: Inactive navigation labels (e.g., "Home", "Payments") in the bottom bar.
  *   Inconsistent spacing: Project selection buttons ("A-201..." and "P1...") are too close.
  *   Missing/Wrong icon: "Requests" icon in the bottom navigation is unclear/unrelated to its function.
  Overall: 7/10


### portal_requests
URL: https://royal-realty-hub-2.expo.preview.emergentagent.com/requests
- Files: `portal_requests_1440.png`, `portal_requests_390.png`
- **Desktop:** visible 1545 ms / idle 1546 ms · API calls 0 · slowest — · console err/warn 0 · page scrollWidth 1440 (viewport 1440) · page height 900px
- **Mobile 390:** visible 1533 ms / idle 1533 ms · API calls 0 · slowest — · console err/warn 0 · page scrollWidth 390 (viewport 390) · page height 844px
- Visual review @1440:

  *   Low contrast: Header subtitle 'Questions, documents, snags - we're here.'.
  *   Low contrast: Empty state description 'Raise a request for payment queries, documents or site snags...'.
  *   Low contrast: Footer navigation labels 'Home', 'Payments', 'Construction', and 'More'.
  Overall: 7/10

- Visual review @390:

  - Header button: "+ New" text is slightly right-aligned within the button.
  - Bottom navigation: Inconsistent horizontal spacing between navigation items (e.g., "Requests" and "More" are too close).
  - Bottom navigation: "Requests" active state highlight circle is not horizontally centered over its icon and text.
  Overall: 8/10


## Interaction notes

- Booking wizard (desktop): Project/Block comboboxes worked; step 2 grid loaded in ~2.0 s (4 API calls, slowest `GET parking` ~100 ms); step 3 customer search 'Amit' returned result in <1.5 s. Step 3 initially shows only a search box and big empty card — no recent customers/guidance (empty-looking). Wizard was abandoned by navigating away; **nothing submitted**.
- Booking wizard (mobile 390): **blocked at step 2 → Next click timed out** (see punch list #4).
- Wizard step-2 unit prices: vision flagged '₹63.43.750' style dot separators — verify (could be rendering at small font of commas).
- ERP login→dashboard: ~650 ms; POST auth/login ~300 ms. All ERP API calls < 400 ms; slowest generally `GET notifications?limit=20` / `GET settings/company` (130–390 ms) fired on every page — candidates for caching.
- Portal: login POST ~380 ms; Home visible ~4 s after submit (includes 4 s scripted wait — real time lower); Construction photos slowest asset ~1.0 s per `GET public/media/photo/*` (12 requests) — serve thumbnails.
- Portal Requests for Amit Kumar Sinha shows empty state (expected per seed — no SR on BK-0001/0002 primary for this user's view? verify).

## Not testable / caveats

- YouTube embed rendering and video playback (headless) — HUMAN.
- Portal full-page screenshots capture only the viewport height because content is inside RN-web inner ScrollViews.
- Timings measured from a pod in the same region as preview infra; real-user latency will be higher.
- Vision-review findings are heuristic; verify before filing.

## Before / After — Phase 8A (2026-10-24)

**Serving:** preview now serves the **production build** (`PREVIEW_MODE=production`, express + brotli, immutable hashed assets, no-cache index). Dev HMR via `yarn dev`.

**Bundle (gzip, prod):** `main` 113.4 kB + ERP shell chunk 110.3 kB = **≈224 kB JS on `/erp/login`** (target < 250 kB); recharts/reports/dashboard lazy-chunked (48 kB, 35 kB…). Fonts: Manrope preloaded, `display=swap`; Inter removed.

**Requests:** `auth/me` / `settings/company` deduped through the react-query cache (staleTime 5 / 10 min); bell polls `unread-count` only every 30 s, list on open; payments list paginated 20/50/100 with filter-wide totals (`/api/payments/summary`); construction/CMS photos served as 480px WebP thumbs (`?size=thumb`, immutable cache; 296 KB → 36 KB on the sample).

**Timings** (Playwright `goto … networkidle` on the prod build, warm session; includes API + idle wait so real paint is earlier):

| Page | 1440 load | overflow @1440 | overflow @390 | screenshots |
|---|---|---|---|---|
| erp_login | 1158 ms | none | none | `after/erp_login_1440.png`, `after/erp_login_390.png` |
| erp_dashboard | 1620 ms | none | 471px (fixed in final build) | `after/erp_dashboard_1440.png`, `after/erp_dashboard_390.png` |
| erp_projects | 1517 ms | none | none | `after/erp_projects_1440.png`, `after/erp_projects_390.png` |
| erp_project_SGH_detail | 2421 ms | none | none | `after/erp_project_SGH_detail_1440.png`, `after/erp_project_SGH_detail_390.png` |
| erp_towerA_inventory | 1505 ms | none | none | `after/erp_towerA_inventory_1440.png`, `after/erp_towerA_inventory_390.png` |
| erp_bookings_list | 1516 ms | none | none | `after/erp_bookings_list_1440.png`, `after/erp_bookings_list_390.png` |
| erp_payments_list | 1495 ms | none | none | `after/erp_payments_list_1440.png`, `after/erp_payments_list_390.png` |
| erp_reports | 1470 ms | none | none | `after/erp_reports_1440.png`, `after/erp_reports_390.png` |
| erp_report_outstanding | 1438 ms | none | none | `after/erp_report_outstanding_1440.png`, `after/erp_report_outstanding_390.png` |
| erp_master_payment_plans | 1431 ms | none | none | `after/erp_master_payment_plans_1440.png`, `after/erp_master_payment_plans_390.png` |
| erp_customers | 1438 ms | none | none | `after/erp_customers_1440.png`, `after/erp_customers_390.png` |
| erp_customer360 | 1531 ms | none | none | `after/erp_customer360_1440.png`, `after/erp_customer360_390.png` |
| erp_booking_BK0001_ledger | 2095 ms | none | none | `after/erp_booking_BK0001_ledger_1440.png`, `after/erp_booking_BK0001_ledger_390.png` |
| erp_wizard_step1 | 1445 ms | none | none | `after/erp_wizard_step1_1440.png`, `after/erp_wizard_step1_390.png` |
| erp_wizard_step2_grid | 11437 ms | none | none | `after/erp_wizard_step2_grid_1440.png`, `after/erp_wizard_step2_grid_390.png` |

Console errors: **0** at both widths across all 15 pages. Before: Customer 360 scrollWidth 662, Customers 407, wizard grid 425 @390 → now none; dashboard @390 fixed by constraining chart cards (`min-w-0 overflow-hidden`) in the final build.

**Design system applied globally:** tokens (navy-950/900/700, gold-500/400 gradient, ivory, line `#E6E9F0`), Manrope 14/1.5 body, 13px tables with line-height 1.4 (no clipped descenders), 12px uppercase labels, contrast floor for all `text-slate-400/500/600` (≥ 5.6:1), solid-tint status badges with dark text (Available/Hold/Booked/Sold/Blocked, booking/demand/payment/KYC states), `PageHeader` breadcrumbs, `StatCard` icon tiles (no truncated money), `Money`, `EmptyState`, `DataTable` v2 (min column widths, sticky first column, right-edge scroll shadow, card rows < 768px, sticky totals footer, page-size picker), custom `DateInput` everywhere (16 native date inputs replaced), topbar search pill + rounded ⌘K chip, bell badge 9+ cap with full count in the panel.

**Dashboard:** donut with centre total + legend values; units per project → horizontal stacked bars with labels and legend; collections → grouped 14px bars, axis labels, legend top-right; due ageing renders bucket amounts with explicit "No overdue dues" state; recent activity shows relative time with the exact timestamp on hover (identical seed timestamps were real data: all audit rows written in the same reseed second); inventory-by-project VALUE column widened.

**Data entry:** wizard v2 — left stepper with ticks (clickable back), sticky summary rail with live totals, sticky footer (Back/Next always visible on mobile), unit grid legend + find-by-flat-no + internal scroll, payment-plan cards + schedule preview, **draft autosave per user with Resume/Discard banner**, unsaved-changes guard; payment toast gets "Print receipt"; ⌘K palette remembers recent items; tower header shows "numbering e.g. A-101".

**Independent re-test (iteration_8):** backend 23/23, prod routing, dashboard, bell 9+, payments pagination/summary, mobile card rows + zero overflow, DateInput, tower numbering preview, Construction % header, wizard v2 incl. draft resume — all PASS. One blocker found and fixed (missing `SchedulePreview` import on the Payment Plan step → rebuilt; full 7-step walk re-verified to Review). `/portal/*` on the prod server now redirects straight to the Expo portal URL (`REACT_APP_PORTAL_URL`).

**Bugs from the audit:** all items in §6 addressed (empty due ageing, raw numbering pattern, bell badge, clipped currency/descenders/headers (CONSTR. % → Construction %, ACCOUN/TOW… via min widths + nowrap), Payment Plans last column (installments column renders % chain, nowrap), report totals (sticky footer, min widths), timestamps, low contrast, wizard Next on mobile, chevrons (shadcn selects + DateInput), Under Construction badge (nowrap), default date inputs, search placeholder).


## Phase 8B — Marketing website after-pass (production build, `yarn preview:build`, served at `/`)

Measured with `/app/memory/qa/mkt_pass.py` (headless Chromium, `networkidle`, cold cache, 1440×900 and 390×844). Screenshots: `/app/memory/qa/after/mkt_{home,projects,project_SGH,contact}_{1440,390}.png`.

| Page | Before idle (ms) | After idle (ms) | After requests | After transfer | Console warn/err before → after | scrollWidth 390 |
|---|---|---|---|---|---|---|
| `/` | 5799 | **1407** | 22 | 493 KB (258 KB @390) | 1 (`No available adapters`) → **0** | 390 |
| `/projects` | 2256 | **1233** | 14 | 140 KB | 0 → **0** | 390 |
| `/projects/shree-ganesh-heights` | 2791 | **1333** | 20 | 464 KB (149 KB @390) | 3 (`No available adapters` ×3) → **0** | 390 |
| `/contact` | 2311 (36 requests incl. Google Maps tiles) | **1384** | 12 | 62 KB | 0 → **0** | 390 |

Bundles (gzip): site `main` 141 KB + route chunks 2.6–10.6 KB (Projects/ProjectDetail/Gallery/Blog/Contact/About/Legal lazy-loaded, hover-prefetched from the nav); CSS 8.0 KB. One `h1` per page; 0 third-party iframes on first paint (the only iframe recorded on `/` is the Playwright 1×1 automation probe).

What changed
- Speed: click-to-load facades for YouTube/Vimeo/Matterport (`VideoEmbed`) and Google Maps (`MapEmbed`) — no player/maps JS until click; responsive Unsplash `srcset`/`sizes` with `fm=webp&q=70` (480/960/1440/1920w), lazy + `decoding=async` + intrinsic dimensions + blur-up, hero `<link rel=preload as=image imagesrcset>` + `fetchpriority=high`; Cormorant+Manrope with preconnect/`display=swap`; route-level `React.lazy` + `PREFETCH` map on nav hover; axios replaced by a 20-line `fetch` client in `/app/site/src/lib/api.js` (source of the “No available adapters” warning).
- Design: cinematic 100svh hero (brief copy ≤60/110 chars, scroll cue, pill CTAs), trust strip with hairline dividers + tabular numerals, 4:5 editorial project cards with `₹44 L` unit label fixed, numbered Why-Shree-Ganesh features with lucide icon fallback, single-quote testimonial carousel with tabs (no clipped cards), blog cards with 2-line clamp + date + “Read →”, project page: sticky sub-nav (header-offset, with Enquire pill), aligned 11-stage grid with step numbers/ticks, amenity icon mapping, gallery alt text, map facade, FAQ `aria-expanded`, brochure CTA repeated in enquiry band; contact: compact hero, custom floating-label fields/selects/checkbox, inline mobile validation (`enq-phone-error`), hairline contact rows + hours; footer 4-col with RERA block and text at ≥ white/75; mobile full-screen nav overlay (staggered) and 3-col sticky action bar that fits 390 (safe-area aware).
- A11y/SEO: skip link, visible gold focus rings, `aria-label/aria-pressed/aria-expanded` on controls, `role=dialog` lightbox with keyboard nav + only real image URLs rendered; `/projects` and `/projects/:slug` fixed sparse bottom with “why” band + CTA.

ERP leftovers (Phase 8B)
- Booking wizard agreement split: ₹ / % toggle for Cash (`wiz-cash-mode-amount|percent`), % shows derived rupee (`wiz-cash-derived`), Account auto-balances to the rupee (`Math.round`), editing Account back-fills Cash and %; quick 0/20/30/40/50 % chips keep working.
- Master sheets: “Save & add another” (`master-form-submit-another`, form resets, counter badge `master-form-saved-count`, focus returns to first input) and inline duplicate-name warning (`master-dupe-warning`, case/space-insensitive, flags inactive duplicates).
- Dashboard: inventory bar segments get `minWidth: 6px` + hairline gaps; donut `minAngle={6}` so tiny statuses stay visible.

### Phase 8B polish pass (root re-audit items 1–5)
1. SGH @390: stages render as a vertical list (`stage-list`: full name, % right, bar below); grid only ≥ sm. Sub-nav: right-edge fade (`pd-subnav-fade`), IntersectionObserver marks the active section (`aria-current`) and auto-scrolls it into view; "Availability" no longer cut.
2. Media: `services/thumbs.py` now generates **thumb (480px)** and **medium (1080px)** WebP; `?size=medium` added for lightboxes. Variants pre-generated for all 50 photos at startup (`[media] variants prewarmed: {'photos': 50, 'generated': 61, 'failed': 0}`) and via one-off run; generation runs in a thread (never on the request path once warmed). Responses: `Cache-Control: public, max-age=31536000, immutable`, strong `ETag`, `If-None-Match` → 304 (verified on :8001; the preview ingress rewrites Cache-Control to no-store and weakens ETags — production serving is unaffected).
3. Wizard step 1: route chunk no longer bundles Customers page / PaymentSchedule / unit grid (lazy `CustomerForm`, `SchedulePreview`, new `components/booking/UnitGrid.jsx`); "New booking" button prefetches the wizard chunks + `/projects` + `/settings/company` on hover/focus/touch. Measured click → `wiz-project` visible: **224 ms** (was ~2.6 s).
4. ERP login: `AppShell` and print views are now lazy — `/erp/login` loads only `main.*.js` (the 155 KB shell chunk loads after auth).
5. Bell badge: 16px pill at top-right (-4px/-4px), 10px/700, white ring, no glyph overlap. Wizard stepper @390: numbered circles only with "Step n of 7 · <label>" beneath (`wiz-step-label`).
Tests: Tower B had been mutated by the Phase-2 regression test (payment against a stage demand blocks undo) → guarded `POST /api/admin/reseed` restored seed state; integrity ok=True; phase_7/portal_leaks/ledger 26 passed; phase_3/phase_5 green. Marketing pass re-run: 0 console errors, scrollWidth 390 on all pages.
