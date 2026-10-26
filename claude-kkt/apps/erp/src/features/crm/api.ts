import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  Customer360Response,
  CustomerRow,
  EnquiryUnreadCount,
  LeadDetailResponse,
  LeadKanbanResponse,
  LeadRow,
  PortalAccessResponse,
  VisitCalendarResponse,
  VisitRow,
} from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope, type QueryParams } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";

export const CUSTOMERS_PATH = "/customers";
export const LEADS_PATH = "/leads";
export const ENQUIRIES_PATH = "/enquiries";
export const VISITS_PATH = "/site-visits";
export const SERVICE_PATH = "/service-requests";
export const PAYMENTS_PATH = "/payments";
export const AUDIT_PATH = "/audit-logs";

export const crmKeys = {
  customer360: (id: string) => [CUSTOMERS_PATH, "360", id] as const,
  portal: (id: string) => [CUSTOMERS_PATH, "portal", id] as const,
  leadDetail: (id: string) => [LEADS_PATH, "detail", id] as const,
  board: (filters: QueryParams) => [LEADS_PATH, "board", filters] as const,
  followUpsDue: [LEADS_PATH, "follow-ups-due"] as const,
  enquiryUnread: [ENQUIRIES_PATH, "unread-count"] as const,
  calendar: (projectId: string, from: string, to: string) => [VISITS_PATH, "calendar", projectId, from, to] as const,
  today: [VISITS_PATH, "today"] as const,
};

/* ------------------------------------------------------------------ */
/* Customers                                                            */
/* ------------------------------------------------------------------ */

export function useCustomer360(id: string | null | undefined) {
  return useApiQuery<Customer360Response>(crmKeys.customer360(id ?? ""), `${CUSTOMERS_PATH}/${id}/360`, {
    enabled: Boolean(id),
  });
}

export function usePortalAccess(id: string | null | undefined, enabled = true) {
  return useApiQuery<PortalAccessResponse>(crmKeys.portal(id ?? ""), `${CUSTOMERS_PATH}/${id}/portal`, {
    enabled: enabled && Boolean(id),
    retry: false,
  });
}

/** Async option loader for customer comboboxes (name / code / phone). */
export async function searchCustomers(
  query: string,
): Promise<Array<{ value: string; label: string; description: string; keywords: string[] }>> {
  const result = await api.list<CustomerRow>(CUSTOMERS_PATH, { page_size: 20, search: query, sort: "full_name" });
  return result.items.map((customer) => ({
    value: customer.id,
    label: customer.full_name,
    description: `${customer.customer_code} · ${customer.phone}`,
    keywords: [customer.phone, customer.customer_code],
  }));
}

/** Async option loader for lead comboboxes. */
export async function searchLeads(
  query: string,
): Promise<Array<{ value: string; label: string; description: string; keywords: string[] }>> {
  const result = await api.list<LeadRow>(LEADS_PATH, { page_size: 20, search: query, sort: "-created_at" });
  return result.items.map((lead) => ({
    value: lead.id,
    label: lead.full_name,
    description: `${lead.lead_number} · ${lead.phone}${lead.project_name ? ` · ${lead.project_name}` : ""}`,
    keywords: [lead.phone, lead.lead_number],
  }));
}

/* ------------------------------------------------------------------ */
/* Leads                                                                */
/* ------------------------------------------------------------------ */

export function useLeadDetail(id: string | null | undefined) {
  return useApiQuery<LeadDetailResponse>(crmKeys.leadDetail(id ?? ""), `${LEADS_PATH}/${id}`, { enabled: Boolean(id) });
}

export function useLeadBoard(filters: QueryParams, enabled = true) {
  return useApiQuery<LeadKanbanResponse>(crmKeys.board(filters), `${LEADS_PATH}/board`, { query: filters, enabled });
}

function asArray<T>(raw: ListEnvelope<T> | T[] | undefined | null): T[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : raw.items;
}

