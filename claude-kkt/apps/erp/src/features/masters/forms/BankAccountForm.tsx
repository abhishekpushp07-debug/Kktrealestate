import { Landmark } from "lucide-react";
import { useFormContext } from "react-hook-form";
import type { BankAccountRow } from "@kkt/contracts";
import { Button, FormField, FormRow, Input, Switch } from "@/components/ui";
import type { MasterFormProps } from "../types";

export interface BankAccountValues {
  bank_name: string;
  branch: string | null;
  account_name: string;
  /** Edit mode: the account number is only sent when this is on. */
  change_account_number: boolean;
  account_number: string;
  account_number_confirm: string;
  ifsc: string;
  is_default: boolean;
  is_escrow: boolean;
}

function isBankRow(row: MasterFormProps["row"]): row is BankAccountRow {
  return row !== null && typeof (row as Partial<BankAccountRow>).account_number_masked === "string";
}

/** Company bank accounts: the number is entered twice and only ever displayed masked afterwards. */
export function BankAccountForm({ mode, row }: MasterFormProps) {
  const { control, watch, setValue } = useFormContext<BankAccountValues>();
  const changing = watch("change_account_number");
  const masked = isBankRow(row) ? row.account_number_masked : null;
  const showNumberFields = mode === "create" || changing;

  return (
    <div className="space-y-4">
      <FormRow columns={2}>
        <FormField
          control={control}
          name="bank_name"
          label="Bank"
          required
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder="HDFC Bank"
              maxLength={120}
              data-testid="field-bank-name"
            />
          )}
        />
        <FormField
          control={control}
          name="branch"
          label="Branch"
          render={({ field }) => (
            <Input
              {...field}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(event.target.value || null)}
              placeholder="MG Road"
              maxLength={120}
              data-testid="field-branch"
            />
          )}
        />
        <FormField
          control={control}
          name="account_name"
          label="Account name"
          required
          hint="As printed on receipts"
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder="Shree Ganesh Builders"
              maxLength={120}
              data-testid="field-account-name"
            />
          )}
        />
        <FormField
          control={control}
          name="ifsc"
          label="IFSC"
          required
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
              placeholder="HDFC0001234"
              maxLength={11}
              className="font-mono uppercase"
              data-testid="field-ifsc"
            />
          )}
        />
      </FormRow>

      <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
        {mode === "edit" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Landmark className="size-4 text-ink-subtle" aria-hidden="true" />
              <span className="text-ink-muted">Account number</span>
              <span className="money font-mono font-semibold text-navy-950">{masked ?? "••••"}</span>
            </div>
            {!changing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setValue("change_account_number", true, { shouldDirty: true })}
                data-testid="change-account-number-btn"
              >
                Change number
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue("change_account_number", false, { shouldDirty: true });
                  setValue("account_number", "");
                  setValue("account_number_confirm", "");
                }}
              >
                Keep current
              </Button>
            )}
          </div>
        )}
        {showNumberFields && (
          <FormRow columns={2}>
            <FormField
              control={control}
              name="account_number"
              label="Account number"
              required
              hint="9–18 digits; stored encrypted, shown masked"
              render={({ field }) => (
                <Input
                  {...field}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value.replace(/[^\d\s]/g, ""))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={22}
                  className="money font-mono"
                  data-testid="field-account-number"
                />
              )}
            />
            <FormField
              control={control}
              name="account_number_confirm"
              label="Confirm account number"
              required
              render={({ field }) => (
                <Input
                  {...field}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value.replace(/[^\d\s]/g, ""))}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={22}
                  className="money font-mono"
                  onPaste={(event) => event.preventDefault()}
                  data-testid="field-account-number-confirm"
                />
              )}
            />
          </FormRow>
        )}
      </div>

      <FormRow columns={2}>
        <FormField
          control={control}
          name="is_default"
          render={({ field }) => (
            <Switch
              id={field.id}
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Default account"
              description="Pre-selected on receipts and bank deposits"
              data-testid="field-is-default"
            />
          )}
        />
        <FormField
          control={control}
          name="is_escrow"
          render={({ field }) => (
            <Switch
              id={field.id}
              checked={field.value}
              onCheckedChange={field.onChange}
              label="RERA escrow account"
              description="Collections for registered projects land here"
              data-testid="field-is-escrow"
            />
          )}
        />
      </FormRow>
    </div>
  );
}
