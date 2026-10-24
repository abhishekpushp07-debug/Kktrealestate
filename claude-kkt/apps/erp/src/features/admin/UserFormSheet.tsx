import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { UserCreateSchema, UserUpdateSchema, type RoleRow, type UserRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, FormError, FormField, FormRow, FormSection, Input, MultiSelect, Select, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Switch } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { useProjectOptions, useRoleOptions, type ProjectOption } from "@/features/shared/options";
import { USERS_PATH } from "./adminApi";

export interface UserValues {
  name: string;
  email: string;
  phone: string | null;
  role_id: string | null;
  all_projects: boolean;
  project_ids: string[];
  must_change_password: boolean;
  /** Create only; blank lets the server generate a temporary password. */
  password: string;
}

const UserCreateFormSchema = z
  .looseObject({ password: z.string().optional(), all_projects: z.boolean(), project_ids: z.array(z.string()) })
  .transform(({ password, all_projects, project_ids, ...rest }): unknown => ({ ...rest, all_projects, project_ids: all_projects ? [] : project_ids, password: password ? password : undefined }))
  .pipe(UserCreateSchema);

const UserEditFormSchema = z
  .looseObject({ password: z.string().optional(), all_projects: z.boolean(), project_ids: z.array(z.string()) })
  .transform(({ password: _password, all_projects, project_ids, ...rest }): unknown => ({ ...rest, all_projects, project_ids: all_projects ? [] : project_ids }))
  .pipe(UserUpdateSchema.omit({ version: true }))
  .superRefine((value, ctx) => {
    if (value.all_projects === false && (value.project_ids?.length ?? 0) === 0) {
      ctx.addIssue({ code: "custom", path: ["project_ids"], message: "Pick at least one project for a scoped user" });
    }
  });

function defaults(): UserValues {
  return { name: "", email: "", phone: null, role_id: null, all_projects: true, project_ids: [], must_change_password: true, password: "" };
}

function toValues(user: UserRow): UserValues {
  return { name: user.name, email: user.email, phone: user.phone, role_id: user.role_id, all_projects: user.all_projects, project_ids: [...user.project_ids], must_change_password: user.must_change_password, password: "" };
}

function withVersion(body: unknown, version: number): Record<string, unknown> {
  return typeof body === "object" && body !== null ? { ...body, version } : { version };
}

export interface UserFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  /** Called with the temporary password when the server generated one on create. */
  onTemporaryPassword?: (user: UserRow, password: string) => void;
}

interface CreateResponse extends UserRow {
  temp_password?: string;
  temporary_password?: string;
}

