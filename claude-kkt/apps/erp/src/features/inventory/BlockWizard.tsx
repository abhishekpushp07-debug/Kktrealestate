import { ArrowLeft, ArrowRight, Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BLOCK_STATUSES,
  BLOCK_STATUS_LABELS,
  BlockCreateSchema,
  NUMBERING_PATTERNS,
  NUMBERING_PATTERN_LABELS,
  type BlockRow,
  type BlockTypeRow,
  type ConstructionStageRow,
  type FlatTypeRow,
  type FloorPlanTemplateRow,
  type NumberingPattern,
  type RateCardRow,
} from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, ErrorState, FieldWrapper, Input, KeyValueList, NumberInput, PageHeader, PageSkeleton, Select, Skeleton, Stepper, Switch, type Step } from "@/components/ui";
import { api, isApiClientError } from "@/lib/api";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import NotFoundPage from "@/pages/NotFoundPage";
import { useMasterRows } from "@/features/masters/api";
import { BLOCKS_PATH, FLATS_PATH, PROJECTS_PATH, useProject, useRateCards } from "./api";
import { Notice, SortableIdList } from "./components";
import { computeFlatPrice, expectedFlatCount, floorLabel, listFloors, templateForFloor, unitFloors, validateFloorRanges, type FloorSpec, type RangeInput, type WizardFloorKind } from "./inventoryMath";

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

interface WizardState {
  block_type_id: string | null;
  name: string;
  code: string;
  numbering_pattern: NumberingPattern;
  status: string;
  floors: number | null;
  floor_start: number | null;
  ground_floor_label: string;
  skip_floors: number[];
  refuge_floors: number[];
  podium_floors: number[];
  floor_plans: RangeInput[];
  use_project_stages: boolean;
  stage_sequence: string[];
  generate_flats: boolean;
}

const STEPS: readonly Step[] = [
  { id: "basics", label: "Block type & basics", description: "Type, name, code, numbering" },
  { id: "floors", label: "Floors & skips", description: "Floor range, skipped, refuge, podium" },
  { id: "plans", label: "Floor-plan ranges", description: "Which template covers which floors" },
  { id: "pricing", label: "Pricing & stages", description: "Rate card preview, stage sequence" },
  { id: "review", label: "Review & generate", description: "Expected flats, create" },
];

const KIND_CYCLE: readonly WizardFloorKind[] = ["UNITS", "SKIP", "REFUGE", "PODIUM"];
const KIND_CLASS: Readonly<Record<WizardFloorKind, string>> = {
  UNITS: "border-status-available-border bg-status-available-bg text-status-available-fg",
  SKIP: "border-dashed border-border-strong bg-surface text-ink-subtle line-through",
  REFUGE: "border-status-hold-border bg-status-hold-bg text-status-hold-fg",
  PODIUM: "border-navy-300 bg-navy-100 text-navy-950",
};
const KIND_LABEL: Readonly<Record<WizardFloorKind, string>> = { UNITS: "Units", SKIP: "Skipped", REFUGE: "Refuge", PODIUM: "Podium" };

const TYPE_CHIP = ["bg-navy-100 text-navy-950", "bg-gold-light text-gold-text", "bg-info-bg text-info-fg", "bg-success-bg text-success-fg", "bg-warning-bg text-warning-fg", "bg-danger-bg text-danger-fg", "bg-navy-200 text-navy-950", "bg-surface text-ink"] as const;

function initialState(): WizardState {
  return {
    block_type_id: null,
    name: "",
    code: "",
    numbering_pattern: "{block}-{floor}{pos2}",
    status: "PLANNING",
    floors: 10,
    floor_start: 1,
    ground_floor_label: "G",
    skip_floors: [],
    refuge_floors: [],
    podium_floors: [],
    floor_plans: [{ from_floor: 1, to_floor: 10, floor_plan_template_id: null }],
    use_project_stages: true,
    stage_sequence: [],
    generate_flats: true,
  };
}

function specOf(state: WizardState, hasFloors: boolean): FloorSpec {
  if (!hasFloors) return { floor_start: 0, floors: 0, skip_floors: [], refuge_floors: [], podium_floors: [] };
  return { floor_start: state.floor_start ?? 0, floors: state.floors ?? 0, skip_floors: state.skip_floors, refuge_floors: state.refuge_floors, podium_floors: state.podium_floors };
}

