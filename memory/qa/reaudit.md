# KKT Re-audit (after quality overhaul)

How I tested: Playwright Chromium headless at 1440x900 and 390x844 (mobile emulation), same method as `audit.md`. `visible` = time from navigation to the key element showing. `idle` = time to networkidle (no traffic for 500 ms). Request count = all requests per navigation. No forms were submitted. The booking wizard was left at step 3 and the browser context was closed. Scripts: `reaudit_pass.py`, `reaudit_fix.py`. Raw data: `reaudit/results.json`. Screenshots: `reaudit/*.png`.

## Headline metrics, before → after
| Metric | Before | After |
|---|---|---|
| ERP /erp/login build | CRA dev `static/js/bundle.js`, not minified | `/erp/static/js/main.61f8f28b.js` plus hashed chunks 474, 381, minified |
| ERP app JS on /erp/login | 454 KB dev bundle | 569 KB raw, **176 KB gzip** (main 113 + 474-chunk 48 + 381-chunk 15), served brotli |
| ERP /erp/login total JS, incl. platform scripts (decoded) | 886 KB | 1.37 MB decoded. Of this, about 750 KB is Emergent/PostHog/Cloudflare tooling (array.js 336 KB, posthog-recorder 215 KB, surveys 112 KB) |
| Marketing home weight, cold, full scroll (decoded) | 2.66 MB / 47 req | **0.87 MB / 29 req** (1440). 0.85 MB / 25 req (390) |
| YouTube player JS on home before click | base.js 505 KB + ~0.5 MB | **none** |

