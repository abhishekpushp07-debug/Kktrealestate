import { Copy, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { RoleCreateSchema, RoleUpdateSchema, type RoleRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, FormError, FormField, FormRow, Input, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Textarea } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { useRoleOptions } from "@/features/shared/options";
import { PermissionMatrix, usePermissionCatalog, type PermissionGroupLike } from "./PermissionMatrix";
import { ROLES_PATH } from "./adminApi";

export interface RoleValues {
  name: string;
  description: string | null;
  permissions: string[];
}

/** System roles may only change their description. */
const SystemRoleEditSchema = z
  .looseObject({ description: z.string().nullable().optional() })
  .transform(({ description }): unknown => ({ description }))
  .pipe(RoleUpdateSchema.omit({ version: true }));

function defaults(): RoleValues {
  return { name: "", description: null, permissions: [] };
}

function toValues(role: RoleRow): RoleValues {
  return { name: role.name, description: role.description, permissions: [...role.permissions] };
}

function withVersion(body: unknown, version: number): Record<string, unknown> {
  return typeof body === "object" && body !== null ? { ...body, version } : { version };
}

export interface RoleFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleRow | null;
  readOnly?: boolean;
}

/** Create / edit a role: name, description and the permission matrix, with "copy from role". */
export function RoleFormSheet({ open, onOpenChange, role, readOnly = false }: RoleFormSheetProps) {
  const mode = role ? "edit" : "create";
  const isSystem = role?.is_system === true;
  const schema = isSystem ? SystemRoleEditSchema : RoleCreateSchema;
  const resolver = useMemo(() => contractResolver<RoleValues, unknown>(schema), [schema]);
  const form = useForm<RoleValues, unknown, unknown>({ resolver, defaultValues: role ? toValues(role) : defaults(), mode: "onTouched" });
  const [serverError, setServerError] = useState<unknown>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const catalog = usePermissionCatalog(open);
  const roles = useRoleOptions(open && !readOnly && !isSystem);

  const roleId = role?.id ?? null;
  const roleVersion = role?.version ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(role ? toValues(role) : defaults());
    setServerError(null);
    setCopyFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roleId, roleVersion]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };

  const create = useMutationWithToast<RoleRow, unknown>({
    mutationFn: (body) => api.post<RoleRow>(ROLES_PATH, body),
    successMessage: (saved) => `Role ${saved.name} created`,
    invalidate: [[ROLES_PATH]],
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });
  const update = useMutationWithToast<RoleRow, { id: string; version: number; body: unknown }>({
    mutationFn: ({ id, version, body }) => api.patch<RoleRow>(`${ROLES_PATH}/${id}`, withVersion(body, version), { version }),
    successMessage: (saved) => `Role ${saved.name} saved`,
    invalidate: [[ROLES_PATH]],
    entityLabel: "This role",
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });

  const busy = create.isPending || update.isPending;
  const submit = (output: unknown) => {
    setServerError(null);
    if (role) update.mutate({ id: role.id, version: role.version, body: output });
    else create.mutate(output);
  };

  const applyCopy = (sourceId: string | null) => {
    setCopyFrom(sourceId);
    const source = (roles.data ?? []).find((candidate) => candidate.id === sourceId);
    if (source) form.setValue("permissions", [...source.permissions], { shouldDirty: true, shouldValidate: true });
  };

  const matrixLocked = readOnly || isSystem;
  const title = readOnly ? role?.name ?? "Role" : mode === "create" ? "New role" : `Edit ${role?.name ?? "role"}`;

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="lg" data-testid="role-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{title}</SheetTitle>
            {isSystem && (
              <Badge variant="navy">
                <Lock className="size-3" aria-hidden="true" /> System role
              </Badge>
            )}
            {role && (
              <Badge variant="outline" numeric>
                v{role.version}
              </Badge>
            )}
          </div>
          <SheetDescription>
            {isSystem ? "System roles are fixed by the product specification; only the description can be edited." : "A role is a named bundle of permission codes. Users get exactly the permissions of their role."}
          </SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-4">
              {serverError !== null && <FormError error={serverError} />}
              <RoleFormFields matrixLocked={matrixLocked} readOnly={readOnly} groups={catalog.groups} roles={(roles.data ?? []).filter((candidate) => candidate.id !== role?.id)} rolesPending={roles.isPending} copyFrom={copyFrom} onCopyFrom={applyCopy} />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} data-testid="role-form-cancel-btn">
                {readOnly ? "Close" : "Cancel"}
              </Button>
              {!readOnly && (
                <Button type="submit" loading={busy} data-testid="role-form-submit-btn">
                  {mode === "create" ? "Create role" : "Save changes"}
                </Button>
              )}
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}

interface RoleFormFieldsProps {
  matrixLocked: boolean;
  readOnly: boolean;
  groups: readonly PermissionGroupLike[];
  roles: readonly RoleRow[];
  rolesPending: boolean;
  copyFrom: string | null;
  onCopyFrom: (roleId: string | null) => void;
}

function RoleFormFields({ matrixLocked, readOnly, groups, roles, rolesPending, copyFrom, onCopyFrom }: RoleFormFieldsProps) {
  const { control } = useFormContext<RoleValues>();
  return (
    <>
              <FormRow columns={2}>
                <FormField
                  control={control}
                  name="name"
                  label="Name"
                  required
                  render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} disabled={matrixLocked} maxLength={120} placeholder="Site Engineer" data-testid="field-name" />}
                />
                {!matrixLocked && (
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
                      <Copy className="size-3.5" aria-hidden="true" /> Copy permissions from
                    </span>
                    <Select
                      aria-label="Copy permissions from role"
                      value={copyFrom}
                      onValueChange={onCopyFrom}
                      options={roles.map((candidate) => ({ value: candidate.id, label: candidate.name, description: `${candidate.permissions.length} permissions` }))}
                      placeholder={rolesPending ? "Loading…" : "Start from an existing role"}
                      allowClear
                      data-testid="role-copy-from"
                    />
                  </div>
                )}
                <FormField
                  control={control}
                  name="description"
                  label="Description"
                  className="sm:col-span-2"
                  render={({ field }) => <Textarea {...field} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} disabled={readOnly} rows={2} maxLength={2000} placeholder="What this role is for" data-testid="field-description" />}
                />
              </FormRow>
              <FormField
                control={control}
                name="permissions"
                render={({ field }) => <PermissionMatrix id={field.id} groups={groups} value={field.value} onChange={field.onChange} readOnly={matrixLocked} invalid={field.invalid} />}
              />
    </>
  );
}
