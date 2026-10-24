import { useFormContext } from "react-hook-form";
import { DOCUMENT_APPLIES_TOS, DOCUMENT_APPLIES_TO_LABELS, type DocumentAppliesTo } from "@kkt/contracts";
import { FormField, FormRow, Input, MultiSelect, Switch } from "@/components/ui";
import type { MasterFormProps } from "../types";

export interface DocumentTypeValues {
  name: string;
  code: string;
  applies_to: DocumentAppliesTo[];
  is_kyc: boolean;
}

const APPLIES_TO_OPTIONS = DOCUMENT_APPLIES_TOS.map((value) => ({ value, label: DOCUMENT_APPLIES_TO_LABELS[value] }));

function isAppliesTo(value: string): value is DocumentAppliesTo {
  return (DOCUMENT_APPLIES_TOS as readonly string[]).includes(value);
}

/** Document types: where the document can be attached and whether it counts towards KYC. */
export function DocumentTypeForm(_props: MasterFormProps) {
  const { control } = useFormContext<DocumentTypeValues>();
  return (
    <div className="space-y-4">
      <FormRow columns={2}>
        <FormField
          control={control}
          name="name"
          label="Name"
          required
          render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="PAN Card" maxLength={120} data-testid="field-name" />}
        />
        <FormField
          control={control}
          name="code"
          label="Code"
          required
          render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} placeholder="PAN" maxLength={30} className="font-mono uppercase" data-testid="field-code" />}
        />
        <FormField
          control={control}
          name="applies_to"
          label="Applies to"
          required
          hint="Entities this document can be attached to"
          className="sm:col-span-2"
          render={({ field }) => (
            <MultiSelect id={field.id} value={field.value} onValueChange={(values) => field.onChange(values.filter(isAppliesTo))} options={APPLIES_TO_OPTIONS} placeholder="Pick one or more" invalid={field.invalid} aria-describedby={field["aria-describedby"]} data-testid="field-applies-to" />
          )}
        />
        <FormField
          control={control}
          name="is_kyc"
          className="sm:col-span-2"
          render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="KYC document" description="Counts towards a customer's KYC completeness; values are masked for most roles" data-testid="field-is-kyc" />}
        />
      </FormRow>
    </div>
  );
}