/** Leads whose follow-up is due (today or overdue). Accepts an envelope or a bare array. */
export function useFollowUpsDue(enabled = true): UseQueryResult<LeadRow[], ApiClientError> {
  return useQuery<ListEnvelope<LeadRow> | LeadRow[], ApiClientError, LeadRow[], readonly unknown[]>({
    queryKey: crmKeys.followUpsDue,
    queryFn: ({ signal }) => api.get<ListEnvelope<LeadRow> | LeadRow[]>(`${LEADS_PATH}/follow-ups/due`, { signal }),
    select: asArray,
    enabled,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* Enquiries                                                            */
/* ------------------------------------------------------------------ */

export function useEnquiryUnreadCount(enabled = true): UseQueryResult<number, ApiClientError> {
  return useQuery<EnquiryUnreadCount | { count?: number }, ApiClientError, number, readonly unknown[]>({
    queryKey: crmKeys.enquiryUnread,
    queryFn: ({ signal }) =>
      api.get<EnquiryUnreadCount | { count?: number }>(`${ENQUIRIES_PATH}/unread-count`, { signal }),
    select: (data) =>
      "unread" in data && typeof data.unread === "number"
        ? data.unread
        : "count" in data && typeof data.count === "number"
          ? data.count
          : 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Site visits                                                          */
/* ------------------------------------------------------------------ */

export interface CalendarSlot {
  start: string;
  end: string;
  seats: number;
  booked: number;
  available: number;
  is_past: boolean;
  visits: VisitRow[];
}

export interface CalendarDay {
  date: string;
  is_visit_day: boolean;
  is_blackout: boolean;
  slots: CalendarSlot[];
}

interface LooseCalendar {
  days?: unknown;
  dates?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Accepts the contracts shape (`days`) and the brief's (`dates`), filling missing counters. */
export function normaliseCalendar(raw: unknown): CalendarDay[] {
  const record = (raw ?? {}) as LooseCalendar;
  const list = Array.isArray(record.days) ? record.days : Array.isArray(record.dates) ? record.dates : [];
  return list.flatMap((entry) => {
    const day = asRecord(entry);
    if (!day || typeof day.date !== "string") return [];
    const slots = Array.isArray(day.slots) ? day.slots : [];
    return [
      {
        date: day.date,
        is_visit_day: day.is_visit_day !== false,
        is_blackout: day.is_blackout === true,
        slots: slots.flatMap((item) => {
          const slot = asRecord(item);
          if (!slot || typeof slot.start !== "string") return [];
          const visits = Array.isArray(slot.visits) ? (slot.visits as VisitRow[]) : [];
          const available = typeof slot.available === "number" ? slot.available : 0;
          const booked =
            typeof slot.booked === "number"
              ? slot.booked
              : visits.filter((visit) => visit.status !== "CANCELLED").length;
          return [
            {
              start: slot.start,
              end: typeof slot.end === "string" ? slot.end : slot.start,
              seats: typeof slot.seats === "number" ? slot.seats : available + booked,
              booked,
              available,
              is_past: slot.is_past === true,
              visits,
            },
          ];
        }),
      },
    ];
  });
}

export function useVisitCalendar(
  projectId: string | null,
  from: string,
  to: string,
  assigneeUserId?: string | null,
): UseQueryResult<CalendarDay[], ApiClientError> {
  return useQuery<unknown, ApiClientError, CalendarDay[], readonly unknown[]>({
    queryKey: [...crmKeys.calendar(projectId ?? "", from, to), assigneeUserId ?? ""],
    queryFn: ({ signal }) =>
      api.get<VisitCalendarResponse>(`${VISITS_PATH}/calendar`, {
        signal,
        query: {
          project_id: projectId ?? "",
          from,
          to,
          ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
        },
      }),
    select: normaliseCalendar,
    enabled: Boolean(projectId),
  });
}

export function useVisitsToday(enabled = true): UseQueryResult<VisitRow[], ApiClientError> {
  return useQuery<ListEnvelope<VisitRow> | VisitRow[], ApiClientError, VisitRow[], readonly unknown[]>({
    queryKey: crmKeys.today,
    queryFn: ({ signal }) => api.get<ListEnvelope<VisitRow> | VisitRow[]>(`${VISITS_PATH}/today`, { signal }),
    select: asArray,
    enabled,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/** YYYY-MM-DD + n days (calendar arithmetic in UTC to avoid DST drift). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = (base.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

/** "2026-10-24" → "Sat 24 Oct". */
export function shortDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return value.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "10:00" → "10:00 am". */
export function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h ?? 0;
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}

/** Portal base URL: company setting, else build-time env, else the API's login_url. */
export function portalBaseUrl(settings: Record<string, unknown> | undefined, fallback: string | null): string | null {
  const fromSettings = settings?.portal_url;
  if (typeof fromSettings === "string" && fromSettings) return fromSettings.replace(/\/+$/, "");
  const env = (import.meta.env as Record<string, string | undefined>).VITE_PORTAL_URL;
  if (env) return env.replace(/\/+$/, "");
  return fallback;
}

/** wa.me deep link with a prefilled message. */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
