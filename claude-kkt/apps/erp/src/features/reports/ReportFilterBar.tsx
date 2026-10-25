import { RotateCcw } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Button, Combobox, DateInput, FieldWrapper, Input, NumberInput, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { searchCustomers } from "@/features/crm/api";
import { useProjectBlocks } from "@/features/inventory/api";
import { bankAccountLabel, useBankAccounts } from "@/features/payments/api";
import { useProjectOptions, useUserOptions } from "@/features/shared/options";
import { DATE_PRESETS, DATE_PRESET_LABELS, datePresetRange, filterKeys, matchDatePreset, type FilterDef } from "./reportQuery";

export interface ReportFilterBarProps {
  filters: readonly FilterDef[];
  params: Readonly<Record<string, string>>;
  /** Effective values after defaults (so a cleared enum shows its default). */
  effective: Readonly<Record<string, string>>;
  onChange: (patch: Record<string, string | null>) => void;
  onReset: () => void;
  today: string;
  disabled?: boolean;
}

/** Text filter that commits on Enter / blur. */
function TextFilter({ id, value, onCommit, placeholder, disabled }: { id: string; value: string; onCommit: (value: string | null) => void; placeholder?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => onCommit(draft.trim() || null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };
  return <Input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} className="h-8 text-xs" />;
}