/** Sample flat number from the numbering pattern. */
export function sampleFlatNumber(pattern: NumberingPattern, code: string, floor: number, position: number, seq: number): string {
  const pos2 = String(position).padStart(2, "0");
  switch (pattern) {
    case "{block}-{floor}{pos2}":
      return `${code || "A"}-${floor}${pos2}`;
    case "{floor}{pos2}":
      return `${floor}${pos2}`;
    case "{block}{seq}":
      return `${code || "V"}${seq}`;
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

/** `/projects/:id/blocks/new` — five-step block wizard ending in atomic flat generation. */
export default function BlockWizard() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const blockTypes = useMasterRows<BlockTypeRow>("block-types");
  const templates = useMasterRows<FloorPlanTemplateRow>("floor-plan-templates");
  const flatTypes = useMasterRows<FlatTypeRow>("flat-types");
  const stages = useMasterRows<ConstructionStageRow>("construction-stages", { sort: "sort_order" });
  const rateCards = useRateCards(projectId);

  const [state, setState] = useState<WizardState>(initialState);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  const update = (patch: Partial<WizardState>) => {
    setTouched(true);
    setState((prev) => ({ ...prev, ...patch }));
  };

  // Unsaved guard (browser navigation / reload).
  useEffect(() => {
    if (!touched) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [touched]);

  const blockType = blockTypes.data?.find((type) => type.id === state.block_type_id) ?? null;
  const hasFloors = blockType?.has_floors ?? true;
  const spec = specOf(state, hasFloors);
  const templateById = useMemo(() => new Map((templates.data ?? []).map((template) => [template.id, template] as const)), [templates.data]);
  const flatTypeById = useMemo(() => new Map((flatTypes.data ?? []).map((type) => [type.id, type] as const)), [flatTypes.data]);
  const flatsPerTemplate = useMemo(() => Object.fromEntries((templates.data ?? []).map((template) => [template.id, template.flats_per_floor])), [templates.data]);
  const validation = useMemo(() => validateFloorRanges(state.floor_plans, spec), [state.floor_plans, spec]);
  const expected = useMemo(() => expectedFlatCount(state.floor_plans, spec, flatsPerTemplate), [state.floor_plans, spec, flatsPerTemplate]);
  const activeCard = rateCards.data?.find((card) => card.status === "ACTIVE") ?? null;

  const stepErrors = useMemo<Record<number, string[]>>(() => {
    const basics: string[] = [];
    if (!state.block_type_id) basics.push("Pick a block type");
    if (!state.name.trim()) basics.push("Name is required");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(state.code.trim().toUpperCase())) basics.push("Code: upper-case letters, digits, _ or - (max 30)");
    const floors: string[] = [];
    if (hasFloors) {
      if (state.floors === null || state.floor_start === null) floors.push("Give the floor range");
      else if (state.floor_start > state.floors) floors.push("Floor start must be ≤ floors");
      if (unitFloors(spec).length === 0) floors.push("At least one floor must carry units");
    }
    const plans: string[] = [];
    if (state.floor_plans.length === 0) plans.push("Add at least one floor-plan range");
    if (validation.invalid.length) plans.push("Every range needs from ≤ to");
    if (validation.missingTemplate.length) plans.push("Every range needs a template");
    if (validation.outside.length) plans.push("Ranges must stay within the floor range");
    if (validation.overlaps.length) plans.push("Ranges must not overlap");
    if (validation.uncovered.length) plans.push(`Floors without a plan: ${validation.uncovered.join(", ")}`);
    const pricing: string[] = [];
    if (!state.use_project_stages && state.stage_sequence.length === 0) pricing.push("Pick at least one stage or use the project's sequence");
    return { 0: basics, 1: floors, 2: plans, 3: pricing, 4: [] };
  }, [state, hasFloors, spec, validation]);

  const canProceed = (stepErrors[step] ?? []).length === 0;
  const allValid = Object.values(stepErrors).every((errors) => errors.length === 0);

  const payload = useMemo(() => {
    const projectStages = project.data?.stage_sequence ?? [];
    return {
      project_id: projectId ?? "",
      block_type_id: state.block_type_id ?? "",
      name: state.name.trim(),
      code: state.code.trim().toUpperCase(),
      floors: spec.floors,
      floor_start: spec.floor_start,
      ground_floor_label: state.ground_floor_label.trim() || "G",
      skip_floors: spec.skip_floors,
      refuge_floors: spec.refuge_floors,
      podium_floors: spec.podium_floors,
      floor_plans: hasFloors
        ? state.floor_plans.map((range) => ({ from_floor: range.from_floor ?? 0, to_floor: range.to_floor ?? 0, floor_plan_template_id: range.floor_plan_template_id ?? "" }))
        : state.floor_plans.slice(0, 1).map((range) => ({ from_floor: 0, to_floor: 0, floor_plan_template_id: range.floor_plan_template_id ?? "" })),
      numbering_pattern: state.numbering_pattern,
      ...(state.use_project_stages ? (projectStages.length ? { stage_sequence: projectStages } : {}) : { stage_sequence: state.stage_sequence }),
      status: state.status,
      sort_order: 0,
      generate_flats: state.generate_flats,
    };
  }, [state, spec, hasFloors, projectId, project.data]);

  const create = useMutationWithToast<BlockRow, unknown>({
    mutationFn: (body) => api.post<BlockRow>(BLOCKS_PATH, body),
    successMessage: (saved) => `${saved.name} created${state.generate_flats ? ` with ${formatNumber(saved.unit_counts.total)} flats` : ""}`,
    invalidate: [[BLOCKS_PATH], [FLATS_PATH], [PROJECTS_PATH]],
    onSuccess: (saved) => {
      setTouched(false);
      navigate(`/blocks/${saved.id}`, { replace: true });
    },
  });

  const submit = () => {
    const parsed = BlockCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    setIssues([]);
    create.mutate(parsed.data);
  };

  if (project.isPending) return <PageSkeleton />;
  if (project.isError) {
    if (isApiClientError(project.error) && project.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} className="rounded-lg border border-border bg-card" />;
  }
  const projectRow = project.data;
  const backTo = `/projects/${projectRow.id}?tab=blocks`;

  const steps: Step[] = STEPS.map((definition, index) => ({ ...definition, error: index < step && (stepErrors[index] ?? []).length > 0 }));

  return (
    <div className="pb-24">
      <PageHeader title="New block" description={`Add a tower or villa block to ${projectRow.name}. Flats are generated atomically at the end.`} breadcrumbs={[{ label: "Home", to: "/" }, { label: "Projects", to: "/projects" }, { label: projectRow.name, to: backTo }, { label: "New block" }]} backTo={backTo} />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Stepper steps={steps} current={step} onStepClick={(index) => index < step && setStep(index)} className="lg:sticky lg:top-20 lg:self-start" />
        <div className="min-w-0 space-y-4">
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Block type & basics</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label="Block type" required hint={blockTypes.isError ? "Could not load block types" : blockType && !blockType.has_floors ? "Single-level block: villas / row houses are numbered in sequence" : undefined}>
                  {(control) => <Select id={control.id} value={state.block_type_id} onValueChange={(value) => {
                    const type = blockTypes.data?.find((item) => item.id === value) ?? null;
                    update({ block_type_id: value, numbering_pattern: type && !type.has_floors ? "{block}{seq}" : state.numbering_pattern === "{block}{seq}" && type?.has_floors ? "{block}-{floor}{pos2}" : state.numbering_pattern });
                  }} options={(blockTypes.data ?? []).map((type) => ({ value: type.id, label: type.name, description: type.has_floors ? "Has floors" : "Single level" }))} placeholder={blockTypes.isPending ? "Loading…" : "Pick a type"} data-testid="wizard-block-type" />}
                </FieldWrapper>
                <FieldWrapper label="Status">{(control) => <Select id={control.id} value={state.status} onValueChange={(value) => update({ status: value ?? "PLANNING" })} options={BLOCK_STATUSES.map((value) => ({ value, label: BLOCK_STATUS_LABELS[value] }))} />}</FieldWrapper>
                <FieldWrapper label="Name" required>{(control) => <Input id={control.id} value={state.name} onChange={(event) => update({ name: event.target.value })} placeholder="Tower A" maxLength={120} data-testid="wizard-name" />}</FieldWrapper>
                <FieldWrapper label="Code" required hint="Used in flat numbers">{(control) => <Input id={control.id} value={state.code} onChange={(event) => update({ code: event.target.value.toUpperCase() })} placeholder="A" maxLength={30} className="font-mono uppercase" data-testid="wizard-code" />}</FieldWrapper>
                <FieldWrapper label="Numbering pattern" className="sm:col-span-2" hint={`Example: ${sampleFlatNumber(state.numbering_pattern, state.code.trim().toUpperCase(), 1, 1, 1)}, ${sampleFlatNumber(state.numbering_pattern, state.code.trim().toUpperCase(), 1, 2, 2)}, ${sampleFlatNumber(state.numbering_pattern, state.code.trim().toUpperCase(), 2, 1, 3)}`}>
                  {(control) => <Select id={control.id} value={state.numbering_pattern} onValueChange={(value) => value && update({ numbering_pattern: value })} options={NUMBERING_PATTERNS.map((value) => ({ value, label: NUMBERING_PATTERN_LABELS[value] }))} />}
                </FieldWrapper>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Floors & skips</CardTitle>
                <p className="text-xs text-ink-subtle">Click a floor to cycle: units → skipped (e.g. no 13th) → refuge → podium.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasFloors ? (
                  <Notice tone="info">{blockType?.name ?? "This block type"} has no floors: every unit sits on the ground level and the floor-plan template is applied once.</Notice>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <FieldWrapper label="Top floor" required>{(control) => <NumberInput id={control.id} value={state.floors} onChange={(value) => update({ floors: value })} decimals={0} min={0} max={200} align="left" data-testid="wizard-floors" />}</FieldWrapper>
                      <FieldWrapper label="Floor start" required hint="0 = ground, negative = basements">{(control) => <NumberInput id={control.id} value={state.floor_start} onChange={(value) => update({ floor_start: value })} decimals={0} min={-5} max={200} allowNegative align="left" data-testid="wizard-floor-start" />}</FieldWrapper>
                      <FieldWrapper label="Ground floor label">{(control) => <Input id={control.id} value={state.ground_floor_label} onChange={(event) => update({ ground_floor_label: event.target.value })} maxLength={10} className="font-mono" />}</FieldWrapper>
                    </div>
                    <FloorStrip state={state} spec={spec} onChange={update} />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <RangesStep state={state} spec={spec} hasFloors={hasFloors} validation={validation} templates={templates.data ?? []} templatesPending={templates.isPending} flatTypeById={flatTypeById} templateById={templateById} onChange={update} />
          )}

          {step === 3 && (
            <PricingStep state={state} spec={spec} templateById={templateById} flatTypeById={flatTypeById} activeCard={activeCard} rateCardsPending={rateCards.isPending} stages={stages.data ?? []} projectStages={projectRow.stage_sequence} onChange={update} />
          )}

          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle>Review & generate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <KeyValueList
                  columns={3}
                  items={[
                    { label: "Block", value: `${state.name.trim()} (${state.code.trim().toUpperCase()})` },
                    { label: "Type", value: blockType?.name ?? "—" },
                    { label: "Status", value: BLOCK_STATUS_LABELS[state.status as keyof typeof BLOCK_STATUS_LABELS] ?? state.status },
                    { label: "Floors", value: hasFloors ? `${spec.floor_start} – ${spec.floors} (${unitFloors(spec).length} with units)` : "Single level" },
                    { label: "Skipped", value: spec.skip_floors.length ? spec.skip_floors.join(", ") : "None" },
                    { label: "Refuge / podium", value: [spec.refuge_floors.length ? `Refuge ${spec.refuge_floors.join(", ")}` : null, spec.podium_floors.length ? `Podium ${spec.podium_floors.join(", ")}` : null].filter(Boolean).join(" · ") || "None" },
                    { label: "Numbering", value: NUMBERING_PATTERN_LABELS[state.numbering_pattern] },
                    { label: "Pricing", value: activeCard ? `Rate card "${activeCard.name}"` : "Flat-type base prices (no active rate card)" },
                    { label: "Stage sequence", value: state.use_project_stages ? `Project default (${projectRow.stage_sequence.length} stages)` : `${state.stage_sequence.length} custom stages` },
                  ]}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-gold-border bg-gold-light p-4">
                    <p className="label-caps">Expected flats</p>
                    <p className="money font-display text-3xl font-extrabold text-navy-950" data-testid="wizard-expected-count">
                      {formatNumber(hasFloors ? expected.total : (state.floor_plans[0]?.floor_plan_template_id ? flatsPerTemplate[state.floor_plans[0].floor_plan_template_id] ?? 0 : 0))}
                    </p>
                    <p className="text-xs text-gold-text">Refuge, podium and skipped floors excluded</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-4 sm:col-span-2">
                    <p className="label-caps mb-1">Per template</p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(expected.byTemplate).map(([templateId, count]) => (
                        <li key={templateId} className="flex items-center justify-between gap-2">
                          <span className="truncate">{templateById.get(templateId)?.name ?? "Unknown template"}</span>
                          <span className="money font-semibold">{formatNumber(count)}</span>
                        </li>
                      ))}
                      {Object.keys(expected.byTemplate).length === 0 && <li className="text-xs text-ink-subtle">No ranges resolved yet.</li>}
                    </ul>
                  </div>
                </div>
                <Switch checked={state.generate_flats} onCheckedChange={(checked) => update({ generate_flats: checked })} label="Generate flats now" description="Off = create the block shell only; generate later from the block page." data-testid="wizard-generate" />
                {!allValid && (
                  <Notice tone="danger">
                    <p className="font-semibold">Fix these before generating:</p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {Object.entries(stepErrors).flatMap(([index, errors]) => errors.map((error) => <li key={`${index}-${error}`}>{error}</li>))}
                    </ul>
                  </Notice>
                )}
                {issues.length > 0 && (
                  <Notice tone="danger">
                    <p className="font-semibold">The payload failed validation:</p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </Notice>
                )}
              </CardContent>
            </Card>
          )}

          {(stepErrors[step] ?? []).length > 0 && step < 4 && (
            <ul className="list-disc pl-5 text-xs text-danger-fg" aria-live="polite">
              {(stepErrors[step] ?? []).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 shadow-pop backdrop-blur lg:left-[var(--spacing-sidebar)]">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => (touched ? setCancelOpen(true) : navigate(backTo))} data-testid="wizard-cancel">
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" leftIcon={ArrowLeft} disabled={step === 0 || create.isPending} onClick={() => setStep((value) => Math.max(0, value - 1))} data-testid="wizard-back">
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button rightIcon={ArrowRight} disabled={!canProceed} onClick={() => setStep((value) => value + 1)} data-testid="wizard-next">
                Next
              </Button>
            ) : (
              <Button variant="gold" leftIcon={state.generate_flats ? Sparkles : Check} loading={create.isPending} disabled={!allValid} onClick={submit} data-testid="wizard-create">
                {state.generate_flats ? `Create & generate ${formatNumber(expected.total)} flats` : "Create block"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Discard this block?" description="Nothing has been saved yet. Your wizard entries will be lost." confirmLabel="Discard" variant="destructive" onConfirm={() => {
        setTouched(false);
        navigate(backTo);
      }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Floor strip                                                          */
/* ------------------------------------------------------------------ */

function FloorStrip({ state, spec, onChange }: { state: WizardState; spec: FloorSpec; onChange: (patch: Partial<WizardState>) => void }) {
  const floors = useMemo(() => listFloors(spec).reverse(), [spec]);
  const cycle = (floor: number, kind: WizardFloorKind) => {
    const next = KIND_CYCLE[(KIND_CYCLE.indexOf(kind) + 1) % KIND_CYCLE.length] ?? "UNITS";
    const without = (list: number[]) => list.filter((value) => value !== floor);
    onChange({
      skip_floors: next === "SKIP" ? [...without(state.skip_floors), floor].sort((a, b) => a - b) : without(state.skip_floors),
      refuge_floors: next === "REFUGE" ? [...without(state.refuge_floors), floor].sort((a, b) => a - b) : without(state.refuge_floors),
      podium_floors: next === "PODIUM" ? [...without(state.podium_floors), floor].sort((a, b) => a - b) : without(state.podium_floors),
    });
  };
  const counts = floors.reduce<Record<WizardFloorKind, number>>(
    (acc, entry) => {
      acc[entry.kind] += 1;
      return acc;
    },
    { UNITS: 0, SKIP: 0, REFUGE: 0, PODIUM: 0 },
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {KIND_CYCLE.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 rounded-xs border", KIND_CLASS[kind])} aria-hidden="true" />
            {KIND_LABEL[kind]} <span className="money font-semibold">{counts[kind]}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Floors">
        {floors.map((entry) => (
          <button
            key={entry.floor}
            type="button"
            onClick={() => cycle(entry.floor, entry.kind)}
            aria-label={`Floor ${floorLabel(entry.floor, state.ground_floor_label)}: ${KIND_LABEL[entry.kind]}`}
            title={KIND_LABEL[entry.kind]}
            className={cn("money flex h-10 w-12 flex-col items-center justify-center rounded-md border text-xs font-bold leading-none transition-colors focus-ring", KIND_CLASS[entry.kind])}
            data-testid={`wizard-floor-${entry.floor}`}
          >
            {floorLabel(entry.floor, state.ground_floor_label)}
            <span className="mt-0.5 text-[9px] font-medium uppercase opacity-80">{entry.kind === "UNITS" ? "" : KIND_LABEL[entry.kind].slice(0, 6)}</span>
          </button>
        ))}
      </div>
      {floors.length === 0 && <p className="text-xs text-ink-subtle">Enter the floor range above to lay out the floors.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ranges step                                                          */
/* ------------------------------------------------------------------ */

interface RangesStepProps {
  state: WizardState;
  spec: FloorSpec;
  hasFloors: boolean;
  validation: ReturnType<typeof validateFloorRanges>;
  templates: readonly FloorPlanTemplateRow[];
  templatesPending: boolean;
  flatTypeById: Map<string, FlatTypeRow>;
  templateById: Map<string, FloorPlanTemplateRow>;
  onChange: (patch: Partial<WizardState>) => void;
}

function RangesStep({ state, spec, hasFloors, validation, templates, templatesPending, flatTypeById, templateById, onChange }: RangesStepProps) {
  const options = templates.map((template) => ({ value: template.id, label: template.name, description: `${template.code} · ${template.flats_per_floor} per floor` }));
  const setRange = (index: number, patch: Partial<RangeInput>) => onChange({ floor_plans: state.floor_plans.map((range, position) => (position === index ? { ...range, ...patch } : range)) });
  const remove = (index: number) => onChange({ floor_plans: state.floor_plans.filter((_, position) => position !== index) });
  const fillRemaining = () => {
    const uncovered = validation.uncovered;
    if (uncovered.length === 0) return;
    const from = uncovered[0] ?? spec.floor_start;
    const to = uncovered[uncovered.length - 1] ?? spec.floors;
    onChange({ floor_plans: [...state.floor_plans, { from_floor: from, to_floor: to, floor_plan_template_id: null }] });
  };
  const typeIndex = useMemo(() => new Map([...flatTypeById.keys()].map((id, index) => [id, index] as const)), [flatTypeById]);
  const previewFloors = useMemo(() => [...unitFloors(spec)].reverse(), [spec]);
  const overlapping = new Set(validation.overlaps.flat());

  if (!hasFloors) {
    const range = state.floor_plans[0] ?? { from_floor: 0, to_floor: 0, floor_plan_template_id: null };
    return (
      <Card>
        <CardHeader>
          <CardTitle>Floor plan</CardTitle>
          <p className="text-xs text-ink-subtle">A single-level block uses one template; each position becomes a unit.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldWrapper label="Template" required>{(control) => <Select id={control.id} value={range.floor_plan_template_id} onValueChange={(value) => onChange({ floor_plans: [{ from_floor: 0, to_floor: 0, floor_plan_template_id: value }] })} options={options} placeholder={templatesPending ? "Loading…" : "Pick a template"} data-testid="wizard-range-0-template" />}</FieldWrapper>
          {range.floor_plan_template_id && <TemplatePreview template={templateById.get(range.floor_plan_template_id)} flatTypeById={flatTypeById} typeIndex={typeIndex} />}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_minmax(16rem,22rem)]">
      <Card>
        <CardHeader>
          <CardTitle>Floor-plan ranges</CardTitle>
          <p className="text-xs text-ink-subtle">Every unit floor needs exactly one template; ranges must not overlap.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden grid-cols-[6rem_6rem_1fr_2.5rem] gap-2 px-1 sm:grid">
            {["From", "To", "Template", ""].map((heading, index) => (
              <span key={index} className="label-caps">
                {heading}
              </span>
            ))}
          </div>
          {state.floor_plans.map((range, index) => {
            const bad = validation.invalid.includes(index) || validation.outside.includes(index) || overlapping.has(index);
            return (
              <div key={index} className={cn("grid grid-cols-[1fr_1fr_2.5rem] gap-2 rounded-md border p-2 sm:grid-cols-[6rem_6rem_1fr_2.5rem] sm:items-center sm:border-0 sm:p-0", bad ? "border-danger/40 bg-danger-bg/40" : "border-border")}>
                <NumberInput aria-label={`Range ${index + 1} from floor`} value={range.from_floor} onChange={(value) => setRange(index, { from_floor: value })} decimals={0} min={-5} max={200} allowNegative align="left" invalid={bad} data-testid={`wizard-range-${index}-from`} />
                <NumberInput aria-label={`Range ${index + 1} to floor`} value={range.to_floor} onChange={(value) => setRange(index, { to_floor: value })} decimals={0} min={-5} max={200} allowNegative align="left" invalid={bad} data-testid={`wizard-range-${index}-to`} />
                <Select aria-label={`Range ${index + 1} template`} className="col-span-2 sm:col-span-1" value={range.floor_plan_template_id} onValueChange={(value) => setRange(index, { floor_plan_template_id: value })} options={options} placeholder={templatesPending ? "Loading…" : "Template"} invalid={validation.missingTemplate.includes(index)} data-testid={`wizard-range-${index}-template`} />
                <Button variant="ghost" size="sm" className="col-start-3 row-start-1 px-0 sm:col-start-auto sm:row-start-auto" aria-label="Remove range" onClick={() => remove(index)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => onChange({ floor_plans: [...state.floor_plans, { from_floor: null, to_floor: null, floor_plan_template_id: null }] })} data-testid="wizard-add-range">
              Add range
            </Button>
            {validation.uncovered.length > 0 && (
              <Button variant="ghost" size="sm" leftIcon={Wand2} onClick={fillRemaining}>
                Add range for floors {validation.uncovered[0]}–{validation.uncovered[validation.uncovered.length - 1]}
              </Button>
            )}
          </div>
          {validation.ok && <Notice tone="success">All {unitFloors(spec).length} unit floors are covered.</Notice>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stacked preview</CardTitle>
          <p className="text-xs text-ink-subtle">Flats per floor from the covering template.</p>
        </CardHeader>
        <CardContent className="max-h-[32rem] overflow-y-auto p-2 scrollbar-thin">
          <ol className="space-y-1">
            {previewFloors.map((floor) => {
              const templateId = templateForFloor(state.floor_plans, floor);
              const template = templateId ? templateById.get(templateId) : undefined;
              return (
                <li key={floor} className="flex items-center gap-2">
                  <span className="money w-8 shrink-0 text-right text-xs font-bold text-navy-950">{floorLabel(floor, state.ground_floor_label)}</span>
                  {template ? (
                    <span className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                      {[...template.positions]
                        .sort((a, b) => a.position - b.position)
                        .map((position) => (
                          <span key={position.position} className={cn("money rounded-xs px-1 text-[10px] font-semibold", TYPE_CHIP[(typeIndex.get(position.flat_type_id) ?? 0) % TYPE_CHIP.length])} title={flatTypeById.get(position.flat_type_id)?.name ?? position.flat_type_code}>
                            {position.flat_type_code}
                          </span>
                        ))}
                    </span>
                  ) : (
                    <span className="flex-1 rounded-xs border border-dashed border-danger/40 px-1 text-[10px] text-danger-fg">No plan</span>
                  )}
                  <span className="money w-6 shrink-0 text-right text-2xs text-ink-subtle">{template?.flats_per_floor ?? 0}</span>
                </li>
              );
            })}
            {[...spec.refuge_floors, ...spec.podium_floors].length > 0 && <li className="pt-1 text-2xs text-ink-subtle">Refuge / podium floors ({[...spec.refuge_floors, ...spec.podium_floors].sort((a, b) => a - b).join(", ")}) carry no units.</li>}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplatePreview({ template, flatTypeById, typeIndex }: { template: FloorPlanTemplateRow | undefined; flatTypeById: Map<string, FlatTypeRow>; typeIndex: Map<string, number> }) {
  if (!template) return <Skeleton className="h-10" />;
  return (
    <div className="flex flex-wrap gap-1">
      {[...template.positions]
        .sort((a, b) => a.position - b.position)
        .map((position) => (
          <span key={position.position} className={cn("money rounded-sm px-2 py-1 text-xs font-semibold", TYPE_CHIP[(typeIndex.get(position.flat_type_id) ?? 0) % TYPE_CHIP.length])}>
            {position.position}. {flatTypeById.get(position.flat_type_id)?.name ?? position.flat_type_code}
          </span>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing step                                                         */
/* ------------------------------------------------------------------ */

interface PricingStepProps {
  state: WizardState;
  spec: FloorSpec;
  templateById: Map<string, FloorPlanTemplateRow>;
  flatTypeById: Map<string, FlatTypeRow>;
  activeCard: RateCardRow | null;
  rateCardsPending: boolean;
  stages: readonly ConstructionStageRow[];
  projectStages: readonly string[];
  onChange: (patch: Partial<WizardState>) => void;
}

function PricingStep({ state, spec, templateById, flatTypeById, activeCard, rateCardsPending, stages, projectStages, onChange }: PricingStepProps) {
  // First flat per flat type: lowest unit floor whose template has that type, first matching position.
  const previews = useMemo(() => {
    const seen = new Map<string, { floor: number; position: number; facing: string | null; is_corner: boolean }>();
    const floors = spec.floors === 0 && spec.floor_start === 0 ? [0] : unitFloors(spec);
    for (const floor of floors) {
      const templateId = templateForFloor(state.floor_plans, floor) ?? (spec.floors === 0 ? state.floor_plans[0]?.floor_plan_template_id ?? null : null);
      const template = templateId ? templateById.get(templateId) : undefined;
      if (!template) continue;
      for (const position of [...template.positions].sort((a, b) => a.position - b.position)) {
        if (!seen.has(position.flat_type_id)) seen.set(position.flat_type_id, { floor, position: position.position, facing: position.facing, is_corner: position.is_corner });
      }
    }
    return [...seen.entries()].map(([flatTypeId, first]) => {
      const type = flatTypeById.get(flatTypeId);
      const rate = activeCard?.rates.find((item) => item.flat_type_id === flatTypeId) ?? null;
      const rules = (activeCard?.plc_rules ?? []).map((rule) => ({ label: rule.plc_type_name, calc_mode: rule.calc_mode, value: rule.value, applies_to: rule.applies_to, floors_gte: rule.floors_gte, facings: rule.facings }));
      const sqft = type?.super_builtup_sqft ?? 0;
      const price = computeFlatPrice({ super_builtup_sqft: sqft, floor: first.floor, facing: first.facing, is_corner: first.is_corner }, rate ? { rate_per_sqft_paise: rate.rate_per_sqft_paise, lump_sum_paise: rate.lump_sum_paise } : null, rules, type ? { rate_per_sqft_paise: type.base_rate_per_sqft_paise, lump_sum_paise: type.base_price_paise } : null);
      return { flatTypeId, type, first, rate, price, sqft };
    });
  }, [state.floor_plans, spec, templateById, flatTypeById, activeCard]);

  const stageOptions = stages.map((stage) => ({ id: stage.id, label: stage.name, description: stage.is_possession ? "Possession stage" : `Order ${stage.sort_order}`, badge: stage.is_active ? undefined : <Badge variant="danger">Inactive</Badge> }));
  const masterDefault = stages.filter((stage) => stage.is_active).map((stage) => stage.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <p className="text-xs text-ink-subtle">Generated flats are priced by the project's active rate card, else by the flat type's base rate × super built-up.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {rateCardsPending ? (
            <Skeleton className="h-10" />
          ) : activeCard ? (
            <Notice tone="success">
              Active rate card: <span className="font-semibold">{activeCard.name}</span> · effective {formatDate(activeCard.effective_from)} · {activeCard.plc_rules.length} PLC {activeCard.plc_rules.length === 1 ? "rule" : "rules"}
            </Notice>
          ) : (
            <Notice tone="warning">No active rate card for this project. Flats will use flat-type base prices; you can apply a rate card later.</Notice>
          )}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Flat type</th>
                  <th className="px-3 py-1.5 font-semibold">First flat</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Super built-up</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Base</th>
                  <th className="px-3 py-1.5 text-right font-semibold">PLC</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Preview price</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((preview) => (
                  <tr key={preview.flatTypeId} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs text-navy-950">{preview.type?.code ?? "?"}</span> <span className="text-ink-muted">{preview.type?.name ?? "Unknown type"}</span>
                      {!preview.rate && activeCard && <Badge variant="warning" className="ml-1">No rate</Badge>}
                    </td>
                    <td className="money px-3 py-1.5 text-xs">
                      {sampleFlatNumber(state.numbering_pattern, state.code.trim().toUpperCase(), preview.first.floor, preview.first.position, preview.first.position)}
                      {preview.first.facing ? ` · ${preview.first.facing}` : ""}
                      {preview.first.is_corner ? " · corner" : ""}
                    </td>
                    <td className="money px-3 py-1.5 text-right">{formatNumber(preview.sqft)} sq ft</td>
                    <td className="money px-3 py-1.5 text-right">{formatINR(preview.price.base_paise)}</td>
                    <td className="money px-3 py-1.5 text-right">{formatINR(preview.price.total_paise - preview.price.base_paise)}</td>
                    <td className="money px-3 py-1.5 text-right font-semibold text-navy-950">{formatINR(preview.price.total_paise)}</td>
                  </tr>
                ))}
                {previews.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-center text-xs text-ink-subtle">
                      Pick templates in the previous step to preview prices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-ink-subtle">Preview is computed locally from the rate card and PLC rules; the server stores the authoritative breakup at generation.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Construction stage sequence</CardTitle>
          <p className="text-xs text-ink-subtle">The block snapshots its own copy; payment plans with stage triggers must match it.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Switch checked={state.use_project_stages} onCheckedChange={(checked) => onChange({ use_project_stages: checked, stage_sequence: checked ? state.stage_sequence : state.stage_sequence.length ? state.stage_sequence : projectStages.length ? [...projectStages] : masterDefault })} label="Use the project's sequence" description={projectStages.length ? `${projectStages.length} stages from the project` : "The project has no sequence; the master order is used"} data-testid="wizard-use-project-stages" />
          {!state.use_project_stages && <SortableIdList value={state.stage_sequence} onChange={(ids) => onChange({ stage_sequence: ids })} options={stageOptions} onResetToDefault={() => onChange({ stage_sequence: masterDefault })} data-testid="wizard-stage-sequence" />}
        </CardContent>
      </Card>
    </div>
  );
}
