import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApplicablePlanRow,
  ApplicablePlansResponse,
  AuditLogRow,
  BookingDetailResponse,
  BookingDraftRow,
  BookingDraftUpsert,
  BookingRow,
  ChargeTypeRow,
  CustomerRow,
  DemandRow,
  LedgerRebuildRow,
  LedgerResponse,
  ParkingSlotRow,
  PaymentRow,
  SchedulePreviewRequest,
  SchedulePreviewResponse,
  ScheduleResponse,
} from "@kkt/contracts";
import { api, buildListQuery, fetchAllPages, saveBlob, type ApiClientError, type ListEnvelope } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";
import { useMasterRows } from "@/features/masters/api";

/* ------------------------------------------------------------------ */
/* Paths & keys                                                         */
/* ------------------------------------------------------------------ */

export const BOOKINGS_PATH = "/bookings";
export const DRAFTS_PATH = "/booking-drafts";
export const DEMANDS_PATH = "/demands";
export const PAYMENTS_PATH = "/payments";
export const AUDIT_PATH = "/audit-logs";

export const bookingKeys = {
  detail: (id: string) => [BOOKINGS_PATH, "detail", id] as const,
  ledger: (id: string, params: LedgerPageParams) => [BOOKINGS_PATH, "ledger", id, params] as const,
  ledgerRebuilds: (id: string) => [BOOKINGS_PATH, "ledger", id, "rebuilds"] as const,
  schedule: (id: string) => [BOOKINGS_PATH, "schedule", id] as const,
  demands: (id: string) => [BOOKINGS_PATH, "demands", id] as const,
  demandsPage: (id: string, page: number, pageSize: number) => [BOOKINGS_PATH, "demands", id, page, pageSize] as const,
  payments: (id: string) => [BOOKINGS_PATH, "payments", id] as const,
  paymentsPage: (id: string, page: number, pageSize: number) =>
    [BOOKINGS_PATH, "payments", id, page, pageSize] as const,
  history: (id: string) => [AUDIT_PATH, "entity", "booking", id] as const,
  drafts: [DRAFTS_PATH, "mine"] as const,
  applicablePlans: (blockId: string, onDate: string) => ["/blocks", "applicable-plans", blockId, onDate] as const,
  preview: (request: SchedulePreviewRequest) => [BOOKINGS_PATH, "preview-schedule", request] as const,
  parking: (projectId: string) => ["/projects", "parking", "available", projectId] as const,
  customer: (id: string) => ["/customers", "item", id] as const,
};

/* ------------------------------------------------------------------ */
/* Booking detail & tabs                                                */
/* ------------------------------------------------------------------ */

export function useBookingDetail(id: string | null | undefined): UseQueryResult<BookingDetailResponse, ApiClientError> {
  return useApiQuery<BookingDetailResponse>(bookingKeys.detail(id ?? ""), `${BOOKINGS_PATH}/${id}`, {
    enabled: Boolean(id),
  });
}

/**
 * placeholderData for the paged booking tabs: keep the previous page on screen while the next page of the SAME booking loads, but
 * never show another booking's rows and dues while this booking's first page loads (key[2] is the booking id in every key below).
 */
export function previousPageOfSameBooking<T>(
  previous: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  bookingId: string | null | undefined,
): T | undefined {
  return previousQuery && previousQuery.queryKey[2] === (bookingId ?? "") ? previous : undefined;
}

/** One page of the booking ledger (contract C7): `epoch` omitted = the current book of record. */
export interface LedgerPageParams {
  page: number;
  page_size: number;
  epoch?: number | null;
}

export const LEDGER_PAGE_SIZE = 100;

/**
 * GET /bookings/:id/ledger — one page of one epoch plus the server-computed C7 `summary` (current book) and `epoch_totals`.
 * Dues are always read from those totals, never from the last row of a page (a long ledger spans several pages).
 */
