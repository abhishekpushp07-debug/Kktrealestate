import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AuditLogRow, BookingRow, ServiceCategoryRow, ServiceKanbanResponse, ServiceRequestDetailResponse, ServiceRequestRow } from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope, type QueryParams } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";
import { useMasterRows } from "@/features/masters/api";

/* ------------------------------------------------------------------ */
/* Paths & keys                                                         */
/* ------------------------------------------------------------------ */

export const SERVICE_PATH = "/service-requests";
export const AUDIT_PATH = "/audit-logs";

export const serviceKeys = {
  board: (filters: QueryParams) => [SERVICE_PATH, "board", filters] as const,
  detail: (id: string) => [SERVICE_PATH, "detail", id] as const,
  slaBreaches: [SERVICE_PATH, "sla-breaches"] as const,
  history: (id: string) => [AUDIT_PATH, "entity", "service_request", id] as const,
  customerBookings: (customerId: string) => ["/bookings", "by-customer", customerId] as const,
};

/** Every key that changes when a ticket moves. */
export function serviceInvalidations(id?: string): readonly (readonly unknown[])[] {
  const keys: (readonly unknown[])[] = [[SERVICE_PATH]];
  if (id) keys.push(serviceKeys.detail(id), serviceKeys.history(id));
  return keys;
}

function asArray<T>(raw: ListEnvelope<T> | T[] | undefined | null): T[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : raw.items;
}

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

/** `GET /service-requests/board` — tickets grouped by status (every column capped by `column_limit`). */
export function useServiceBoard(filters: QueryParams, enabled = true): UseQueryResult<ServiceKanbanResponse, ApiClientError> {
  return useApiQuery<ServiceKanbanResponse>(serviceKeys.board(filters), `${SERVICE_PATH}/board`, { query: filters, enabled, placeholderData: (previous) => previous });
}

/** `GET /service-requests/:id` — ticket + thread (internal notes included for staff). */
export function useServiceDetail(id: string | null | undefined): UseQueryResult<ServiceRequestDetailResponse, ApiClientError> {
  return useApiQuery<ServiceRequestDetailResponse>(serviceKeys.detail(id ?? ""), `${SERVICE_PATH}/${id}`, { enabled: Boolean(id) });
}

/** `GET /service-requests/sla-breaches` — open tickets past their SLA (envelope or bare array). */
export function useSlaBreaches(enabled = true): UseQueryResult<ServiceRequestRow[], ApiClientError> {
  return useQuery<ListEnvelope<ServiceRequestRow> | ServiceRequestRow[], ApiClientError, ServiceRequestRow[], readonly unknown[]>({
    queryKey: serviceKeys.slaBreaches,
    queryFn: ({ signal }) => api.get<ListEnvelope<ServiceRequestRow> | ServiceRequestRow[]>(`${SERVICE_PATH}/sla-breaches`, { signal, query: { page_size: 50 } }),
    select: asArray,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    retry: false,
    enabled,
  });
}

/** Audit trail of one ticket (`GET /audit-logs/entity/service_request/:id`); absent endpoints degrade to an empty list. */
export function useTicketHistory(id: string | null | undefined, options: { enabled?: boolean } = {}): UseQueryResult<AuditLogRow[], ApiClientError> {
  return useQuery<ListEnvelope<AuditLogRow> | AuditLogRow[], ApiClientError, AuditLogRow[], readonly unknown[]>({
    queryKey: serviceKeys.history(id ?? ""),
    queryFn: ({ signal }) => api.get<ListEnvelope<AuditLogRow> | AuditLogRow[]>(`${AUDIT_PATH}/entity/service_request/${id}`, { signal, query: { page_size: 100 } }),
    select: asArray,
    // Guarded by audit.view on the API; callers pass `enabled: can("audit.view")`.
    enabled: Boolean(id) && options.enabled !== false,
    retry: false,
  });
}

/** Active service categories (`GET /masters/service-categories`). */
export function useServiceCategories(enabled = true): UseQueryResult<ServiceCategoryRow[], ApiClientError> {
  return useMasterRows<ServiceCategoryRow>("service-categories", { enabled, sort: "sort_order" });
}

/** Bookings of one customer for the ticket form (`GET /bookings?customer_id=`). */
export function useCustomerBookings(customerId: string | null | undefined): UseQueryResult<BookingRow[], ApiClientError> {
  return useQuery<ListEnvelope<BookingRow>, ApiClientError, BookingRow[], readonly unknown[]>({
    queryKey: serviceKeys.customerBookings(customerId ?? ""),
    queryFn: ({ signal }) => api.list<BookingRow>("/bookings", { page_size: 50, sort: "-booking_date", filters: { customer_id: customerId ?? "" } }, { signal }),
    select: (data) => data.items,
    enabled: Boolean(customerId),
  });
}