## Per page, before → after (visible / idle in ms)
| Page | 1440 before | 1440 after | 390 before | 390 after | Req (after) | Overflow at 390 (scrollWidth) |
|---|---|---|---|---|---|---|
| ERP login (cold) | 1058/1592 | 999/1238 | 836/1358 | 959/1262 | 21 | 390 ✓ |
| Dashboard | 654/654* | 909/1629 | 671/671* | 1381/1679 | 33 | 390 ✓ (before 471 in 8A) |
| Projects | 1056/2155 | 888/1450 | 1063/2168 | 1422/1581 | 28 | 390 ✓ |
| Tower A inventory | 1535/2156 | 1379/1546 | 1250/2154 | 878/1540 | 29 | 390 ✓ |
| Bookings list | 1033/2156 | 1384/1491 | 1059/2160 | 1418/1574 | 26–31 | 390 ✓ |
| BK-2526-0001 ledger | 1637/1638 | 897/1462 | 1648/1649 | 1386/1700 | 32 | 390 ✓ (ledger tab 390) |
| Payments | 1021/2150 | 1372/1589 | 1154/2189 | 909/1527 | 29 | 390 ✓ |
| Outstanding & Ageing | 1536/2156 | 894/1495 | 1603/2169 | 1475/1719 | 30 | 390 ✓ |
| Customer 360 | 1518/2160 | 875/1575 | 1032/1567 | 1397/1556 | 33 | **390 ✓ (before 662)** |
| Wizard step 1 | 1005/2146 | 2578/2578 | 1019/2157 | 2584/2584 | 29 | 390 ✓ |
| Wizard step 3 (Customer) | 390: not reached (scrollWidth 425) | reached | **not reached** | **reached** | – | 390 ✓ |
| Mkt / | 5799/5799 | 973/1506 (warm 999/1427) | 5659/5659 | 941/1422 (warm 986/1443) | 22 | 390 ✓ |
| Mkt /projects | 2256/2257 | 876/1263 | 2260/2260 | 920/1206 | 14 | 390 ✓ |
| Mkt /projects/shree-ganesh-heights | 2791/2791 | 867/1335 | 2833/2833 | 865/1357 | 16–20 | 390 ✓ |
| Mkt /contact | 2311/2311 (36 req) | 870/1212 | 2301/2301 | 913/1174 | 12 | 390 ✓ |
| Portal login | 1719/1928 | 1520/1799 | 1258/1888 | 1498/1751 | 17–18 | 390 ✓ |
| Portal Home (after submit) | 4078/4078 | 819/819 | – | 825/825 | 10 | 390 ✓ |
| Portal Payments → Ledger | – | 874/1444 | – | 877/1381 | 16–18 | 390 ✓ |
| Portal Construction | – | 1392/**4986** | – | 885/2941 | 20 | 390 ✓ |
| Portal Requests | – | 925/1244 | – | 878/1046 | 13–14 | 390 ✓ |

\* Before, the dashboard time was measured right after login. ERP idle is now about 1.5 s, down from the previous 2.15 s floor.

Console: **0 errors and 0 warnings** on every page at both widths, including the full-scroll marketing home and the wizard.

## Binary checks
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Production build; app JS < 300 KB gzip | PASS | main.61f8f28b.js, one line, minified; 176 KB gzip total app JS |
| 2 | No page-level horizontal overflow at 390 on ERP pages | PASS | scrollWidth = 390 on all listed pages and wizard steps 2–3 |
| 3 | Wizard at 390 reaches step 3 | PASS | project → block → Next → grid → flat P2 → Next → `wiz-customer-search` visible (`erp_wizard_step3_390.png`) |
| 4 | Due ageing shows data or an empty message | PASS | Shows buckets: 90+ days ₹2,07,40,000, total ₹2.07 Cr |
| 5 | Tower A header has no `{block}-{floor}{pos2}` | PASS | Page text contains no `{block}` or `{floor}` |
| 6 | No YouTube JS before click; poster shown; warm idle < 2.5 s | PASS | No youtube/base.js/www-embed-player requests after full scroll; the one iframe has an empty `src`; video-section has an `<img>` poster; warm idle 1427 ms (1440) and 1443 ms (390) |
| 7 | Mobile sticky bar fits; Why icons; SGH gallery | PASS | `mobile-cta` spans 0–390 with no inner overflow; Why section has 4 SVG icons and no "?"; SGH has 20 images, 0 broken (`mkt_SGH_gallery_390.png`) |
| 8 | Portal shell at 1440 and 390 | PASS | 1440: sidebar-nav shown, no tab bar, last ledger row (bottom 899.5 of 900) is hit-testable. 390: tab bar shows Home/Payments/Construction/Requests/More, none clipped; last ledger row bottom 713 < tab bar top 775; no clipped text in Home cards |
| 9 | Zero console errors | PASS | 0 errors, 0 warnings |

## Remaining visible defects (DOM-confirmed unless marked "vision")
1. **Marketing SGH at 390, Construction progress grid** (`stage-grid`): all 10 stage labels are cut off with an ellipsis ("Found…", "1st Sl…", "Possession/Handover"…). Each label has `nowrap` + `text-overflow: ellipsis` in a 40 px box. Fix: allow wrapping or use fewer columns. Screenshot: `mkt_SGH_construction_390.png`.
2. Marketing SGH at 390: the sticky sub-nav cuts "AVAILABILITY" to "AVAILABIL" at the edge. It appears to be a horizontal scroller, but there is no fade or scroll cue (vision).
3. Portal Construction at 1440: network idle takes 4986 ms, the slowest page in the set (2941 ms at 390). Probably images loading.
4. Wizard step 1: visible/idle is about 2.6 s, slower than other ERP pages (about 1.5 s).
5. ERP /erp/login loads the 155 KB (raw) `474` chunk before it is needed. It is likely charts/vendor code that could be deferred until after login.
6. ERP header at 390: the "9+" notification badge sits on top of the bell icon (vision, repeats on every page). Cosmetic.
7. ERP wizard stepper at 390: step 4 is cut to "Agr…". It sits in an `overflow-x-auto` scroller, so this is acceptable but has no scroll cue (vision).
8. Home blog cards and the portal notice use intentional line-clamp. Not a defect.

Vision items flagged on ERP C360, ledger columns and portal "+ charges" were not confirmed by the DOM clipping scan (no elements found with scrollWidth > clientWidth). They are likely false positives.
