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
  LedgerRow,
  ParkingSlotRow,
  PaymentRow,
  SchedulePreviewRequest,
  SchedulePreviewResponse,
  ScheduleResponse,
} from "@kkt/contracts";
import { api, saveBlob, type ApiClientError, type ListEnvelope, type ListParams } from "@/lib/api";
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
  ledger: (id: string, params: ListParams) => [BOOKINGS_PATH, "ledger", id, params] as const,
  schedule: (id: string) => [BOOKINGS_PATH, "schedule", id] as const,
  demands: (id: string) => [BOOKINGS_PATH, "demands", id] as const,
  payments: (id: string) => [BOOKINGS_PATH, "payments", id] as const,
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
  return useApiQuery<BookingDetailResponse>(bookingKeys.detail(id ?? ""), `${BOOKINGS_PATH}/${id}`, { enabled: Boolean(id) });
}

export function useBookingLedger(id: string | null | undefined, params: ListParams = { page_size: 200, sort: "seq" }): UseQueryResult<ListEnvelope<LedgerRow>, ApiClientError> {
  return useQuery<ListEnvelope<LedgerRow>, ApiClientError, ListEnvelope<LedgerRow>, readonly unknown[]>({
    queryKey: bookingKeys.ledger(id ?? "", params),
    queryFn: ({ signal }) => api.list<LedgerRow>(`${BOOKINGS_PATH}/${id}/ledger`, params, { signal }),
    enabled: Boolean(id),
  });
}

export function useBookingSchedule(id: string | null | undefined): UseQueryResult<ScheduleResponse, ApiClientError> {
  return useApiQuery<ScheduleResponse>(bookingKeys.schedule(id ?? ""), `${BOOKINGS_PATH}/${id}/schedule`, { enabled: Boolean(id) });
}

export function useBookingDemands(id: string | null | undefined): UseQueryResult<DemandRow[], ApiClientError> {
  return useQuery<ListEnvelope<DemandRow>, ApiClientError, DemandRow[], readonly unknown[]>({
    queryKey: bookingKeys.demands(id ?? ""),
    queryFn: ({ signal }) => api.list<DemandRow>(`${BOOKINGS_PATH}/${id}/demands`, { page_size: 200, sort: "demand_date" }, { signal }),
    select: (data) => data.items,
    enabled: Boolean(id),
  });
}

export function useBookingPayments(id: string | null | undefined): UseQueryResult<PaymentRow[], ApiClientError> {
  return useQuery<ListEnvelope<PaymentRow>, ApiClientError, PaymentRow[], readonly unknown[]>({
    queryKey: bookingKeys.payments(id ?? ""),
    queryFn: ({ signal }) => api.list<PaymentRow>(`${BOOKINGS_PATH}/${id}/payments`, { page_size: 200, sort: "-payment_date" }, { signal }),
    select: (data) => data.items,
    enabled: Boolean(id),
  });
}

