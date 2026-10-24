import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useFieldArray, useForm, useFormContext } from "react-hook-form";
import {
  APPROVAL_STATUSES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type AmenityRow,
  type BankAccountRow,
  type ProjectRow,
} from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Badge,
  Button,
  Combobox,
  DateInput,
  FormError,
  FormField,
  FormRow,
  FormSection,
  IconButton,
  Input,
  MultiSelect,
  NumberInput,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { contractResolver } from "@/features/shared/contractResolver";
import { useMasterRows } from "@/features/masters/api";
import { useUserOptions } from "@/features/shared/options";
import { PROJECTS_PATH } from "./api";

export interface ProjectValues {
  name: string;
  code: string;
  project_type: string | null;
  status: string;
  description: string;
  address: { line1: string; line2: string; locality: string; city: string; state: string; pincode: string };
  rera_number: string;
  launch_date: string | null;
  possession_date: string | null;
  land_area_sqft: number | null;
  latitude: number | null;
  longitude: number | null;
  escrow_bank_account_id: string | null;
  amenity_ids: string[];
  landmarks: Array<{ name: string; distance_km: number | null }>;
  approvals: Array<{ name: string; number: string; issued_on: string | null; status: string }>;
  team: Array<{ user_id: string | null; role_label: string }>;
}

const nullable = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** UI state → wire payload (empty strings become null, repeaters are cleaned). */
const ProjectFormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as ProjectValues;
    return {
      name: values.name,
      code: values.code,
      project_type: values.project_type,
      status: values.status,
      description: nullable(values.description),
      address: {
        line1: values.address.line1,
        line2: nullable(values.address.line2),
        locality: nullable(values.address.locality),
        city: values.address.city,
        state: values.address.state,
        pincode: values.address.pincode,
      },
      rera_number: nullable(values.rera_number),
      launch_date: values.launch_date,
      possession_date: values.possession_date,
      land_area_sqft: values.land_area_sqft,
      latitude: values.latitude,
      longitude: values.longitude,
      escrow_bank_account_id: values.escrow_bank_account_id,
      amenity_ids: values.amenity_ids,
      landmarks: values.landmarks.filter((item) => item.name.trim() !== "").map((item) => ({ name: item.name.trim(), distance_km: item.distance_km ?? 0 })),
      approvals: values.approvals.filter((item) => item.name.trim() !== "").map((item) => ({ name: item.name.trim(), number: nullable(item.number), issued_on: item.issued_on, status: item.status })),
      team: values.team.filter((item) => item.user_id).map((item) => ({ user_id: item.user_id, role_label: nullable(item.role_label) })),
    };
  });

const CreateSchema = ProjectFormSchema.pipe(ProjectCreateSchema);
const EditSchema = ProjectFormSchema.pipe(ProjectUpdateSchema.omit({ version: true }));

export function defaultProjectValues(): ProjectValues {
  return {
    name: "",
    code: "",
    project_type: "RESIDENTIAL",
    status: "PLANNING",
    description: "",
    address: { line1: "", line2: "", locality: "", city: "", state: "", pincode: "" },
    rera_number: "",
    launch_date: null,
    possession_date: null,
    land_area_sqft: null,
    latitude: null,
    longitude: null,
    escrow_bank_account_id: null,
    amenity_ids: [],
    landmarks: [],
    approvals: [],
    team: [],
  };
}

export function projectToValues(project: ProjectRow): ProjectValues {
  return {
    name: project.name,
    code: project.code,
    project_type: project.project_type,
    status: project.status,
    description: project.description ?? "",
    address: {
      line1: project.address.line1,
      line2: project.address.line2 ?? "",
      locality: project.address.locality ?? "",
      city: project.address.city,
      state: project.address.state,
      pincode: project.address.pincode,
    },
    rera_number: project.rera_number ?? "",
    launch_date: project.launch_date,
    possession_date: project.possession_date,
    land_area_sqft: project.land_area_sqft,
    latitude: project.latitude,
    longitude: project.longitude,
    escrow_bank_account_id: project.escrow_bank_account_id,
    amenity_ids: [...project.amenity_ids],
    landmarks: project.landmarks.map((item) => ({ name: item.name, distance_km: item.distance_km })),
    approvals: project.approvals.map((item) => ({ name: item.name, number: item.number ?? "", issued_on: item.issued_on, status: item.status })),
    team: project.team.map((item) => ({ user_id: item.user_id, role_label: item.role_label ?? "" })),
  };
}

export interface ProjectFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRow | null;
  onSaved?: (project: ProjectRow) => void;
}

