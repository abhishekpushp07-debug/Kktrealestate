import { ArrowDownToLine, ArrowUpFromLine, Landmark, Printer, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CONTRA_TYPE_LABELS, CONTRA_TYPES, MONEY_CATEGORY_LABELS, PAYMENT_MODE_CODE_LABELS, type ContraEntryRow, type ContraType, type RoznamchaReceiptRow, type RoznamchaResponse } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DateInput, EmptyState, ErrorState, FieldWrapper, FormError, MoneyInput, PageHeader, Select, SimpleDialog, Skeleton, StatCard, Tabs, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { addDays } from "@/features/crm/api";
import { formatDate, formatDateTime, formatINR, formatINRShort, formatNumber, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useProjectOptions } from "@/features/shared/options";
import { bankAccountLabel, createContraEntry, ROZNAMCHA_PATH, useBankAccounts, useRoznamcha } from "./api";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .kkt-roz-print, .kkt-roz-print * { visibility: visible !important; }
  .kkt-roz-print { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
  .kkt-roz-print .kkt-no-print { display: none !important; }
  .kkt-roz-print .kkt-print-only { display: block !important; }
  @page { size: A4; margin: 12mm; }
}`;

type Mode = "DAY" | "RANGE";

function SectionTable<T>({ title, rows, columns, total, empty }: { title: string; rows: readonly T[]; columns: ReadonlyArray<{ key: string; label: string; align?: "right"; cell: (row: T) => ReactNode }>; total?: ReactNode; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-ink-subtle">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-2xs uppercase tracking-wider text-ink-subtle">
                  {columns.map((column) => (
                    <th key={column.key} className={cn("px-3 py-2 font-semibold", column.align === "right" && "text-right")}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-border last:border-0">
                    {columns.map((column) => (
                      <td key={column.key} className={cn("px-3 py-2", column.align === "right" && "money text-right")}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="bg-gold-light font-semibold text-navy-950">{total}</tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** `/roznamcha` — the day book: opening cash, receipts by mode / category / project, contra entries, closing cash. */
export default function RoznamchaPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const mode: Mode = params.get("mode") === "range" ? "RANGE" : "DAY";
  const date = params.get("date") ?? today;
  const from = mode === "RANGE" ? (params.get("from") ?? addDays(today, -6)) : date;
  const to = mode === "RANGE" ? (params.get("to") ?? today) : date;
  const projectId = params.get("project_id");
  const projects = useProjectOptions();
  const query = useRoznamcha(from, to, projectId);
  const [contraOpen, setContraOpen] = useState(false);

  const update = (patch: Record<string, string | null>) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const data = query.data;
  const rangeInvalid = from > to;

  return (
    <div className="kkt-roz-print">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Roznamcha"
        description="Day book — cash in hand carried forward, cleared receipts grouped by mode, category and project, contra entries and the closing balance."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Accounts" }, { label: "Roznamcha" }]}
        actions={
          <>
            {can("payment.post") && (
              <Button variant="outline" leftIcon={Plus} onClick={() => setContraOpen(true)} data-testid="roznamcha-add-contra">
                Add contra
              </Button>
            )}
            <Button leftIcon={Printer} onClick={() => window.print()} data-testid="roznamcha-print">
              Print
            </Button>
          </>
        }
        className="kkt-no-print"
      />
      <div className="kkt-print-only mb-4 hidden">
        <h1 className="font-display text-xl font-extrabold text-navy-950">Roznamcha · {from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}</h1>
        <p className="text-xs text-ink-subtle">Generated {formatDateTime(new Date().toISOString(), { zone: true })}</p>
      </div>

      <div className="kkt-no-print mb-4 flex flex-wrap items-end gap-2">
        <Tabs value={mode} onValueChange={(value) => update({ mode: value === "RANGE" ? "range" : null })}>
          <TabsList variant="pills">
            <TabsTrigger value="DAY">Single day</TabsTrigger>
            <TabsTrigger value="RANGE">Date range</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "DAY" ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => update({ date: addDays(date, -1) })} aria-label="Previous day">
              ‹
            </Button>
            <DateInput aria-label="Date" value={date} onChange={(value) => update({ date: value })} max={today} wrapperClassName="w-44" />
            <Button size="sm" variant="outline" onClick={() => update({ date: addDays(date, 1) })} disabled={date >= today} aria-label="Next day">
              ›
            </Button>
            {date !== today && (
              <Button size="sm" variant="ghost" onClick={() => update({ date: null })}>
                Today
              </Button>
            )}
          </div>
        ) : (
          <>
            <DateInput aria-label="From" value={from} onChange={(value) => update({ from: value })} max={today} wrapperClassName="w-44" />
            <span className="pb-2 text-xs text-ink-subtle">to</span>
            <DateInput aria-label="To" value={to} onChange={(value) => update({ to: value })} max={today} wrapperClassName="w-44" />
          </>
        )}
        <Select aria-label="Project" size="md" className="w-full sm:w-52" value={projectId} onValueChange={(value) => update({ project_id: value })} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))} placeholder="All projects" allowClear />
      </div>

      {rangeInvalid && <ErrorState compact title="Invalid range" description="The from date must be on or before the to date." />}
      {!rangeInvalid && query.isPending && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}
      {!rangeInvalid && query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} className="rounded-lg border border-border bg-card" />}
      {!rangeInvalid && data && <RoznamchaBody data={data} />}

      <ContraDialog open={contraOpen} onOpenChange={setContraOpen} defaultDate={mode === "DAY" ? date : today} />
    </div>
  );
}

function RoznamchaBody({ data }: { data: RoznamchaResponse }) {
  const receiptColumns = useMemo(
    () => [
      { key: "receipt", label: "Receipt", cell: (row: RoznamchaReceiptRow) => <span className="money font-semibold text-navy-950">{row.receipt_number}</span> },
      { key: "date", label: "Date", cell: (row: RoznamchaReceiptRow) => <span className="money">{formatDate(row.payment_date)}</span> },
      { key: "customer", label: "Customer / booking", cell: (row: RoznamchaReceiptRow) => <span className="block leading-tight"><span className="block">{row.customer_name}</span><span className="money block text-2xs text-ink-subtle">{row.booking_number} · {row.project_name} · {row.flat_number}</span></span> },
      { key: "mode", label: "Mode", cell: (row: RoznamchaReceiptRow) => <span className="block leading-tight"><span className="block">{row.mode_name}</span>{row.instrument_number && <span className="money block text-2xs text-ink-subtle">{row.instrument_number}</span>}</span> },
      { key: "category", label: "Category", cell: (row: RoznamchaReceiptRow) => <Badge variant={row.category === "CASH" ? "navy" : row.category === "ACCOUNT" ? "info" : "gold"}>{MONEY_CATEGORY_LABELS[row.category]}</Badge> },
      { key: "bank", label: "Credited to", cell: (row: RoznamchaReceiptRow) => <span className="text-xs text-ink-muted">{row.bank_account_label ?? "Cash in hand"}</span> },
      { key: "amount", label: "Amount", align: "right" as const, cell: (row: RoznamchaReceiptRow) => <span className="font-semibold">{formatINR(row.amount_paise)}</span> },
    ],
    [],
  );
  return (
    <div className="space-y-4" data-testid="roznamcha-body">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Opening cash in hand" value={formatINR(data.opening_cash_paise)} hint={`Carried into ${formatDate(data.from)}`} icon={Landmark} />
        <StatCard label="Cash received" value={formatINR(data.cash_received_paise)} hint={`${formatNumber(data.totals.receipts_count)} receipts · ${formatINRShort(data.totals.receipts_paise)} all modes`} tone="gold" />
        <StatCard label="Deposited / withdrawn" value={`${formatINRShort(data.cash_deposited_paise)} / ${formatINRShort(data.cash_withdrawn_paise)}`} hint="Contra entries" />
        <StatCard label="Closing cash in hand" value={formatINR(data.closing_cash_paise)} hint={data.totals.pending_cheques_paise > 0 ? `Cheques in hand ${formatINRShort(data.totals.pending_cheques_paise)} (not counted)` : "Carried to the next day"} tone="navy" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionTable
          title="By mode"
          rows={data.by_mode}
          columns={[
            { key: "mode", label: "Mode", cell: (row) => row.mode_name || PAYMENT_MODE_CODE_LABELS[row.mode_code] },
            { key: "count", label: "#", align: "right", cell: (row) => formatNumber(row.count) },
            { key: "amount", label: "Amount", align: "right", cell: (row) => formatINR(row.amount_paise) },
          ]}
          empty="No receipts in this period."
        />
        <SectionTable
          title="By category"
          rows={data.by_category}
          columns={[
            { key: "category", label: "Category", cell: (row) => MONEY_CATEGORY_LABELS[row.category] },
            { key: "count", label: "#", align: "right", cell: (row) => formatNumber(row.count) },
            { key: "amount", label: "Amount", align: "right", cell: (row) => formatINR(row.amount_paise) },
          ]}
          empty="No receipts in this period."
        />
        <SectionTable
          title="By project"
          rows={data.by_project}
          columns={[
            { key: "project", label: "Project", cell: (row) => row.project_name },
            { key: "count", label: "#", align: "right", cell: (row) => formatNumber(row.count) },
            { key: "amount", label: "Amount", align: "right", cell: (row) => formatINR(row.amount_paise) },
          ]}
          empty="No receipts in this period."
        />
      </div>

      <SectionTable
        title={`Receipts (${formatNumber(data.receipts.length)})`}
        rows={data.receipts}
        columns={receiptColumns}
        total={
          <>
            <td className="px-3 py-2" colSpan={6}>
              Total cleared receipts
            </td>
            <td className="money px-3 py-2 text-right">{formatINR(data.totals.receipts_paise)}</td>
          </>
        }
        empty="No cleared receipts in this period."
      />

      <SectionTable
        title={`Contra entries (${formatNumber(data.contra_entries.length)})`}
        rows={data.contra_entries}
        columns={[
          { key: "date", label: "Date", cell: (row: ContraEntryRow) => <span className="money">{formatDate(row.entry_date)}</span> },
          { key: "type", label: "Type", cell: (row: ContraEntryRow) => <span className="inline-flex items-center gap-1">{row.type === "DEPOSIT" ? <ArrowUpFromLine className="size-3.5 text-info" aria-hidden="true" /> : <ArrowDownToLine className="size-3.5 text-warning" aria-hidden="true" />}{CONTRA_TYPE_LABELS[row.type]}</span> },
          { key: "bank", label: "Bank account", cell: (row: ContraEntryRow) => row.bank_account_label },
          { key: "by", label: "By", cell: (row: ContraEntryRow) => <span className="text-xs text-ink-muted">{row.by_user_name ?? "—"}</span> },
          { key: "remarks", label: "Remarks", cell: (row: ContraEntryRow) => <span className="text-xs">{row.remarks ?? "—"}</span> },
          { key: "amount", label: "Amount", align: "right", cell: (row: ContraEntryRow) => <span className={cn("font-semibold", row.type === "DEPOSIT" ? "text-info-fg" : "text-warning-fg")}>{row.type === "DEPOSIT" ? "−" : "+"}{formatINR(row.amount_paise)}</span> },
        ]}
        empty="No cash deposited to or withdrawn from the bank in this period."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contra dialog                                                        */
/* ------------------------------------------------------------------ */

function ContraDialog({ open, onOpenChange, defaultDate }: { open: boolean; onOpenChange: (open: boolean) => void; defaultDate: string }) {
  const banks = useBankAccounts(open);
  const [type, setType] = useState<ContraType>("DEPOSIT");
  const [entryDate, setEntryDate] = useState(defaultDate);
  const [amount, setAmount] = useState<number | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<unknown>(null);
  const today = todayIST();

  const reset = () => {
    setType("DEPOSIT");
    setEntryDate(defaultDate);
    setAmount(null);
    setBankAccountId(null);
    setRemarks("");
    setError(null);
  };

  const create = useMutationWithToast<ContraEntryRow, void>({
    mutationFn: () => createContraEntry({ entry_date: entryDate, type, amount_paise: amount ?? 0, bank_account_id: bankAccountId ?? "", remarks: remarks.trim() || null }),
    successMessage: (row) => `${CONTRA_TYPE_LABELS[row.type]} · ${formatINR(row.amount_paise)} recorded`,
    errorMessage: false,
    invalidate: [[ROZNAMCHA_PATH], ["/dashboard"]],
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
    onError: (cause) => setError(cause),
  });

  const defaultBank = (banks.data ?? []).find((account) => account.is_default) ?? banks.data?.[0];
  const bankValue = bankAccountId ?? defaultBank?.id ?? null;
  const valid = amount !== null && amount > 0 && Boolean(bankValue) && entryDate <= today;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Add contra entry"
      description="Cash deposited into or withdrawn from a company bank account. Receipts are never contra entries."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!valid}
            onClick={() => {
              setBankAccountId(bankValue);
              create.mutate();
            }}
            data-testid="contra-save"
          >
            Save entry
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldWrapper label="Type" required>
          {(control) => <Select id={control.id} value={type} onValueChange={(value) => value && setType(value)} options={CONTRA_TYPES.map((value) => ({ value, label: CONTRA_TYPE_LABELS[value] }))} />}
        </FieldWrapper>
        <FieldWrapper label="Date" required>
          {(control) => <DateInput id={control.id} value={entryDate} onChange={(value) => setEntryDate(value ?? today)} max={today} />}
        </FieldWrapper>
        <FieldWrapper label="Amount" required>
          {(control) => <MoneyInput id={control.id} value={amount} onChange={setAmount} autoFocus />}
        </FieldWrapper>
        <FieldWrapper label="Bank account" required>
          {(control) => <Select id={control.id} value={bankValue} onValueChange={setBankAccountId} placeholder={banks.isPending ? "Loading…" : "Choose account"} options={(banks.data ?? []).map((account) => ({ value: account.id, label: bankAccountLabel(account) }))} />}
        </FieldWrapper>
        <FieldWrapper label="Remarks">{(control) => <Textarea id={control.id} value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} maxLength={1000} placeholder="Deposit slip no., purpose…" />}</FieldWrapper>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}
