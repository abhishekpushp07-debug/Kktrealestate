import { useEffect, useId, useMemo, useState } from "react";
import { FormProvider, useForm, type FieldValues } from "react-hook-form";
import type { MasterRow } from "@kkt/contracts";
import {
  applyServerErrors,
  Badge,
  Button,
  FormError,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { businessRuleIssues, type BusinessRuleIssue } from "@/features/shared/errors";
import { GenericFields } from "./GenericFields";
import { masterPath } from "./api";
import type { AnyMasterConfig } from "./types";
import { useOnChange } from "@/lib/utils";

export interface MasterFormSheetProps {
  config: AnyMasterConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Record being edited; null creates a new one. */
  row: MasterRow | null;
  onSaved?: (row: MasterRow) => void;
}

interface UpdateVariables {
  id: string;
  version: number;
  body: unknown;
}

function withVersion(body: unknown, version: number): Record<string, unknown> {
  return typeof body === "object" && body !== null ? { ...body, version } : { version };
}

/** Right-hand drawer hosting the create / edit form of any master kind. */
export function MasterFormSheet({ config, open, onOpenChange, row, onSaved }: MasterFormSheetProps) {
  const mode = row ? "edit" : "create";
  const path = masterPath(config.slug);
  const formId = useId();
  const schema = mode === "edit" ? (config.editSchema ?? config.createSchema) : config.createSchema;
  const resolver = useMemo(() => contractResolver<FieldValues, unknown>(schema), [schema]);
  const form = useForm<FieldValues, unknown, unknown>({
    resolver,
    defaultValues: row ? config.toValues(row) : config.defaults(),
    mode: "onTouched",
  });
  const [issues, setIssues] = useState<BusinessRuleIssue[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);

  const rowId = row?.id ?? null;
  const rowVersion = row?.version ?? null;
  // Local state resets while rendering; react-hook-form's reset (an external store) stays in the effect below.
  useOnChange(open ? `${config.kind}:${rowId}:${rowVersion}` : null, (key) => {
    if (key === null) return;
    setIssues([]);
    setServerError(null);
  });
  useEffect(() => {
    if (!open) return;
    form.reset(row ? config.toValues(row) : config.defaults());
    // Reset whenever the drawer opens for a (different) record or a newer version of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the record identity, not on every render's objects
  }, [open, rowId, rowVersion, config.kind]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (applyServerErrors(error, form.setError)) return;
    const businessIssues = businessRuleIssues(error);
    if (businessIssues.length > 0) {
      setIssues(businessIssues);
      for (const issue of businessIssues) {
        if (issue.path) form.setError(issue.path, { type: "server", message: issue.message });
      }
      return;
    }
    setServerError(error);
  };

  const create = useMutationWithToast<MasterRow, unknown>({
    mutationFn: (body) => api.post<MasterRow>(path, body),
    successMessage: `${config.singular} created`,
    invalidate: [[path]],
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = useMutationWithToast<MasterRow, UpdateVariables>({
    mutationFn: ({ id, version, body }) =>
      api.patch<MasterRow>(`${path}/${id}`, withVersion(body, version), { version }),
    successMessage: `${config.singular} saved`,
    invalidate: [[path]],
    entityLabel: config.singular,
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });

  const busy = create.isPending || update.isPending;

  const submit = (output: unknown) => {
    setIssues([]);
    setServerError(null);
    if (row) update.mutate({ id: row.id, version: row.version, body: output });
    else create.mutate(output);
  };

  const KindForm = config.Form;
  const title = mode === "create" ? `New ${config.singular.toLowerCase()}` : `Edit ${config.singular.toLowerCase()}`;

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size={config.sheetSize ?? "md"} data-testid={`master-form-sheet-${config.slug}`}>
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{title}</SheetTitle>
            {row && !row.is_active && <Badge variant="danger">Inactive</Badge>}
            {row && (
              <Badge variant="outline" numeric>
                v{row.version}
              </Badge>
            )}
          </div>
          <SheetDescription>
            {row ? `${config.displayName(row)} · updated ${formatDateTime(row.updated_at)}` : config.description}
          </SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form id={formId} onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-4">
              {serverError !== null && <FormError error={serverError} />}
              {issues.length > 0 && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger-fg"
                >
                  <p className="font-semibold">The server rejected this {config.singular.toLowerCase()}:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {issues.map((issue, index) => (
                      <li key={index}>
                        {issue.path ? <span className="font-mono text-xs">{issue.path}: </span> : null}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {KindForm ? <KindForm mode={mode} row={row} /> : <GenericFields fields={config.fields ?? []} />}
            </SheetBody>
            <SheetFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                data-testid="master-form-cancel-btn"
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy} data-testid="master-form-submit-btn">
                {mode === "create" ? `Create ${config.singular.toLowerCase()}` : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}
