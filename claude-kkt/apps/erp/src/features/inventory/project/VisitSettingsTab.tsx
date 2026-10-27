import { Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { SLOT_MINUTES, VisitSettingsSchema, type ProjectRow, type VisitSettingsRow } from "@kkt/contracts";
import { z } from "zod";
import {
  applyServerErrors,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
  ErrorState,
  FormError,
  FormField,
  FormRow,
  FormSection,
  Input,
  NumberInput,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/unsaved";
import { contractResolver } from "@/features/shared/contractResolver";
import { inventoryKeys, PROJECTS_PATH, useVisitSettings } from "../api";
import { controlOf, Notice } from "../components";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

interface VisitValues {
  enabled: boolean;
  visit_days: number[];
  start_time: string;
  end_time: string;
  slot_minutes: string;
  seats_per_slot: number;
  min_lead_hours: number;
  max_days_ahead: number;
  blackout_dates: string[];
  site_office_address: string;
  maps_link: string;
  instructions: string;
}

const FormSchema = z
  .looseObject({})
  .transform((raw): unknown => {
    const values = raw as unknown as VisitValues;
    return {
      enabled: values.enabled,
      visit_days: [...values.visit_days].sort((a, b) => a - b),
      start_time: values.start_time,
      end_time: values.end_time,
      slot_minutes: Number(values.slot_minutes),
      seats_per_slot: values.seats_per_slot,
      min_lead_hours: values.min_lead_hours,
      max_days_ahead: values.max_days_ahead,
      blackout_dates: values.blackout_dates,
      site_office_address: values.site_office_address.trim() || null,
      maps_link: values.maps_link.trim() || null,
      instructions: values.instructions.trim() || null,
    };
  })
  .pipe(VisitSettingsSchema);

function toValues(row: VisitSettingsRow): VisitValues {
  const s = row.settings;
  return {
    enabled: s.enabled,
    visit_days: [...s.visit_days],
    start_time: s.start_time,
    end_time: s.end_time,
    slot_minutes: String(s.slot_minutes),
    seats_per_slot: s.seats_per_slot,
    min_lead_hours: s.min_lead_hours,
    max_days_ahead: s.max_days_ahead,
    blackout_dates: [...s.blackout_dates],
    site_office_address: s.site_office_address ?? "",
    maps_link: s.maps_link ?? "",
    instructions: s.instructions ?? "",
  };
}

export function VisitSettingsTab({ project }: { project: ProjectRow }) {
  const settings = useVisitSettings(project.id);
  if (settings.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (settings.isError)
    return (
      <ErrorState
        error={settings.error}
        onRetry={() => void settings.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  return <VisitSettingsForm project={project} row={settings.data} />;
}

function VisitSettingsForm({ project, row }: { project: ProjectRow; row: VisitSettingsRow }) {
  const { can } = useAuth();
  const canWrite = can("project.write") || can("visit.write");
  const resolver = useMemo(() => contractResolver<VisitValues, unknown>(FormSchema), []);
  const form = useForm<VisitValues, unknown, unknown>({ resolver, defaultValues: toValues(row), mode: "onTouched" });
  // Leaving with unsaved edits (sidebar, Cmd+K, back, reload) asks first (audit v3 H3).
  useUnsavedChangesGuard(form.formState.isDirty);
  const control = controlOf(form);
  const [serverError, setServerError] = useState<unknown>(null);
  const [newBlackout, setNewBlackout] = useState<string | null>(null);

  useEffect(() => {
    form.reset(toValues(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed the form only when the server row changes version
  }, [row.version]);

  const save = useMutationWithToast<VisitSettingsRow, unknown>({
    mutationFn: (settings) =>
      api.patch<VisitSettingsRow>(
        `${PROJECTS_PATH}/${project.id}/visit-settings`,
        { version: row.version, settings },
        { version: row.version },
      ),
    successMessage: "Site-visit settings saved",
    invalidate: [inventoryKeys.visitSettings(project.id)],
    entityLabel: "Visit settings",
    errorMessage: false,
    onError: (error: ApiClientError) => {
      if (error.isVersionConflict) return;
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });

  const enabled = useWatch({ control, name: "enabled" });
  const days = useWatch({ control, name: "visit_days" });
  const blackouts = useWatch({ control, name: "blackout_dates" });

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((value) => value !== day) : [...days, day];
    form.setValue("visit_days", next, { shouldDirty: true, shouldValidate: true });
  };

  const addBlackout = () => {
    if (!newBlackout || blackouts.includes(newBlackout)) return;
    form.setValue("blackout_dates", [...blackouts, newBlackout].sort(), { shouldDirty: true });
    setNewBlackout(null);
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((output) => {
        setServerError(null);
        save.mutate(output);
      })}
      className="grid gap-4 lg:grid-cols-3"
    >
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Scheduler</CardTitle>
          <p className="text-xs text-ink-subtle">
            Controls the public "Book a private site visit" flow and the ERP calendar for {project.name}.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {serverError !== null && <FormError error={serverError} />}
          <FormField
            control={control}
            name="enabled"
            render={({ field }) => (
              <Switch
                id={field.id}
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={!canWrite}
                label="Site-visit booking enabled"
                description="When off, the website hides the booking card; staff can still create visits here."
                data-testid="visit-enabled"
              />
            )}
          />
          {!enabled && <Notice tone="warning">Booking is switched off for visitors.</Notice>}

          <FormSection title="Visit days">
            <FormField
              control={control}
              name="visit_days"
              render={({ field }) => (
                <div role="group" aria-labelledby={field.id} className="flex flex-wrap gap-1.5">
                  {DAYS.map((day) => {
                    const active = days.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={active}
                        disabled={!canWrite}
                        onClick={() => toggleDay(day.value)}
                        className={cn(
                          "h-8 min-w-12 rounded-full border px-3 text-xs font-semibold transition-colors focus-ring",
                          active
                            ? "border-navy-950 bg-navy-950 text-white"
                            : "border-border-strong bg-card text-ink-muted hover:border-navy-300",
                        )}
                        data-testid={`visit-day-${day.value}`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </FormSection>

          <FormSection title="Slots">
            <FormRow columns={4}>
              <FormField
                control={control}
                name="start_time"
                label="Start (IST)"
                required
                render={({ field }) => (
                  <Input
                    {...field}
                    type="time"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    disabled={!canWrite}
                    className="money"
                  />
                )}
              />
              <FormField
                control={control}
                name="end_time"
                label="End (IST)"
                required
                render={({ field }) => (
                  <Input
                    {...field}
                    type="time"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    disabled={!canWrite}
                    className="money"
                  />
                )}
              />
              <FormField
                control={control}
                name="slot_minutes"
                label="Slot length"
                render={({ field }) => (
                  <Select
                    id={field.id}
                    value={field.value}
                    onValueChange={(value) => field.onChange(value ?? "60")}
                    options={SLOT_MINUTES.map((minutes) => ({ value: String(minutes), label: `${minutes} min` }))}
                    disabled={!canWrite}
                  />
                )}
              />
              <FormField
                control={control}
                name="seats_per_slot"
                label="Seats per slot"
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={(value) => field.onChange(value ?? 1)}
                    onBlur={field.onBlur}
                    decimals={0}
                    min={1}
                    max={50}
                    disabled={!canWrite}
                  />
                )}
              />
              <FormField
                control={control}
                name="min_lead_hours"
                label="Minimum lead time"
                hint="Slots sooner than this are hidden"
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={(value) => field.onChange(value ?? 0)}
                    onBlur={field.onBlur}
                    decimals={0}
                    min={0}
                    max={168}
                    suffix="hours"
                    disabled={!canWrite}
                  />
                )}
              />
              <FormField
                control={control}
                name="max_days_ahead"
                label="Book up to"
                render={({ field }) => (
                  <NumberInput
                    id={field.id}
                    value={field.value}
                    onChange={(value) => field.onChange(value ?? 1)}
                    onBlur={field.onBlur}
                    decimals={0}
                    min={1}
                    max={90}
                    suffix="days ahead"
                    disabled={!canWrite}
                  />
                )}
              />
            </FormRow>
          </FormSection>

          <FormSection title="Blackout dates" description="No visits on these dates (holidays, events).">
            <div className="flex flex-wrap items-center gap-1.5">
              {blackouts.map((date) => (
                <span
                  key={date}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs"
                >
                  {formatDate(date)}
                  {canWrite && (
                    <button
                      type="button"
                      aria-label={`Remove ${formatDate(date)}`}
                      onClick={() =>
                        form.setValue(
                          "blackout_dates",
                          blackouts.filter((value) => value !== date),
                          { shouldDirty: true },
                        )
                      }
                      className="rounded-full p-0.5 text-ink-subtle hover:text-danger-fg focus-ring"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
              {blackouts.length === 0 && <span className="text-xs text-ink-subtle">None</span>}
            </div>
            {canWrite && (
              <div className="flex items-end gap-2">
                <div className="w-48">
                  <DateInput aria-label="Blackout date" value={newBlackout} onChange={setNewBlackout} />
                </div>
                <Button variant="outline" size="md" leftIcon={Plus} onClick={addBlackout} disabled={!newBlackout}>
                  Add date
                </Button>
              </div>
            )}
          </FormSection>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Site office</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              control={control}
              name="site_office_address"
              label="Address"
              render={({ field }) => (
                <Textarea
                  {...field}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  rows={3}
                  maxLength={300}
                  disabled={!canWrite}
                />
              )}
            />
            <FormField
              control={control}
              name="maps_link"
              label="Google Maps link"
              render={({ field }) => (
                <Input
                  {...field}
                  type="url"
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  placeholder="https://maps.app.goo.gl/…"
                  maxLength={500}
                  disabled={!canWrite}
                />
              )}
            />
            <FormField
              control={control}
              name="instructions"
              label="Instructions for visitors"
              hint="Included in the confirmation and the .ics invite"
              render={({ field }) => (
                <Textarea
                  {...field}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  disabled={!canWrite}
                />
              )}
            />
          </CardContent>
        </Card>
        {canWrite && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => form.reset(toValues(row))}
              disabled={!form.formState.isDirty || save.isPending}
            >
              Reset
            </Button>
            <Button
              type="submit"
              leftIcon={Save}
              loading={save.isPending}
              disabled={!form.formState.isDirty}
              data-testid="visit-settings-save"
            >
              Save settings
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