/** Create / edit a project: identity, address, dates, approvals, landmarks, team, amenities. */
export function ProjectFormSheet({ open, onOpenChange, project, onSaved }: ProjectFormSheetProps) {
  const mode = project ? "edit" : "create";
  const schema = mode === "edit" ? EditSchema : CreateSchema;
  const resolver = useMemo(() => contractResolver<ProjectValues, unknown>(schema), [schema]);
  const form = useForm<ProjectValues, unknown, unknown>({ resolver, defaultValues: project ? projectToValues(project) : defaultProjectValues(), mode: "onTouched" });
  const [serverError, setServerError] = useState<unknown>(null);

  const projectId = project?.id ?? null;
  const projectVersion = project?.version ?? null;
  useEffect(() => {
    if (!open) return;
    form.reset(project ? projectToValues(project) : defaultProjectValues());
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, projectVersion]);

  const handleError = (error: ApiClientError) => {
    if (error.isVersionConflict) return;
    if (!applyServerErrors(error, form.setError)) setServerError(error);
  };

  const create = useMutationWithToast<ProjectRow, unknown>({
    mutationFn: (body) => api.post<ProjectRow>(PROJECTS_PATH, body),
    successMessage: (saved) => `${saved.name} created`,
    invalidate: [[PROJECTS_PATH]],
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });

  const update = useMutationWithToast<ProjectRow, { id: string; version: number; body: unknown }>({
    mutationFn: ({ id, version, body }) => api.patch<ProjectRow>(`${PROJECTS_PATH}/${id}`, { ...(body as Record<string, unknown>), version }, { version }),
    successMessage: (saved) => `${saved.name} saved`,
    invalidate: [[PROJECTS_PATH]],
    entityLabel: "This project",
    errorMessage: false,
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: handleError,
  });

  const busy = create.isPending || update.isPending;
  const submit = (output: unknown) => {
    setServerError(null);
    if (project) update.mutate({ id: project.id, version: project.version, body: output });
    else create.mutate(output);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent size="lg" data-testid="project-form-sheet">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{mode === "create" ? "New project" : "Edit project"}</SheetTitle>
            {project && (
              <Badge variant="outline" numeric>
                v{project.version}
              </Badge>
            )}
          </div>
          <SheetDescription>{project ? `${project.code} · updated ${formatDateTime(project.updated_at)}` : "Blocks, flats, rate cards and the website page hang off a project."}</SheetDescription>
        </SheetHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-6">
              {serverError !== null && <FormError error={serverError} />}
              <ProjectFormFields open={open} />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} data-testid="project-form-cancel-btn">
                Cancel
              </Button>
              <Button type="submit" loading={busy} data-testid="project-form-submit-btn">
                {mode === "create" ? "Create project" : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}

function ProjectFormFields({ open }: { open: boolean }) {
  const { control } = useFormContext<ProjectValues>();
  const amenities = useMasterRows<AmenityRow>("amenities", { enabled: open });
  const banks = useMasterRows<BankAccountRow>("bank-accounts", { enabled: open, sort: "bank_name" });
  const users = useUserOptions(open);
  const landmarks = useFieldArray({ control, name: "landmarks" });
  const approvals = useFieldArray({ control, name: "approvals" });
  const team = useFieldArray({ control, name: "team" });

  const amenityOptions = useMemo(() => (amenities.data ?? []).map((row) => ({ value: row.id, label: row.name, description: row.category ?? undefined })), [amenities.data]);
  const bankOptions = useMemo(() => (banks.data ?? []).map((row) => ({ value: row.id, label: `${row.bank_name} · ${row.account_number_masked}`, description: row.is_escrow ? "Escrow account" : row.account_name })), [banks.data]);
  const userOptions = useMemo(() => (users.data ?? []).filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.name, description: user.role_name, keywords: [user.email] })), [users.data]);

  return (
    <>
      <FormSection title="Identity">
        <FormRow columns={2}>
          <FormField control={control} name="name" label="Project name" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} data-testid="field-project-name" />} />
          <FormField control={control} name="code" label="Code" required hint="Upper-case, unique" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.toUpperCase())} maxLength={30} className="font-mono uppercase" data-testid="field-project-code" />} />
          <FormField control={control} name="project_type" label="Type" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={PROJECT_TYPES.map((value) => ({ value, label: PROJECT_TYPE_LABELS[value] }))} invalid={field.invalid} data-testid="field-project-type" />} />
          <FormField control={control} name="status" label="Status" required render={({ field }) => <Select id={field.id} value={field.value} onValueChange={(value) => field.onChange(value ?? "PLANNING")} options={PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }))} data-testid="field-project-status" />} />
          <FormField control={control} name="description" label="Description" className="sm:col-span-2" render={({ field }) => <Textarea {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} rows={3} maxLength={2000} placeholder="Shown on the website overview when published" />} />
        </FormRow>
      </FormSection>

      <FormSection title="Location">
        <FormRow columns={2}>
          <FormField control={control} name="address.line1" label="Address line 1" required className="sm:col-span-2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} />} />
          <FormField control={control} name="address.line2" label="Address line 2" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={200} />} />
          <FormField control={control} name="address.locality" label="Locality" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={120} />} />
          <FormField control={control} name="address.city" label="City" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} />} />
          <FormField control={control} name="address.state" label="State" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} />} />
          <FormField control={control} name="address.pincode" label="PIN code" required render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} className="money" />} />
          <FormField control={control} name="latitude" label="Latitude" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={6} min={-90} max={90} allowNegative align="left" />} />
          <FormField control={control} name="longitude" label="Longitude" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={6} min={-180} max={180} allowNegative align="left" />} />
        </FormRow>
      </FormSection>

      <FormSection title="Statutory & timeline">
        <FormRow columns={2}>
          <FormField control={control} name="rera_number" label="RERA number" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={60} className="font-mono" />} />
          <FormField control={control} name="land_area_sqft" label="Land area" render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={2} min={0} suffix="sq ft" />} />
          <FormField control={control} name="launch_date" label="Launch date" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
          <FormField control={control} name="possession_date" label="Possession date" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />} />
          <FormField control={control} name="escrow_bank_account_id" label="Escrow bank account" className="sm:col-span-2" render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} options={bankOptions} placeholder={banks.isPending ? "Loading…" : "None"} allowClear />} />
        </FormRow>
      </FormSection>

      <FormSection title="Approvals" description="RERA, building plan, fire NOC and other statutory approvals.">
        <div className="space-y-2">
          {approvals.fields.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.4fr_1fr_9rem_8rem_auto] sm:items-end sm:border-0 sm:p-0">
              <FormField control={control} name={`approvals.${index}.name`} label={index === 0 ? "Approval" : undefined} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="RERA registration" maxLength={120} aria-label="Approval name" />} />
              <FormField control={control} name={`approvals.${index}.number`} label={index === 0 ? "Number" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} maxLength={80} className="font-mono" aria-label="Approval number" />} />
              <FormField control={control} name={`approvals.${index}.issued_on`} label={index === 0 ? "Issued on" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} aria-label="Issued on" />} />
              <FormField control={control} name={`approvals.${index}.status`} label={index === 0 ? "Status" : undefined} render={({ field }) => <Select id={field.id} value={field.value} onValueChange={(value) => field.onChange(value ?? "RECEIVED")} options={APPROVAL_STATUSES.map((value) => ({ value, label: value === "NA" ? "Not applicable" : value.charAt(0) + value.slice(1).toLowerCase() }))} aria-label="Approval status" />} />
              <IconButton icon={Trash2} label="Remove approval" size="sm" onClick={() => approvals.remove(index)} className="self-end" />
            </div>
          ))}
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => approvals.append({ name: "", number: "", issued_on: null, status: "RECEIVED" })} data-testid="add-approval-btn">
            Add approval
          </Button>
        </div>
      </FormSection>

      <FormSection title="Landmarks" description="Nearby places with distance, shown on the website map.">
        <div className="space-y-2">
          {landmarks.fields.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
              <FormField control={control} name={`landmarks.${index}.name`} label={index === 0 ? "Landmark" : undefined} render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Metro station" maxLength={120} aria-label="Landmark" />} />
              <FormField control={control} name={`landmarks.${index}.distance_km`} label={index === 0 ? "Distance" : undefined} render={({ field }) => <NumberInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} decimals={1} min={0} max={999} suffix="km" aria-label="Distance in km" />} />
              <IconButton icon={Trash2} label="Remove landmark" size="sm" onClick={() => landmarks.remove(index)} />
            </div>
          ))}
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => landmarks.append({ name: "", distance_km: null })} data-testid="add-landmark-btn">
            Add landmark
          </Button>
        </div>
      </FormSection>

      <FormSection title="Team" description="Staff responsible for this project (shown on the overview).">
        <div className="space-y-2">
          {team.fields.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
              <FormField control={control} name={`team.${index}.user_id`} label={index === 0 ? "User" : undefined} render={({ field }) => <Combobox id={field.id} value={field.value} onValueChange={(value) => field.onChange(value)} options={userOptions} placeholder={users.isPending ? "Loading…" : "Pick a user"} aria-label="Team member" />} />
              <FormField control={control} name={`team.${index}.role_label`} label={index === 0 ? "Role" : undefined} className="col-span-2 sm:col-span-1" render={({ field }) => <Input {...field} value={field.value} onChange={(event) => field.onChange(event.target.value)} placeholder="Site engineer" maxLength={60} aria-label="Role label" />} />
              <IconButton icon={Trash2} label="Remove team member" size="sm" onClick={() => team.remove(index)} className="self-end" />
            </div>
          ))}
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => team.append({ user_id: null, role_label: "" })} data-testid="add-team-btn">
            Add member
          </Button>
        </div>
      </FormSection>

      <FormSection title="Amenities">
        <FormField control={control} name="amenity_ids" render={({ field }) => <MultiSelect id={field.id} value={field.value} onValueChange={field.onChange} options={amenityOptions} placeholder={amenities.isPending ? "Loading…" : "Pick amenities"} maxChips={6} aria-label="Amenities" data-testid="field-amenities" />} />
      </FormSection>
    </>
  );
}