/** Filter controls generated from a report's filter definitions; values live in the URL. */
export function ReportFilterBar({ filters, params, effective, onChange, onReset, today, disabled = false }: ReportFilterBarProps) {
  const needsProjects = filters.some((filter) => filter.kind === "project" || filter.kind === "block");
  const needsUsers = filters.some((filter) => filter.kind === "user");
  const needsBanks = filters.some((filter) => filter.kind === "bankAccount");
  const projects = useProjectOptions(needsProjects);
  const blocks = useProjectBlocks(filters.some((filter) => filter.kind === "block") ? params.project_id : null);
  const users = useUserOptions(needsUsers);
  const banks = useBankAccounts(needsBanks);
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);

  const projectOptions = useMemo(() => (projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined })), [projects.data]);
  const blockOptions = useMemo(() => (blocks.data ?? []).map((block) => ({ value: block.id, label: block.name, description: block.code })), [blocks.data]);
  const userOptions = useMemo(() => (users.data ?? []).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })), [users.data]);
  const bankOptions = useMemo(() => (banks.data ?? []).map((account) => ({ value: account.id, label: bankAccountLabel(account) })), [banks.data]);

  const hasValues = filters.some((filter) => filterKeys(filter).some((key) => params[key] !== undefined));
  const dateRange = filters.find((filter): filter is Extract<FilterDef, { kind: "dateRange" }> => filter.kind === "dateRange");
  const activePreset = dateRange ? matchDatePreset(effective.from, effective.to, today) : null;

  return (
    <section aria-label="Report filters" className="mb-4 rounded-lg border border-border bg-card p-3 shadow-card" data-testid="report-filters">
      <div className="flex flex-wrap items-end gap-3">
        {filters.map((filter) => {
          switch (filter.kind) {
            case "dateRange":
              return (
                <div key="dateRange" className="flex min-w-0 flex-wrap items-end gap-2">
                  <FieldWrapper label={`${filter.label ?? "From"}`} className="w-full sm:w-40">
                    {(control) => <DateInput id={control.id} value={effective.from ?? null} max={effective.to} onChange={(value) => onChange({ from: value })} disabled={disabled} className="h-8 text-xs" data-testid="report-filter-from" />}
                  </FieldWrapper>
                  <FieldWrapper label="To" className="w-full sm:w-40">
                    {(control) => <DateInput id={control.id} value={effective.to ?? null} min={effective.from} onChange={(value) => onChange({ to: value })} disabled={disabled} className="h-8 text-xs" data-testid="report-filter-to" />}
                  </FieldWrapper>
                </div>
              );
            case "date":
              return (
                <FieldWrapper key={filter.key} label={filter.label} className="w-full sm:w-40">
                  {(control) => <DateInput id={control.id} value={effective[filter.key] ?? null} onChange={(value) => onChange({ [filter.key]: value })} disabled={disabled} className="h-8 text-xs" data-testid={`report-filter-${filter.key}`} />}
                </FieldWrapper>
              );
            case "project":
              return (
                <FieldWrapper key="project_id" label="Project" required={filter.required} className="w-full sm:w-48">
                  {(control) => <Combobox id={control.id} size="sm" value={params.project_id ?? null} onValueChange={(value) => onChange({ project_id: value, block_id: null })} options={projectOptions} placeholder={projects.isPending ? "Loading…" : filter.required ? "Pick a project" : "All projects"} allowClear={!filter.required} disabled={disabled} invalid={filter.required && !params.project_id} data-testid="report-filter-project" />}
                </FieldWrapper>
              );
            case "block":
              return (
                <FieldWrapper key="block_id" label="Tower / block" className="w-full sm:w-44">
                  {(control) => <Combobox id={control.id} size="sm" value={params.block_id ?? null} onValueChange={(value) => onChange({ block_id: value })} options={blockOptions} placeholder={params.project_id ? (blocks.isPending ? "Loading…" : "All blocks") : "Pick a project first"} allowClear disabled={disabled || !params.project_id} data-testid="report-filter-block" />}
                </FieldWrapper>
              );
            case "customer":
              return (
                <FieldWrapper key="customer_id" label="Customer" className="w-full sm:w-52">
                  {(control) => <Combobox id={control.id} size="sm" value={params.customer_id ?? null} onValueChange={(value, option) => { onChange({ customer_id: value }); setCustomerLabel(option?.label ?? null); }} onSearch={searchCustomers} selectedLabel={customerLabel ?? (params.customer_id ? "Selected customer" : undefined)} placeholder="Any customer" allowClear disabled={disabled} data-testid="report-filter-customer" />}
                </FieldWrapper>
              );
            case "user":
              return (
                <FieldWrapper key={filter.key} label={filter.label} className="w-full sm:w-48">
                  {(control) => <Combobox id={control.id} size="sm" value={params[filter.key] ?? null} onValueChange={(value) => onChange({ [filter.key]: value })} options={userOptions} placeholder={users.isPending ? "Loading…" : "Anyone"} allowClear disabled={disabled} data-testid={`report-filter-${filter.key}`} />}
                </FieldWrapper>
              );
            case "bankAccount":
              return (
                <FieldWrapper key="bank_account_id" label="Bank account" className="w-full sm:w-56">
                  {(control) => <Combobox id={control.id} size="sm" value={params.bank_account_id ?? null} onValueChange={(value) => onChange({ bank_account_id: value })} options={bankOptions} placeholder={banks.isPending ? "Loading…" : "All accounts"} allowClear disabled={disabled} data-testid="report-filter-bank" />}
                </FieldWrapper>
              );
            case "enum":
              return (
                <FieldWrapper key={filter.key} label={filter.label} className="w-full sm:w-40">
                  {(control) => <Select id={control.id} size="sm" value={effective[filter.key] ?? null} onValueChange={(value) => onChange({ [filter.key]: value })} options={filter.options} placeholder={filter.clearable ? "Any" : "Select"} allowClear={filter.clearable} disabled={disabled} data-testid={`report-filter-${filter.key}`} />}
                </FieldWrapper>
              );
            case "number":
              return (
                <FieldWrapper key={filter.key} label={filter.label} className="w-full sm:w-28">
                  {(control) => <NumberInput id={control.id} value={Number(effective[filter.key] ?? filter.defaultValue)} onChange={(value) => onChange({ [filter.key]: value === null ? null : String(value) })} min={filter.min} max={filter.max} disabled={disabled} className="h-8 text-xs" data-testid={`report-filter-${filter.key}`} />}
                </FieldWrapper>
              );
            case "text":
              return (
                <FieldWrapper key={filter.key} label={filter.label} className="w-full sm:w-44">
                  {(control) => <TextFilter id={control.id} value={params[filter.key] ?? ""} onCommit={(value) => onChange({ [filter.key]: value })} placeholder={filter.placeholder} disabled={disabled} />}
                </FieldWrapper>
              );
          }
        })}
        {hasValues && (
          <Button variant="ghost" size="sm" leftIcon={RotateCcw} onClick={onReset} disabled={disabled} className="h-8" data-testid="report-filters-reset">
            Reset
          </Button>
        )}
      </div>
      {dateRange && (
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin" role="group" aria-label="Date presets">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onChange(datePresetRange(preset, today))}
              aria-pressed={activePreset === preset}
              className={cn("h-7 shrink-0 rounded-full border px-2.5 text-xs font-medium transition-colors focus-ring", activePreset === preset ? "border-navy-950 bg-navy-950 text-white" : "border-border bg-card text-ink-muted hover:border-navy-300 hover:text-navy-950")}
              data-testid={`report-preset-${preset}`}
            >
              {DATE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
