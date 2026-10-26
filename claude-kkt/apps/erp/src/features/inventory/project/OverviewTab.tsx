import { CheckCircle2, Clock3, MapPin, MinusCircle, Pencil, Save, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { ConstructionStageRow, ProjectRow } from "@kkt/contracts";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  KeyValueList,
  StatusChip,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber, formatSqft } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { useMasterRows } from "@/features/masters/api";
import type { AmenityRow } from "@kkt/contracts";
import { PROJECTS_PATH } from "../api";
import { Notice, SortableIdList } from "../components";
import { useOnChange } from "@/lib/utils";

export interface OverviewTabProps {
  project: ProjectRow;
  onEdit?: (() => void) | undefined;
}

const APPROVAL_ICON = { RECEIVED: CheckCircle2, APPLIED: Clock3, NA: MinusCircle } as const;
const APPROVAL_TONE = { RECEIVED: "success", APPLIED: "warning", NA: "neutral" } as const;

export function OverviewTab({ project, onEdit }: OverviewTabProps) {
  const amenities = useMasterRows<AmenityRow>("amenities", { includeInactive: true });
  const amenityNames = useMemo(() => {
    const byId = new Map((amenities.data ?? []).map((row) => [row.id, row] as const));
    return project.amenity_ids.map((id) => byId.get(id)).filter((row): row is AmenityRow => row !== undefined);
  }, [amenities.data, project.amenity_ids]);

  const facts = [
    {
      label: "Type",
      value: project.project_type.charAt(0) + project.project_type.slice(1).toLowerCase().replace("_", " "),
    },
    { label: "Status", value: <StatusChip status={project.status} size="sm" /> },
    { label: "RERA number", value: project.rera_number },
    { label: "Launch", value: project.launch_date ? formatDate(project.launch_date) : null },
    { label: "Possession", value: project.possession_date ? formatDate(project.possession_date) : null },
    { label: "Land area", value: project.land_area_sqft !== null ? formatSqft(project.land_area_sqft) : null },
    { label: "Blocks", value: formatNumber(project.block_count), numeric: true },
    { label: "Units", value: formatNumber(project.unit_counts.total), numeric: true },
    {
      label: "Address",
      value: [
        project.address.line1,
        project.address.line2,
        project.address.locality,
        `${project.address.city}, ${project.address.state} ${project.address.pincode}`,
      ]
        .filter(Boolean)
        .join(", "),
      full: true,
    },
    {
      label: "Coordinates",
      value:
        project.latitude !== null && project.longitude !== null ? (
          <a
            className="inline-flex items-center gap-1 text-navy-700 hover:underline"
            href={`https://www.google.com/maps?q=${project.latitude},${project.longitude}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <MapPin className="size-3.5" aria-hidden="true" /> {project.latitude.toFixed(5)},{" "}
            {project.longitude.toFixed(5)}
          </a>
        ) : null,
    },
    { label: "Description", value: project.description, full: true },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          actions={
            onEdit ? (
              <Button variant="ghost" size="sm" leftIcon={Pencil} onClick={onEdit}>
                Edit
              </Button>
            ) : undefined
          }
        >
          <CardTitle>Facts</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValueList items={facts} columns={3} />
        </CardContent>
      </Card>

      <StageSequenceCard project={project} />

      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {project.approvals.length === 0 ? (
            <EmptyState
              compact
              title="No approvals recorded"
              description="Add RERA, building plan and NOCs from Edit."
            />
          ) : (
            <ul className="divide-y divide-border">
              {project.approvals.map((approval, index) => {
                const Icon = APPROVAL_ICON[approval.status];
                return (
                  <li key={`${approval.name}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon
                      className={
                        approval.status === "RECEIVED"
                          ? "size-4 text-success"
                          : approval.status === "APPLIED"
                            ? "size-4 text-warning"
                            : "size-4 text-ink-subtle"
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{approval.name}</p>
                      <p className="truncate text-2xs text-ink-subtle">
                        {approval.number && <span className="font-mono">{approval.number} · </span>}
                        {approval.issued_on ? `Issued ${formatDate(approval.issued_on)}` : "No date"}
                      </p>
                    </div>
                    <Badge variant={APPROVAL_TONE[approval.status]}>
                      {approval.status === "NA"
                        ? "N/A"
                        : approval.status.charAt(0) + approval.status.slice(1).toLowerCase()}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Landmarks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {project.landmarks.length === 0 ? (
            <EmptyState
              compact
              title="No landmarks"
              description="Nearby places with distances show on the website map."
            />
          ) : (
            <ul className="divide-y divide-border">
              {project.landmarks.map((landmark, index) => (
                <li
                  key={`${landmark.name}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="truncate">{landmark.name}</span>
                  <span className="money shrink-0 text-ink-muted">{landmark.distance_km} km</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {project.team.length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No team members"
              description="Assign the staff responsible from Edit."
            />
          ) : (
            <ul className="divide-y divide-border">
              {project.team.map((member) => (
                <li key={member.user_id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={member.user_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{member.user_name}</p>
                    {member.role_label && <p className="truncate text-2xs text-ink-subtle">{member.role_label}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>
            Amenities{" "}
            <span className="money ml-1 text-xs font-normal text-ink-subtle">
              {formatNumber(project.amenity_ids.length)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.amenity_ids.length === 0 ? (
            <p className="text-sm text-ink-subtle">No amenities selected.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {amenityNames.map((amenity) => (
                <Badge key={amenity.id} variant="outline">
                  {amenity.name}
                </Badge>
              ))}
              {amenities.data && amenityNames.length < project.amenity_ids.length && (
                <Badge variant="neutral">+{project.amenity_ids.length - amenityNames.length} unknown</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Ordered construction stage sequence for the project (new blocks snapshot it). */
function StageSequenceCard({ project }: { project: ProjectRow }) {
  const { can } = useAuth();
  const canEdit = can("project.write");
  const stages = useMasterRows<ConstructionStageRow>("construction-stages", {
    sort: "sort_order",
    includeInactive: true,
  });
  const [draft, setDraft] = useState<string[] | null>(null);
  const value = draft ?? project.stage_sequence;

  // A newer project version discards the unsaved reorder.
  useOnChange(project.version, () => setDraft(null));

  const options = useMemo(
    () =>
      (stages.data ?? []).map((stage) => ({
        id: stage.id,
        label: stage.name,
        description: stage.is_possession ? "Possession stage" : `Order ${stage.sort_order}`,
        badge: stage.is_active ? undefined : <Badge variant="danger">Inactive</Badge>,
      })),
    [stages.data],
  );

  const masterDefault = useMemo(
    () =>
      (stages.data ?? [])
        .filter((stage) => stage.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((stage) => stage.id),
    [stages.data],
  );

  const save = useMutationWithToast<ProjectRow, string[]>({
    mutationFn: (sequence) =>
      api.patch<ProjectRow>(
        `${PROJECTS_PATH}/${project.id}`,
        { stage_sequence: sequence, version: project.version },
        { version: project.version },
      ),
    successMessage: "Stage sequence saved",
    invalidate: [[PROJECTS_PATH]],
    entityLabel: "This project",
    onSuccess: () => setDraft(null),
  });

  const dirty = draft !== null && draft.join("|") !== project.stage_sequence.join("|");

  return (
    <Card>
      <CardHeader
        actions={
          canEdit && dirty ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={save.isPending}>
                Reset
              </Button>
              <Button
                variant="gold"
                size="sm"
                leftIcon={Save}
                loading={save.isPending}
                onClick={() => save.mutate(value)}
                data-testid="project-save-stages-btn"
              >
                Save
              </Button>
            </>
          ) : undefined
        }
      >
        <CardTitle>Stage sequence</CardTitle>
        <p className="text-xs text-ink-subtle">New blocks snapshot this order. Existing blocks keep theirs.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {value.length === 0 && !canEdit && (
          <Notice tone="warning">No sequence set — blocks will use the master order.</Notice>
        )}
        <SortableIdList
          value={value}
          onChange={setDraft}
          options={options}
          disabled={!canEdit || save.isPending}
          onResetToDefault={canEdit ? () => setDraft(masterDefault) : undefined}
          emptyText="Using the master order. Pick stages below or load the default."
          data-testid="project-stage-sequence"
        />
      </CardContent>
    </Card>
  );
}
