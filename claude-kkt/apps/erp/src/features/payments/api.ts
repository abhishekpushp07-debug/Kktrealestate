import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  BankAccountRow,
  ChequeRow,
  ContraEntryCreate,
  ContraEntryRow,
  DemandLetterData,
  IntegrityReportResponse,
  IntegrityRepairResponse,
  PaymentBounce,
  PaymentClear,
  PaymentCreate,
  PaymentModeRow,
  PaymentPostResponse,
  PaymentReverse,
  PaymentRow,
  ReceiptData,
  RoznamchaResponse,
  RunDuesRequest,
  RunDuesResponse,
} from "@kkt/contracts";
import { api, type ApiClientError, type ListEnvelope, type QueryParams } from "@/lib/api";
import { useApiQuery } from "@/features/inventory/api";
import { useMasterRows } from "@/features/masters/api";

/* ------------------------------------------------------------------ */
/* Paths & keys                                                         */
/* ------------------------------------------------------------------ */

export const PAYMENTS_PATH = "/payments";
export const CHEQUES_PATH = "/payments/cheques";
export const DEMANDS_PATH = "/demands";
export const DUES_PATH = "/dues";
export const ROZNAMCHA_PATH = "/roznamcha";
export const CONTRA_PATH = "/roznamcha/contra";

export const paymentKeys = {
  item: (id: string) => [PAYMENTS_PATH, "item", id] as const,
  receipt: (id: string) => [PAYMENTS_PATH, "receipt", id] as const,
  cheques: (params: QueryParams) => [CHEQUES_PATH, params] as const,
  demandLetter: (bookingId: string, demandId: string) => ["/bookings", "demand-letter", bookingId, demandId] as const,
  integrity: [DUES_PATH, "integrity"] as const,
  roznamcha: (from: string, to: string, projectId: string | null) =>
    [ROZNAMCHA_PATH, from, to, projectId ?? ""] as const,
  contra: (params: QueryParams) => [CONTRA_PATH, "list", params] as const,
};

/* ------------------------------------------------------------------ */
/* Masters used by the dialog                                           */
/* ------------------------------------------------------------------ */

export function usePaymentModes(enabled = true): UseQueryResult<PaymentModeRow[], ApiClientError> {
  return useMasterRows<PaymentModeRow>("payment-modes", { enabled, sort: "sort_order" });
}

export function useBankAccounts(enabled = true): UseQueryResult<BankAccountRow[], ApiClientError> {
  return useMasterRows<BankAccountRow>("bank-accounts", { enabled, sort: "bank_name" });
}

export function bankAccountLabel(
  account: Pick<BankAccountRow, "bank_name" | "account_number_masked" | "branch" | "is_escrow">,
): string {
  return `${account.bank_name} ${account.account_number_masked}${account.branch ? ` · ${account.branch}` : ""}${account.is_escrow ? " · Escrow" : ""}`;
}

/* ------------------------------------------------------------------ */
/* Payments                                                             */
/* ------------------------------------------------------------------ */

export function usePayment(id: string | null | undefined): UseQueryResult<PaymentRow, ApiClientError> {
  return useApiQuery<PaymentRow>(paymentKeys.item(id ?? ""), `${PAYMENTS_PATH}/${id}`, { enabled: Boolean(id) });
}

export function useReceipt(id: string | null | undefined): UseQueryResult<ReceiptData, ApiClientError> {
  return useApiQuery<ReceiptData>(paymentKeys.receipt(id ?? ""), `${PAYMENTS_PATH}/${id}/receipt`, {
    enabled: Boolean(id),
  });
}

/** `POST /payments` — the client always sends an Idempotency-Key; pass one to retry the same posting safely. */
export function postPayment(body: PaymentCreate, idempotencyKey: string): Promise<PaymentPostResponse | PaymentRow> {
  return api.post<PaymentPostResponse | PaymentRow>(PAYMENTS_PATH, body, { idempotencyKey });
}

/** Normalises the posting response (envelope or bare row) to the payment row. */
export function paymentFromPostResponse(response: PaymentPostResponse | PaymentRow): PaymentRow {
  return "payment" in response ? response.payment : response;
}

export function clearPayment(
  payment: Pick<PaymentRow, "id" | "version">,
  body: Omit<PaymentClear, "version">,
): Promise<PaymentRow> {
  return api.post<PaymentRow>(
    `${PAYMENTS_PATH}/${payment.id}/clear`,
    { ...body, version: payment.version },
    { version: payment.version },
  );
}