/** One ledger page of one epoch, sorted by seq (the query behind useBookingLedger). */
export function fetchBookingLedger(
  id: string,
  params: LedgerPageParams,
  signal?: AbortSignal,
): Promise<LedgerResponse> {
  return api.get<LedgerResponse>(`${BOOKINGS_PATH}/${id}/ledger`, {
    signal,
    query: {
      ...buildListQuery({ page: params.page, page_size: params.page_size, sort: "seq" }),
      epoch: params.epoch ?? undefined,
    },
  });
}

export function useBookingLedger(
  id: string | null | undefined,
  params: LedgerPageParams = { page: 1, page_size: LEDGER_PAGE_SIZE },
): UseQueryResult<LedgerResponse, ApiClientError> {
  return useQuery<LedgerResponse, ApiClientError, LedgerResponse, readonly unknown[]>({
    queryKey: bookingKeys.ledger(id ?? "", params),
    queryFn: ({ signal }) => fetchBookingLedger(id ?? "", params, signal),
    enabled: Boolean(id),
    placeholderData: (previous, previousQuery) => previousPageOfSameBooking(previous, previousQuery, id),
  });
}

/** GET /bookings/:id/ledger/rebuilds — every restatement of the ledger (newest first). */
export function useLedgerRebuilds(
  id: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<ListEnvelope<LedgerRebuildRow>, ApiClientError> {
  return useQuery<ListEnvelope<LedgerRebuildRow>, ApiClientError, ListEnvelope<LedgerRebuildRow>, readonly unknown[]>({
    queryKey: bookingKeys.ledgerRebuilds(id ?? ""),
    queryFn: ({ signal }) =>
      api.list<LedgerRebuildRow>(`${BOOKINGS_PATH}/${id}/ledger/rebuilds`, { page_size: 100, sort: "-at" }, { signal }),
    enabled: Boolean(id) && options.enabled !== false,
  });
}

export function useBookingSchedule(id: string | null | undefined): UseQueryResult<ScheduleResponse, ApiClientError> {
  return useApiQuery<ScheduleResponse>(bookingKeys.schedule(id ?? ""), `${BOOKINGS_PATH}/${id}/schedule`, {
    enabled: Boolean(id),
  });
}

/** Every demand of a booking, all pages (the demand-letter fallback needs the whole set). */
export function useBookingDemands(id: string | null | undefined): UseQueryResult<DemandRow[], ApiClientError> {
  return useQuery<DemandRow[], ApiClientError, DemandRow[], readonly unknown[]>({
    queryKey: bookingKeys.demands(id ?? ""),
    queryFn: async ({ signal }) =>
      (await fetchAllPages<DemandRow>(`${BOOKINGS_PATH}/${id}/demands`, { sort: "demand_date" }, { signal })).items,
    enabled: Boolean(id),
  });
}

/** One page of a booking's demands (the Demands tab pages through all of them). */
export function useBookingDemandsPage(
  id: string | null | undefined,
  page: number,
  pageSize: number,
): UseQueryResult<ListEnvelope<DemandRow>, ApiClientError> {
  return useQuery<ListEnvelope<DemandRow>, ApiClientError, ListEnvelope<DemandRow>, readonly unknown[]>({
    queryKey: bookingKeys.demandsPage(id ?? "", page, pageSize),
    queryFn: ({ signal }) =>
      api.list<DemandRow>(
        `${BOOKINGS_PATH}/${id}/demands`,
        { page, page_size: pageSize, sort: "demand_date" },
        { signal },
      ),
    enabled: Boolean(id),
    placeholderData: (previous, previousQuery) => previousPageOfSameBooking(previous, previousQuery, id),
  });
}

/** One page of a booking's payments, newest first (the Payments tab pages through all of them). */
export function useBookingPaymentsPage(
  id: string | null | undefined,
  page: number,
  pageSize: number,
): UseQueryResult<ListEnvelope<PaymentRow>, ApiClientError> {
  return useQuery<ListEnvelope<PaymentRow>, ApiClientError, ListEnvelope<PaymentRow>, readonly unknown[]>({
    queryKey: bookingKeys.paymentsPage(id ?? "", page, pageSize),
    queryFn: ({ signal }) =>
      api.list<PaymentRow>(
        `${BOOKINGS_PATH}/${id}/payments`,
        { page, page_size: pageSize, sort: "-payment_date" },
        { signal },
      ),
    enabled: Boolean(id),
    placeholderData: (previous, previousQuery) => previousPageOfSameBooking(previous, previousQuery, id),
  });
}

/** Audit trail of one booking (`GET /audit-logs/entity/booking/:id`), envelope or bare array. */
export function useBookingHistory(
  id: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<AuditLogRow[], ApiClientError> {
  return useQuery<ListEnvelope<AuditLogRow> | AuditLogRow[], ApiClientError, AuditLogRow[], readonly unknown[]>({
    queryKey: bookingKeys.history(id ?? ""),
    queryFn: ({ signal }) =>
      api.get<ListEnvelope<AuditLogRow> | AuditLogRow[]>(`${AUDIT_PATH}/entity/booking/${id}`, {
        signal,
        query: { page_size: 200 },
      }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    // The audit routes are guarded by audit.view; callers pass `enabled: can("audit.view")` so other roles never see a 403.
    enabled: Boolean(id) && options.enabled !== false,
  });
}

/** Every key that changes when a booking's money moves. */
export function bookingInvalidations(id: string): readonly (readonly unknown[])[] {
  return [
    bookingKeys.detail(id),
    [BOOKINGS_PATH, "ledger", id],
    bookingKeys.schedule(id),
    bookingKeys.demands(id),
    bookingKeys.payments(id),
    bookingKeys.history(id),
    [BOOKINGS_PATH, "list"],
    [PAYMENTS_PATH],
    [DEMANDS_PATH],
    ["/flats"],
    ["/blocks"],
  ];
}

/* ------------------------------------------------------------------ */
/* Plans & preview                                                      */
/* ------------------------------------------------------------------ */

/** Plans assigned to a tower on a date, default first (`GET /blocks/:id/applicable-plans`). */
export function useApplicablePlans(
  _projectId: string | null | undefined,
  blockId: string | null | undefined,
  onDate: string,
): UseQueryResult<ApplicablePlanRow[], ApiClientError> {
  return useQuery<
    ApplicablePlansResponse | ApplicablePlanRow[],
    ApiClientError,
    ApplicablePlanRow[],
    readonly unknown[]
  >({
    queryKey: bookingKeys.applicablePlans(blockId ?? "", onDate),
    queryFn: ({ signal }) =>
      api.get<ApplicablePlansResponse | ApplicablePlanRow[]>(`/blocks/${blockId}/applicable-plans`, {
        signal,
        query: { on_date: onDate || undefined },
      }),
    select: (data) => {
      const plans = Array.isArray(data) ? data : data.plans;
      return [...plans].sort((a, b) => Number(b.is_default) - Number(a.is_default));
    },
    enabled: Boolean(blockId),
    staleTime: 60_000,
  });
}

/** Live schedule preview for the wizard / plan-change dialog (`POST /bookings/preview-schedule`). */
export function useSchedulePreview(
  request: SchedulePreviewRequest | null,
): UseQueryResult<SchedulePreviewResponse, ApiClientError> {
  return useQuery<SchedulePreviewResponse, ApiClientError, SchedulePreviewResponse, readonly unknown[]>({
    queryKey: request ? bookingKeys.preview(request) : [BOOKINGS_PATH, "preview-schedule", "idle"],
    queryFn: ({ signal }) =>
      api.post<SchedulePreviewResponse>(`${BOOKINGS_PATH}/preview-schedule`, request, { signal }),
    enabled: request !== null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Wizard look-ups                                                      */
/* ------------------------------------------------------------------ */

/** Available parking slots of a project (`GET /projects/:id/parking?status=AVAILABLE`). */
export function useAvailableParking(
  projectId: string | null | undefined,
): UseQueryResult<ParkingSlotRow[], ApiClientError> {
  return useQuery<
    ListEnvelope<ParkingSlotRow> | ParkingSlotRow[],
    ApiClientError,
    ParkingSlotRow[],
    readonly unknown[]
  >({
    queryKey: bookingKeys.parking(projectId ?? ""),
    queryFn: ({ signal }) =>
      api.get<ListEnvelope<ParkingSlotRow> | ParkingSlotRow[]>(`/projects/${projectId}/parking`, {
        signal,
        query: { status: "AVAILABLE", page_size: 200, sort: "number" },
      }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled: Boolean(projectId),
  });
}

export function useChargeTypes(enabled = true): UseQueryResult<ChargeTypeRow[], ApiClientError> {
  return useMasterRows<ChargeTypeRow>("charge-types", { enabled });
}

export function useCustomerById(id: string | null | undefined): UseQueryResult<CustomerRow, ApiClientError> {
  return useApiQuery<CustomerRow>(bookingKeys.customer(id ?? ""), `/customers/${id}`, {
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** Phone-first customer search (`GET /customers?search=`). */
export async function searchCustomersByPhone(query: string, signal?: AbortSignal): Promise<CustomerRow[]> {
  const result = await api.list<CustomerRow>(
    "/customers",
    { page_size: 20, search: query, sort: "full_name" },
    { signal },
  );
  return result.items;
}

/** Booking search for the payment dialog (`GET /bookings?search=`). */
export async function searchBookings(query: string, signal?: AbortSignal): Promise<BookingRow[]> {
  const result = await api.list<BookingRow>(
    BOOKINGS_PATH,
    { page_size: 20, search: query, sort: "-booking_date", filters: { status: "ACTIVE" } },
    { signal },
  );
  return result.items;
}

/* ------------------------------------------------------------------ */
/* Drafts                                                               */
/* ------------------------------------------------------------------ */

export function useMyDrafts(enabled = true): UseQueryResult<BookingDraftRow[], ApiClientError> {
  return useQuery<
    ListEnvelope<BookingDraftRow> | BookingDraftRow[],
    ApiClientError,
    BookingDraftRow[],
    readonly unknown[]
  >({
    queryKey: bookingKeys.drafts,
    queryFn: ({ signal }) => api.get<ListEnvelope<BookingDraftRow> | BookingDraftRow[]>(DRAFTS_PATH, { signal }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled,
    retry: false,
  });
}

/** `PUT /booking-drafts` upserts by `id` (a missing/unknown id creates a new draft). */
export function saveDraft(body: BookingDraftUpsert): Promise<BookingDraftRow> {
  return api.put<BookingDraftRow>(DRAFTS_PATH, body);
}

/**
 * `DELETE /booking-drafts/:id` needs the draft's version (If-Match "v<n>", contract C6). When the caller does not know it (a draft
 * resumed from another device), it is read from my drafts first.
 */
export async function deleteDraft(id: string, version?: number | null): Promise<void> {
  let known = version ?? null;
  if (known === null) {
    const mine = await api.get<ListEnvelope<BookingDraftRow> | BookingDraftRow[]>(DRAFTS_PATH);
    const rows = Array.isArray(mine) ? mine : mine.items;
    const row = rows.find((draft) => draft.id === id);
    if (!row) return; // already gone
    known = row.version;
  }
  await api.delete(`${DRAFTS_PATH}/${id}`, { version: known });
}

/* ------------------------------------------------------------------ */
/* PDFs                                                                 */
/* ------------------------------------------------------------------ */

/** Streams a PDF and hands it to the browser. */
export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const result = await api.download(path);
  saveBlob(result.blob, result.filename && result.filename !== path.split("/").pop() ? result.filename : fallbackName);
}
