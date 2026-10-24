# @kkt/erp — staff ERP (Vite + React 19 + Tailwind 4)

The staff application for KKT v2. Dense, data-first, royal navy + gold. Talks only to the API
(`/api/v1`, bearer tokens with `aud: "erp"`) and imports shared wire shapes from `@kkt/contracts`.

## Run

```bash
pnpm --filter @kkt/erp dev        # http://localhost:5173 — /api is proxied to VITE_API_URL || http://localhost:4000
pnpm --filter @kkt/erp typecheck  # tsc --noEmit (strict, noUnchecked­IndexedAccess, no `any`)
pnpm --filter @kkt/erp test       # vitest (format + api client units)
pnpm --filter @kkt/erp build      # tsc + vite build → dist/ (served by nginx.conf / Dockerfile)
pnpm --filter @kkt/erp preview
```

Never run `pnpm install` from inside this package while other workspace packages are being
written; dependencies are hoisted at the repository root.

## Environment

| Variable | Dev | Production |
|---|---|---|
| `VITE_API_URL` | leave empty → same-origin `/api/v1` through the Vite proxy | public API origin, e.g. `https://api.example.com` (baked in at build time; see `Dockerfile` ARG) |

Copy `.env.example` to `.env.local` if you need to point at a remote API during development.

## Layout

```
src/
  main.tsx, app.tsx        bootstrap: QueryClient (staleTime 15 s, retry 1 but never on 4xx, no refetch on focus),
                           BrowserRouter, AuthProvider, Toaster, ErrorBoundary, Suspense, VersionConflictHost
  routes.tsx               lazy routes generated from the nav; /login, /change-password, /forbidden, 404
  styles/index.css         Tailwind v4 @theme tokens (navy, gold, surface, status chips, semantic, fonts, radii, motion)
  lib/
    api.ts                 fetch client: bearer in memory, refresh in localStorage (kkt.erp.refresh), single-flight
                           refresh on 401 TOKEN_EXPIRED, auto Idempotency-Key on POST, If-Match from `version`,
                           error envelope → ApiClientError, get/post/patch/put/delete/upload/download/list/exportCsv
    format.ts              formatINR (₹1,00,00,000), formatINRShort (₹1.2 Cr / ₹45 L), paise↔rupee input,
                           amountInWords (Indian), formatDate (24 Oct 2026), formatDateTime (IST), percent, sqft
    auth.tsx               AuthProvider / useAuth: login (MFA step), logout, me, can/canAny/canAll, project scope,
                           mustChangePassword gate, session restore
    queries.ts             useListParams (URL-synced page/page_size/q/sort/filters), useList, useItem,
                           useMutationWithToast (toasts + 409 VERSION_CONFLICT → dialog)
    permissions.ts         NAV_GROUPS with required permission codes, filterNav(can), findNavItem
  components/
    ui/                    the kit (Button … DataTable … CommandPalette); import from "@/components/ui"
    layout/                AppShell (sidebar 260/72 px, 64 px top bar, off-canvas drawer < 1024 px), TopBar, Sidebar,
                           NotificationBell (GET /notifications/unread-count every 30 s), UserMenu, BrandMark
    auth/                  ProtectedRoute, PublicOnlyRoute, PermissionRoute
  pages/                   _Placeholder (every nav route until its module lands), LoginPage, ChangePasswordPage,
                           ForbiddenPage, NotFoundPage
```

## Conventions for new pages

**Lists** — `useListParams` + `useList` + `Toolbar` + `DataTable` + `Pagination`:

```tsx
const list = useListParams({ filterKeys: ["status", "project_id"], defaultSort: "-created_at" });
const query = useList<BookingRow>("/bookings", list.params);

const columns: ColumnDef<BookingRow>[] = [
  { accessorKey: "number", header: "Booking", meta: { locked: true } },
  { accessorKey: "customer_name", header: "Customer" },
  { accessorKey: "total_due_paise", header: "Due", meta: { align: "right" },
    cell: ({ row }) => formatINR(row.original.total_due_paise) },
  { id: "status", header: "Status", meta: { sortKey: false },
    cell: ({ row }) => <StatusChip status={row.original.status} /> },
];

<Toolbar search={list.search} onSearchChange={list.setSearch}
         filters={<Select … value={list.filters.status ?? null} onValueChange={(v) => list.setFilter("status", v)} />}
         hasActiveFilters={list.hasActiveFilters} onClearFilters={list.reset}
         onExportCsv={() => api.exportCsv("/bookings", list.params)}
         columns={getColumnChoices(columns, visibility)} onColumnToggle={(id, v) => setVisibility({ ...visibility, [id]: v })} />
<DataTable columns={columns} data={query.data?.items ?? []} getRowId={(r) => r.id}
           loading={query.isFetching} error={query.error} onRetry={() => query.refetch()}
           sort={list.sort} onSortChange={list.setSort}
           pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0,
                         onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
           mobileCard={(row) => <BookingCard booking={row} />} />
```

* Declare columns as `ColumnDef<Row>[]` with `accessorKey` and read `row.original` in `cell` — no
  `createColumnHelper` casts. `meta.align: "right"` gives tabular figures for money.
* Sorting and pagination are server-side; the table never sorts or slices client-side.
* Rows above 100 are virtualised automatically; below 768 px every row renders as a card.

**Forms** — react-hook-form + zod. Use the request schemas from `@kkt/contracts` when the module
exports them (`zodResolver(CreateBookingSchema)`); otherwise define a local zod schema next to the
page. Wire fields with `FormField` (controlled) or `FieldWrapper` + `register` (native inputs):

```tsx
<FormField control={form.control} name="agreement_value_paise" label="Agreement value" required
           render={({ field }) => <MoneyInput {...field} value={field.value} onChange={field.onChange} />} />
```

Money fields hold **integer paise**; `MoneyInput` lets the user type rupees (Indian grouping,
"45L"/"1.2cr" shorthand). Dates are `YYYY-MM-DD` strings (`DateInput`). Percentages ≤ 2 decimals.

**Mutations** — `useMutationWithToast({ mutationFn, successMessage, invalidate: [["/bookings"]] })`.
Pass `version` on PATCH (`api.patch(path, body, { version })`); a 409 opens the version-conflict
dialog with "who changed it" and a reload action. Map `VALIDATION_ERROR` issues onto fields with
`applyServerErrors(error, form.setError)`.

**Permissions** — guard routes with `PermissionRoute`, hide actions with `useAuth().can("payment.post")`.
Project-scoped users get 404s, not 403s, from the API: show `NotFound`/`EmptyState`, never "forbidden".

**Accessibility / density** — 36 px controls, 40 px table rows, 13–14 px body text, gold focus rings on
everything, solid (never transparent) popovers, `data-testid` in kebab-case on interactive elements.
Every page must stay free of horizontal overflow at 390 px: wrap wide content in `min-w-0` / `overflow-x-auto`.