/** Create / edit a staff user: role, project scope, forced password change. */
export function UserFormSheet({ open, onOpenChange, user, onTemporaryPassword }: UserFormSheetProps) {
  const mode = user ? "edit" : "create";
  const schema = mode === "edit" ? UserEditFormSchema : UserCreateFormSchema;
  const resolver = useMemo(() => contractResolver<UserValues, unknown>(schema), [schema]);
  const form = useForm<UserValues, unknown, unknown>({ resolver, defaultValues: user ? toValues(user) : defaults(), mode: "onTouched" });
  const [serverError, setServerError] = useState<unknown>(null);
  const roles = useRoleOptions(open);
  const projects = useProjectOptions(open);

  const userId = user?.id ?? null;
  const userVersion = user?.version ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(user ? toValues(user) : defaults());
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, userVersion]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };

  const create = useMutationWithToast<CreateResponse, unknown>({
    mutationFn: (body) => api.post<CreateResponse>(USERS_PATH, body),
    successMessage: (saved) => `${saved.name} created`,
    invalidate: [[USERS_PATH]],
    errorMessage: false,
    onSuccess: (saved) => {
      const temporary = saved.temporary_password ?? saved.temp_password;
      if (temporary) onTemporaryPassword?.(saved, temporary);
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = useMutationWithToast<UserRow, { id: string; version: number; body: unknown }>({
    mutationFn: ({ id, version, body }) => api.patch<UserRow>(`${USERS_PATH}/${id}`, withVersion(body, version), { version }),
    successMessage: (saved) => `${saved.name} saved`,
    invalidate: [[USERS_PATH]],
    entityLabel: "This user",
    errorMessage: false,
    onSuccess: () => onOpenChange(false),
    onError: handleError,
  });

  const busy = create.isPending || update.isPending;
  const submit = (output: unknown) => {
    setServerError(null);
    if (user) update.mutate({ id: user.id, version: user.version, body: output });
    else create.mutate(output);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="md" data-testid="user-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{mode === "create" ? "New user" : "Edit user"}</SheetTitle>
            {user && !user.is_active && <Badge variant="danger">Inactive</Badge>}
            {user && (
              <Badge variant="outline" numeric>
                v{user.version}
              </Badge>
            )}
          </div>
          <SheetDescription>{user ? user.email : "Staff sign in with e-mail and password; scoped users only ever see their projects."}</SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-6">
              {serverError !== null && <FormError error={serverError} />}
              <UserFormFields mode={mode} roles={roles.data ?? []} rolesPending={roles.isPending} rolesError={roles.isError} projects={projects.data ?? []} projectsPending={projects.isPending} projectsError={projects.isError} />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} data-testid="user-form-cancel-btn">
                Cancel
              </Button>
              <Button type="submit" loading={busy} data-testid="user-form-submit-btn">
                {mode === "create" ? "Create user" : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}

interface UserFormFieldsProps {
  mode: "create" | "edit";
  roles: readonly RoleRow[];
  rolesPending: boolean;
  rolesError: boolean;
  projects: readonly ProjectOption[];
  projectsPending: boolean;
  projectsError: boolean;
}

function UserFormFields({ mode, roles, rolesPending, rolesError, projects, projectsPending, projectsError }: UserFormFieldsProps) {
  const { control, watch } = useFormContext<UserValues>();
  const allProjects = watch("all_projects");
  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name, description: role.is_system ? "System role" : undefined }));
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.name, description: project.code ?? undefined, keywords: project.code ? [project.code] : undefined }));
  return (
    <>
              <FormSection title="Identity">
                <FormRow columns={2}>
                  <FormField
                    control={control}
                    name="name"
                    label="Full name"
                    required
                    className="sm:col-span-2"
                    render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} autoComplete="off" maxLength={120} data-testid="field-name" />}
                  />
                  <FormField
                    control={control}
                    name="email"
                    label="E-mail"
                    required
                    render={({ field }) => <Input {...field} type="email" value={field.value} onChange={(event) => field.onChange(event.target.value)} autoComplete="off" inputMode="email" maxLength={254} data-testid="field-email" />}
                  />
                  <FormField
                    control={control}
                    name="phone"
                    label="Mobile"
                    hint="10-digit Indian number"
                    render={({ field }) => <Input {...field} type="tel" value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} autoComplete="off" inputMode="tel" maxLength={15} className="money" data-testid="field-phone" />}
                  />
                </FormRow>
              </FormSection>

              <FormSection title="Access">
                <FormRow columns={1}>
                  <FormField
                    control={control}
                    name="role_id"
                    label="Role"
                    required
                    hint={rolesError ? "Could not load roles" : undefined}
                    render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={roleOptions} placeholder={rolesPending ? "Loading…" : "Select a role"} invalid={field.invalid} data-testid="field-role-id" />}
                  />
                  <FormField
                    control={control}
                    name="all_projects"
                    render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="All projects" description="Off = the user sees only the projects picked below (others return not-found)" data-testid="field-all-projects" />}
                  />
                  {!allProjects && (
                    <FormField
                      control={control}
                      name="project_ids"
                      label="Projects"
                      required
                      render={({ field }) => (
                        <MultiSelect id={field.id} value={field.value} onValueChange={field.onChange} options={projectOptions} placeholder={projectsPending ? "Loading…" : "Pick projects"} emptyText={projectsError ? "Could not load projects" : "No projects"} invalid={field.invalid} aria-describedby={field["aria-describedby"]} data-testid="field-project-ids" />
                      )}
                    />
                  )}
                </FormRow>
              </FormSection>

              <FormSection title="Password">
                <FormRow columns={1}>
                  {mode === "create" && (
                    <FormField
                      control={control}
                      name="password"
                      label="Initial password"
                      hint="Leave blank to let the system generate a temporary password (shown once). 10+ chars with upper, lower and a digit."
                      render={({ field }) => <Input {...field} type="text" value={field.value} onChange={(event) => field.onChange(event.target.value)} autoComplete="new-password" maxLength={128} className="font-mono" data-testid="field-password" />}
                    />
                  )}
                  <FormField
                    control={control}
                    name="must_change_password"
                    render={({ field }) => <Switch id={field.id} checked={field.value} onCheckedChange={field.onChange} label="Must change password at next sign-in" description="Recommended for new accounts and after a reset" data-testid="field-must-change-password" />}
                  />
                </FormRow>
              </FormSection>
    </>
  );
}
