import { Check, Phone, Plus, Search, UserPlus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KYC_STATUS_LABELS, type CustomerRow } from "@kkt/contracts";
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  FieldWrapper,
  Input,
  Skeleton,
  Spinner,
  StatusChip,
  type ComboboxOption,
} from "@/components/ui";
import type { ApiClientError } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { cn, useDebouncedValue, useOnChange } from "@/lib/utils";
import { CustomerFormSheet } from "@/features/crm/CustomerFormSheet";
import { Notice } from "@/features/inventory/components";
import { searchCustomersByPhone, useCustomerById } from "../api";
import type { StepProps } from "./types";

function CustomerSummary({
  customer,
  selected,
  onPick,
  onRemove,
  compact = false,
}: {
  customer: CustomerRow;
  selected?: boolean;
  onPick?: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2",
        selected ? "border-navy-950 bg-navy-50" : "border-border bg-card",
        onPick && "cursor-pointer hover:border-navy-300",
      )}
      onClick={onPick}
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onPick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onPick();
        }
      }}
      data-testid={`customer-option-${customer.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
          {customer.full_name}
          <span className="money text-2xs font-medium text-ink-subtle">{customer.customer_code}</span>
          {!compact && (
            <StatusChip
              status={customer.kyc_status}
              label={`KYC ${KYC_STATUS_LABELS[customer.kyc_status]}`}
              size="sm"
            />
          )}
        </p>
        <p className="money text-xs text-ink-muted">
          {formatPhone(customer.phone)}
          {customer.email ? ` · ${customer.email}` : ""}
          {customer.active_booking_count > 0
            ? ` · ${customer.active_booking_count} active booking${customer.active_booking_count === 1 ? "" : "s"}`
            : ""}
        </p>
      </div>
      {selected && <Check className="size-4 shrink-0 text-navy-950" aria-hidden="true" />}
      {onRemove && (
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Remove ${customer.full_name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function usePhoneSearch(query: string) {
  const debounced = useDebouncedValue(query.trim(), 300);
  return useQuery<CustomerRow[], ApiClientError>({
    queryKey: ["/customers", "wizard-search", debounced],
    queryFn: ({ signal }) => searchCustomersByPhone(debounced, signal),
    enabled: debounced.length >= 3,
    staleTime: 30_000,
  });
}

/** Step 2 — primary applicant (search by phone, create inline) and co-applicants. */
export function StepCustomer({ state, update, errors, showErrors, can }: StepProps) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [coApplicants, setCoApplicants] = useState<Map<string, CustomerRow>>(new Map());
  const search = usePhoneSearch(query);
  const selected = useCustomerById(state.customer_id);

  // Hydrate co-applicant chips when resuming a draft.
  const missing = state.co_applicant_ids.filter((id) => !coApplicants.has(id));
  const hydrate = useCustomerById(missing[0] ?? null);
  useOnChange(hydrate.data, (row) => {
    if (row) setCoApplicants((previous) => (previous.has(row.id) ? previous : new Map(previous).set(row.id, row)));
  });

  const results = useMemo(() => (search.data ?? []).filter((row) => !row.erased_at), [search.data]);
  const error = (key: string) => (showErrors ? errors[key] : undefined);

  const pick = (customer: CustomerRow) => {
    update({ customer_id: customer.id, co_applicant_ids: state.co_applicant_ids.filter((id) => id !== customer.id) });
    setQuery("");
  };

  const addCoApplicant = (customer: CustomerRow) => {
    if (customer.id === state.customer_id || state.co_applicant_ids.includes(customer.id)) return;
    setCoApplicants((previous) => new Map(previous).set(customer.id, customer));
    update({ co_applicant_ids: [...state.co_applicant_ids, customer.id] });
  };

  const coSearch = useCallback(
    async (text: string): Promise<ComboboxOption[]> => {
      if (text.trim().length < 2) return [];
      const rows = await searchCustomersByPhone(text.trim());
      return rows
        .filter((row) => row.id !== state.customer_id && !state.co_applicant_ids.includes(row.id))
        .map((row) => ({
          value: row.id,
          label: row.full_name,
          description: `${row.customer_code} · ${formatPhone(row.phone)}`,
          keywords: [row.phone, row.customer_code],
        }));
    },
    [state.customer_id, state.co_applicant_ids],
  );
  const [coResults, setCoResults] = useState<Map<string, CustomerRow>>(new Map());
  const coSearchCaching = useCallback(
    async (text: string) => {
      const rows = text.trim().length < 2 ? [] : await searchCustomersByPhone(text.trim());
      setCoResults(new Map(rows.map((row) => [row.id, row] as const)));
      return coSearch(text);
    },
    [coSearch],
  );

  const seedPhone = /^\d{10}$/.test(query.replace(/\D/g, "")) ? query.replace(/\D/g, "") : "";

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="font-display text-md font-bold text-navy-950">Primary applicant</h3>
        {selected.data && state.customer_id ? (
          <div className="space-y-2" data-testid="wizard-selected-customer">
            <CustomerSummary customer={selected.data} selected />
            <Button size="sm" variant="outline" leftIcon={Search} onClick={() => update({ customer_id: null })}>
              Choose a different customer
            </Button>
          </div>
        ) : state.customer_id && selected.isPending ? (
          <Skeleton className="h-14" />
        ) : (
          <>
            <FieldWrapper
              label="Search by phone (or name / code)"
              required
              error={error("customer_id")}
              hint="Type at least 3 digits of the mobile number"
            >
              {(control) => (
                <Input
                  id={control.id}
                  type="search"
                  inputMode="tel"
                  leftIcon={Phone}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="98765 43210"
                  autoFocus
                  className="money"
                  invalid={control.invalid}
                  data-testid="wizard-customer-search"
                />
              )}
            </FieldWrapper>
            {query.trim().length >= 3 && (
              <div className="space-y-2" aria-live="polite">
                {search.isFetching && !search.data && (
                  <p className="flex items-center gap-2 text-xs text-ink-subtle">
                    <Spinner size="xs" /> Searching…
                  </p>
                )}
                {search.data && results.length === 0 && (
                  <EmptyState
                    compact
                    icon={UserPlus}
                    title="No customer matches"
                    description={
                      can.writeCustomer
                        ? "Create the customer here without leaving the booking."
                        : "Ask a colleague with customer access to create the record."
                    }
                    action={
                      can.writeCustomer ? (
                        <Button
                          size="sm"
                          leftIcon={Plus}
                          onClick={() => setCreateOpen(true)}
                          data-testid="wizard-create-customer"
                        >
                          Create customer
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                {results.map((customer) => (
                  <CustomerSummary key={customer.id} customer={customer} onPick={() => pick(customer)} />
                ))}
                {results.length > 0 && can.writeCustomer && (
                  <Button size="sm" variant="ghost" leftIcon={Plus} onClick={() => setCreateOpen(true)}>
                    Not listed? Create customer
                  </Button>
                )}
              </div>
            )}
            {query.trim().length < 3 && can.writeCustomer && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={Plus}
                onClick={() => setCreateOpen(true)}
                data-testid="wizard-create-customer-idle"
              >
                Create new customer
              </Button>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-md font-bold text-navy-950">
          Co-applicants <span className="text-xs font-normal text-ink-subtle">(optional, up to 10)</span>
        </h3>
        {error("co_applicant_ids") && <Notice tone="danger">{error("co_applicant_ids")}</Notice>}
        <div className="space-y-2">
          {state.co_applicant_ids.map((id) => {
            const row = coApplicants.get(id);
            return row ? (
              <CustomerSummary
                key={id}
                customer={row}
                compact
                onRemove={() => update({ co_applicant_ids: state.co_applicant_ids.filter((item) => item !== id) })}
              />
            ) : (
              <Skeleton key={id} className="h-12" />
            );
          })}
        </div>
        <Combobox
          value={null}
          onValueChange={(value) => {
            const row = value ? coResults.get(value) : undefined;
            if (row) addCoApplicant(row);
          }}
          onSearch={coSearchCaching}
          placeholder="Add a co-applicant by phone or name…"
          searchPlaceholder="Phone, name or code"
          emptyText="Type to search customers"
          disabled={state.co_applicant_ids.length >= 10}
          aria-label="Add a co-applicant"
          data-testid="wizard-co-applicant-search"
        />
        {state.co_applicant_ids.length > 0 && (
          <Badge variant="navy" numeric>
            {state.co_applicant_ids.length} co-applicant{state.co_applicant_ids.length === 1 ? "" : "s"}
          </Badge>
        )}
      </section>

      <CustomerFormSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        customer={null}
        seed={{ phone: seedPhone, source: "WALK_IN" }}
        onSaved={(customer) => {
          setCreateOpen(false);
          if (state.customer_id) addCoApplicant(customer);
          else pick(customer);
        }}
      />
    </div>
  );
}