/** Audit trail of one booking (`GET /audit-logs/entity/booking/:id`), envelope or bare array. */
export function useBookingHistory(id: string | null | undefined): UseQueryResult<AuditLogRow[], ApiClientError> {
  return useQuery<ListEnvelope<AuditLogRow> | AuditLogRow[], ApiClientError, AuditLogRow[], readonly unknown[]>({
    queryKey: bookingKeys.history(id ?? ""),
    queryFn: ({ signal }) => api.get<ListEnvelope<AuditLogRow> | AuditLogRow[]>(`${AUDIT_PATH}/entity/booking/${id}`, { signal, query: { page_size: 200 } }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled: Boolean(id),
  });
}

/** Every key that changes when a booking's money moves. */
export function bookingInvalidations(id: string): readonly (readonly unknown[])[] {
  return [bookingKeys.detail(id), [BOOKINGS_PATH, "ledger", id], bookingKeys.schedule(id), bookingKeys.demands(id), bookingKeys.payments(id), bookingKeys.history(id), [BOOKINGS_PATH, "list"], [PAYMENTS_PATH], [DEMANDS_PATH], ["/flats"], ["/blocks"]];
}

/* ------------------------------------------------------------------ */
/* Plans & preview                                                      */
/* ------------------------------------------------------------------ */

/** Plans assigned to a tower on a date, default first (`GET /blocks/:id/applicable-plans`). */
export function useApplicablePlans(_projectId: string | null | undefined, blockId: string | null | undefined, onDate: string): UseQueryResult<ApplicablePlanRow[], ApiClientError> {
  return useQuery<ApplicablePlansResponse | ApplicablePlanRow[], ApiClientError, ApplicablePlanRow[], readonly unknown[]>({
    queryKey: bookingKeys.applicablePlans(blockId ?? "", onDate),
    queryFn: ({ signal }) => api.get<ApplicablePlansResponse | ApplicablePlanRow[]>(`/blocks/${blockId}/applicable-plans`, { signal, query: { on_date: onDate || undefined } }),
    select: (data) => {
      const plans = Array.isArray(data) ? data : data.plans;
      return [...plans].sort((a, b) => Number(b.is_default) - Number(a.is_default));
    },
    enabled: Boolean(blockId),
    staleTime: 60_000,
  });
}

/** Live schedule preview for the wizard / plan-change dialog (`POST /bookings/preview-schedule`). */
export function useSchedulePreview(request: SchedulePreviewRequest | null): UseQueryResult<SchedulePreviewResponse, ApiClientError> {
  return useQuery<SchedulePreviewResponse, ApiClientError, SchedulePreviewResponse, readonly unknown[]>({
    queryKey: request ? bookingKeys.preview(request) : [BOOKINGS_PATH, "preview-schedule", "idle"],
    queryFn: ({ signal }) => api.post<SchedulePreviewResponse>(`${BOOKINGS_PATH}/preview-schedule`, request, { signal }),
    enabled: request !== null,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Wizard look-ups                                                      */
/* ------------------------------------------------------------------ */

/** Available parking slots of a project (`GET /projects/:id/parking?status=AVAILABLE`). */
export function useAvailableParking(projectId: string | null | undefined): UseQueryResult<ParkingSlotRow[], ApiClientError> {
  return useQuery<ListEnvelope<ParkingSlotRow> | ParkingSlotRow[], ApiClientError, ParkingSlotRow[], readonly unknown[]>({
    queryKey: bookingKeys.parking(projectId ?? ""),
    queryFn: ({ signal }) => api.get<ListEnvelope<ParkingSlotRow> | ParkingSlotRow[]>(`/projects/${projectId}/parking`, { signal, query: { status: "AVAILABLE", page_size: 200, sort: "number" } }),
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled: Boolean(projectId),
  });
}

export function useChargeTypes(enabled = true): UseQueryResult<ChargeTypeRow[], ApiClientError> {
  return useMasterRows<ChargeTypeRow>("charge-types", { enabled });
}

export function useCustomerById(id: string | null | undefined): UseQueryResult<CustomerRow, ApiClientError> {
  return useApiQuery<CustomerRow>(bookingKeys.customer(id ?? ""), `/customers/${id}`, { enabled: Boolean(id), staleTime: 60_000 });
}

/** Phone-first customer search (`GET /customers?search=`). */
export async function searchCustomersByPhone(query: string, signal?: AbortSignal): Promise<CustomerRow[]> {
  const result = await api.list<CustomerRow>("/customers", { page_size: 20, search: query, sort: "full_name" }, { signal });
  return result.items;
}

/** Booking search for the payment dialog (`GET /bookings?search=`). */
export async function searchBookings(query: string, signal?: AbortSignal): Promise<BookingRow[]> {
  const result = await api.list<BookingRow>(BOOKINGS_PATH, { page_size: 20, search: query, sort: "-booking_date", filters: { status: "ACTIVE" } }, { signal });
  return result.items;
}

/* ------------------------------------------------------------------ */
/* Drafts                                                               */
/* ------------------------------------------------------------------ */

export function useMyDrafts(enabled = true): UseQueryResult<BookingDraftRow[], ApiClientError> {
  return useQuery<ListEnvelope<BookingDraftRow> | BookingDraftRow[], ApiClientError, BookingDraftRow[], readonly unknown[]>({
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

export function deleteDraft(id: string): Promise<void> {
  return api.delete(`${DRAFTS_PATH}/${id}`);
}

/* ------------------------------------------------------------------ */
/* PDFs                                                                 */
/* ------------------------------------------------------------------ */

/** Streams a PDF and hands it to the browser. */
export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const result = await api.download(path);
  saveBlob(result.blob, result.filename && result.filename !== path.split("/").pop() ? result.filename : fallbackName);
}
