# Phase J.2 — memory & photos/documents pipeline (status, 27 Oct 2026)

## NOT DONE / caveats first
- **Latency on the sandbox is not production-grade**: single Uvicorn worker, shedding at 64 in-flight; 100 users p95 17 s (server db p95 ≪ 1 s — queueing, not DB). Memory targets are met; throughput targets need multi-worker (see load_report.md, measured vs estimated).
- Orphaned 5 MB part objects: the Emergent object-storage gateway returns 405 on DELETE, so completed uploads leave their part objects in `uploads/<id>/…`; the `uploads` record (TTL 48 h) lists them for a future GC job. Final objects and variants are unaffected.
- `sweep_notifications` on kkt_scale (177 k notifications) still runs ~minutes on first boot; it is now watermarked one-time and only touches rows without `swept_v`.
- Idle-RSS test waits for startup (≈4 min on kkt_scale); it skips when kkt_scale is absent.

## 1. Memory does not scale with data size — DONE
| measurement (kkt_scale, 5.07 M rows) | before | after |
|---|---|---|
| idle RSS after startup | **568 MB** | **153–157 MB** |
| peak RSS, 600 virtual users (mix) | **718 MB → 1,100 MB** | **205 MB** (100/300/600 run: 171→190, 178→205, 185→189 MB) |
| after load, steady | 591 MB | 171–203 MB |
| production limit 512 MB | margin −206 MB | **margin ≈ 307 MB at peak, ≈ 355 MB idle** |

Root causes found with tracemalloc + gc walk (`KKT_TRACEMALLOC=1`):
1. `integrity_report` materialised all flats/customers/bookings (`to_list(None)`) → streaming with projections + per-booking aggregations (`services/integrity.py`).
2. `ageing_for_bookings` loaded every open demand of every booking (600 k docs) → 500-booking batches, bands kept, demands dropped (`services/definitions.py`).
3. Outstanding report cached 30 k bookings + per-booking dicts per scope → streams bookings, heap top-N (REPORT_VIEW_MAX=2000) view rows, O(batch) ageing; CSV path keeps full rows (explicit export; >10 k → async export). `total_rows`/`truncated` exposed (`routers/reports.py`).
4. Motor cursors fetched 16 MB server batches (≈100 k decoded docs in flight) → `.batch_size(500)` at 20 streaming sites (sweeps, backfills, read-model rebuild, overdue job, dues).
5. Decoded-document reference cycles lingered until gen-2 GC and glibc never returned arenas → `M_ARENA_MAX=2`, `_trim_memory()` (gc.collect + malloc_trim) after each startup step and every 20 s (`server.py`).
6. Startup rescanned completed migrations every boot → `migrations` watermarks: one-time steps skipped once done for this VERSION; O(all) daily steps (integrity, reconcile) skip within 24 h (`_watermark_skip`, `KKT_FORCE_STARTUP=1` to bypass).
7. Fresh DBs silently lost ~70 indexes: `ensure_indexes` aborted on the first name conflict inside a 3 s budget → per-index resilient `_ci()`, 30 s budget, idem-claim index names aligned.
- orjson: already the default response class (`ORJSONResponse`), verified.
- Test: `tests/test_memory_scale.py` boots a worker on kkt_scale and asserts idle RSS ≤ 250 MB (passed: 1 in 247 s).

## 2. J4 photos & documents pipeline — DONE
- `routers/files.py`: `POST /uploads/init` → `PUT /uploads/{id}/parts/{n}` (5 MB, `X-Part-Sha256`, parts stored as objects) → `GET /uploads/{id}` (resume: received parts) → `POST /uploads/{id}/complete` (streams parts into the final object through a request-scoped spool, exact length, sha256). Max 500 MB; body-limit middleware allows 5 MB only on part routes; completion has its own 900 s budget.
- Validation: extension allow-list (jpg/jpeg/png/webp/pdf/mp4/docx/xlsx) at init, magic bytes at complete (`FILE_TYPE_NOT_ALLOWED`, `FILE_SIGNATURE_MISMATCH`, `FILE_TOO_LARGE`, `PART_HASH_MISMATCH`, `UPLOAD_INCOMPLETE` registered).
- Variants: `IMAGE_VARIANTS` job via `job_runs.run_isolated` — thumb 320 / medium 1024 / large 2048 WebP, `exif_transpose` then RGB re-encode (EXIF dropped), stored under immutable content-hash names, served `Cache-Control: public, max-age=31536000, immutable`. Corrupt file → `variants_state=failed`, batch continues.
- Private files only via signed URL (`/files/{id}/url` → 15-min HMAC link); `download` streams from object storage with `Content-Disposition: attachment; filename=…`, `no-store`, `nosniff`. `present()` strips `storage_key`; leak scan test.
- Legal hold / retention_until → `DELETE` 409 `FILE_RETAINED`. Per-project storage usage → `/api/admin/ops.storage` + System Health card.
- UI: `ResumableUpload.jsx` (parts hashed in-browser, progress bar, resume from `localStorage` upload id, Resume button on failure), `FileGallery.jsx` (IntersectionObserver lazy thumbs, blur-up, lightbox medium → "Open large (2048)", download original, hold/delete, cursor "Load more"). Wired into construction stage photos (`ConstructionPhotos.jsx`, project-scoped) and service-request attachments (`ServiceRequests.jsx`).
- Tests `tests/test_phase_j4_files.py` (5 passed, 53 s): 200 MB / 40 parts with part 17 dropped → 409 + missing=[17] → bad hash 422 → resume → 201, streamed download sha256 matches, unsigned 401 / bad sig 403; magic-byte + allow-list + 500 MB cap; corrupt image isolation + variants + EXIF empty + ≤2048 px; legal hold; storage card; raw key never in responses.
- Playwright proof: `j4_upload_progress.jpeg` (4 files 0 %→100 %), `j4_gallery_thumbs.jpeg`, `j4_gallery_and_docs.jpeg` (3 thumbnails + deed.pdf row), `j4_lightbox_large.jpeg` (large variant URL `/api/files/variants/<sha256>.webp`), download event `deed.pdf` via signed link, `j2_system_health_storage.jpeg`.

## 3. Gate
- Full suite: **548 passed, 2 skipped, 0 failed** (kkt_test, 4 workers, 377 s) — memory/qa/scale/full_suite_j2.log. Flaky tests made deterministic (integrity read-skew re-check, live-total cursor bound, audit-archive ≥, startup-lease race in the idempotence test).
- Registry: `routes 270 unmapped []`. Health 0.19 s. Deployment agent: WARN only (empty CORS_ORIGINS = intentional same-origin). Headline numbers test included in the suite.