export function bouncePayment(
  payment: Pick<PaymentRow, "id" | "version">,
  body: Omit<PaymentBounce, "version">,
): Promise<PaymentRow> {
  return api.post<PaymentRow>(
    `${PAYMENTS_PATH}/${payment.id}/bounce`,
    { ...body, version: payment.version },
    { version: payment.version },
  );
}

export function reversePayment(
  payment: Pick<PaymentRow, "id" | "version">,
  body: Omit<PaymentReverse, "version">,
): Promise<PaymentRow> {
  return api.post<PaymentRow>(
    `${PAYMENTS_PATH}/${payment.id}/reverse`,
    { ...body, version: payment.version },
    { version: payment.version },
  );
}

/** Keys invalidated by any payment state change. */
export const PAYMENT_INVALIDATIONS: readonly (readonly unknown[])[] = [
  [PAYMENTS_PATH],
  [CHEQUES_PATH],
  ["/bookings"],
  [DEMANDS_PATH],
  [ROZNAMCHA_PATH],
  ["/dashboard"],
];

/* ------------------------------------------------------------------ */
/* Cheques                                                              */
/* ------------------------------------------------------------------ */

export function useCheques(
  params: QueryParams,
  enabled = true,
): UseQueryResult<ListEnvelope<ChequeRow>, ApiClientError> {
  return useQuery<ListEnvelope<ChequeRow>, ApiClientError, ListEnvelope<ChequeRow>, readonly unknown[]>({
    queryKey: paymentKeys.cheques(params),
    queryFn: ({ signal }) => api.get<ListEnvelope<ChequeRow>>(CHEQUES_PATH, { signal, query: params }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/* ------------------------------------------------------------------ */
/* Demand letters, dues & integrity                                     */
/* ------------------------------------------------------------------ */

/** Demand letter data (`GET /bookings/:id/demands/:demandId/letter`). */
export function useDemandLetter(
  bookingId: string | null | undefined,
  demandId: string | null | undefined,
): UseQueryResult<DemandLetterData, ApiClientError> {
  return useApiQuery<DemandLetterData>(
    paymentKeys.demandLetter(bookingId ?? "", demandId ?? ""),
    `/bookings/${bookingId}/demands/${demandId}/letter`,
    {
      enabled: Boolean(bookingId && demandId),
      retry: false,
    },
  );
}

export function runDues(body: RunDuesRequest = {}): Promise<RunDuesResponse> {
  return api.post<RunDuesResponse>(`${DUES_PATH}/run`, body);
}

export function useIntegrityReport(enabled: boolean): UseQueryResult<IntegrityReportResponse, ApiClientError> {
  return useApiQuery<IntegrityReportResponse>(paymentKeys.integrity, `${DUES_PATH}/integrity`, {
    enabled,
    retry: false,
    staleTime: 0,
  });
}

export function repairIntegrity(runId?: string | null): Promise<IntegrityRepairResponse> {
  return api.post<IntegrityRepairResponse>(
    `${DUES_PATH}/integrity/repair`,
    runId ? { confirm: "REPAIR", run_id: runId } : { confirm: "REPAIR" },
  );
}

/* ------------------------------------------------------------------ */
/* Roznamcha                                                            */
/* ------------------------------------------------------------------ */

/** Day book: `GET /roznamcha?date[&project_id]` for one day, `GET /roznamcha/range?from&to[&project_id]` for a range. */
export function useRoznamcha(
  from: string,
  to: string,
  projectId: string | null,
  enabled = true,
): UseQueryResult<RoznamchaResponse, ApiClientError> {
  const single = from === to;
  return useApiQuery<RoznamchaResponse>(
    paymentKeys.roznamcha(from, to, projectId),
    single ? ROZNAMCHA_PATH : `${ROZNAMCHA_PATH}/range`,
    {
      query: single
        ? { date: from, project_id: projectId ?? undefined }
        : { from, to, project_id: projectId ?? undefined },
      enabled: enabled && Boolean(from && to && from <= to),
      placeholderData: (previous) => previous,
    },
  );
}

export function useContraEntries(
  params: QueryParams,
  enabled = true,
): UseQueryResult<ListEnvelope<ContraEntryRow>, ApiClientError> {
  return useQuery<ListEnvelope<ContraEntryRow>, ApiClientError, ListEnvelope<ContraEntryRow>, readonly unknown[]>({
    queryKey: paymentKeys.contra(params),
    queryFn: ({ signal }) => api.get<ListEnvelope<ContraEntryRow>>(CONTRA_PATH, { signal, query: params }),
    enabled,
  });
}

export function createContraEntry(body: ContraEntryCreate): Promise<ContraEntryRow> {
  return api.post<ContraEntryRow>(CONTRA_PATH, body);
}
