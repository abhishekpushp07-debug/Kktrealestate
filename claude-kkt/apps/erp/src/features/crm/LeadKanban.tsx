import { CalendarClock, GripVertical, MoreHorizontal, Phone, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  type LeadKanbanResponse,
  type LeadRow,
  type LeadStage,
} from "@kkt/contracts";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@/components/ui";
import { formatPhone, formatRelative } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import { budgetLabel } from "./LeadDrawer";

export interface LeadKanbanProps {
  columns: LeadKanbanResponse["columns"];
  canWrite: boolean;
  onOpen: (lead: LeadRow) => void;
  /** Called after a drop or a "Move to" pick; LOST is routed to a reason dialog by the parent. */
  onMove: (lead: LeadRow, stage: LeadStage) => void;
  loading?: boolean;
}

const DRAG_THRESHOLD = 6;

interface DragState {
  lead: LeadRow;
  from: LeadStage;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
}

const STAGE_ACCENT: Readonly<Record<LeadStage, string>> = {
  NEW: "border-t-info",
  CONTACTED: "border-t-navy-400",
  SITE_VISIT_SCHEDULED: "border-t-status-hold",
  SITE_VISIT_DONE: "border-t-navy-700",
  NEGOTIATION: "border-t-gold",
  CONVERTED: "border-t-success",
  LOST: "border-t-danger",
};

/** Kanban board with pointer-event drag-and-drop between stage columns (no external DnD library). */
export function LeadKanban({ columns, canWrite, onOpen, onMove, loading = false }: LeadKanbanProps) {
  const columnRefs = useRef(new Map<LeadStage, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<LeadStage | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, { count: number; leads: LeadRow[] }>();
    for (const stage of LEAD_STAGES) map.set(stage, { count: 0, leads: [] });
    for (const column of columns) map.set(column.stage, { count: column.count, leads: column.leads });
    return map;
  }, [columns]);

  const stageAt = useCallback((x: number, y: number): LeadStage | null => {
    for (const [stage, node] of columnRefs.current) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return stage;
    }
    return null;
  }, []);

  const onPointerDown = (lead: LeadRow, from: LeadStage) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!canWrite || from === "CONVERTED") return;
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a,button,[role=menuitem],[data-no-drag]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      lead,
      from,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const active = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD;
    setDrag({ ...drag, x: event.clientX, y: event.clientY, active });
    if (active) setHover(stageAt(event.clientX, event.clientY));
  };

  const finish = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    setDrag(null);
    setHover(null);
    if (cancelled) return;
    if (!current.active) {
      onOpen(current.lead);
      return;
    }
    const target = stageAt(event.clientX, event.clientY);
    if (target && target !== current.from && target !== "CONVERTED") onMove(current.lead, target);
  };

  useEffect(() => {
    if (!drag?.active) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [drag?.active]);

  return (
    <div className={cn("relative", loading && "opacity-70 transition-opacity")} data-testid="lead-kanban">
      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin" style={{ scrollSnapType: "x proximity" }}>
        {LEAD_STAGES.map((stage) => {
          const column = byStage.get(stage) ?? { count: 0, leads: [] };
          const readOnly = stage === "CONVERTED";
          const isTarget = hover === stage && drag?.active && stage !== drag.from && !readOnly;
          return (
            <div
              key={stage}
              ref={(node) => {
                if (node) columnRefs.current.set(stage, node);
                else columnRefs.current.delete(stage);
              }}
              role="region"
              aria-label={`${LEAD_STAGE_LABELS[stage]} (${column.count})`}
              className={cn(
                "flex w-[17rem] shrink-0 flex-col rounded-lg border border-border border-t-4 bg-surface/70",
                STAGE_ACCENT[stage],
                isTarget && "ring-2 ring-gold bg-gold-light/40",
                readOnly && drag?.active && "opacity-60",
              )}
              style={{ scrollSnapAlign: "start" }}
              data-testid={`kanban-column-${stage}`}
            >
              <header className="flex items-center justify-between gap-2 px-3 py-2">
                <h3 className="truncate text-xs font-bold uppercase tracking-wide text-navy-950">
                  {LEAD_STAGE_LABELS[stage]}
                </h3>
                <span className="money rounded-full bg-card px-2 text-2xs font-semibold text-ink-muted shadow-card">
                  {column.count}
                </span>
              </header>
              <div className="flex max-h-[calc(100dvh-22rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-thin">
                {column.leads.length === 0 && (
                  <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-2xs text-ink-subtle">
                    {readOnly ? "No conversions yet" : "Drop leads here"}
                  </p>
                )}
                {column.leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    stage={stage}
                    draggable={canWrite && !readOnly}
                    dragging={drag?.active === true && drag.lead.id === lead.id}
                    onPointerDown={onPointerDown(lead, stage)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => finish(event, false)}
                    onPointerCancel={(event) => finish(event, true)}
                    onOpen={() => onOpen(lead)}
                    onMove={canWrite ? (target) => onMove(lead, target) : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {drag?.active && (
        <div
          className="pointer-events-none fixed z-[70] w-60 -translate-x-1/2 -translate-y-1/2 rotate-1 rounded-md border border-gold bg-card p-2 text-sm shadow-pop"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <p className="truncate font-semibold text-navy-950">{drag.lead.full_name}</p>
          <p className="money text-2xs text-ink-subtle">{formatPhone(drag.lead.phone)}</p>
        </div>
      )}
    </div>
  );
}

interface LeadCardProps {
  lead: LeadRow;
  stage: LeadStage;
  draggable: boolean;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onMove: ((stage: LeadStage) => void) | undefined;
}

function LeadCard({
  lead,
  stage,
  draggable,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onOpen,
  onMove,
}: LeadCardProps) {
  const now = useNow();
  const overdue =
    lead.next_follow_up_at !== null &&
    Date.parse(lead.next_follow_up_at) < now &&
    stage !== "CONVERTED" &&
    stage !== "LOST";
  const budget = budgetLabel(lead);
  return (
    <article
      aria-label={`${lead.full_name}, ${LEAD_STAGE_LABELS[stage]}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "group rounded-md border border-border bg-card p-2.5 text-left shadow-card transition-shadow hover:shadow-pop focus-within:ring-2 focus-within:ring-gold",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging && "opacity-40",
      )}
      style={{ touchAction: "pan-y" }}
      data-testid={`lead-card-${lead.id}`}
    >
      <div className="flex items-start gap-1.5">
        {draggable && (
          <GripVertical
            className="mt-0.5 size-3.5 shrink-0 text-ink-subtle/60 group-hover:text-ink-subtle"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          {/* the name is the card's button (keyboard + click); the rest of the card opens on a pointer tap and drags between columns */}
          <button
            type="button"
            className="block max-w-full truncate rounded-xs text-left text-sm font-semibold text-navy-950 outline-none focus-visible:underline"
            onClick={onOpen}
            data-no-drag
            data-testid={`lead-card-open-${lead.id}`}
          >
            {lead.full_name}
          </button>
          <p className="money truncate text-2xs text-ink-subtle">
            <Phone className="mr-0.5 inline size-3" aria-hidden="true" />
            {formatPhone(lead.phone)} · {lead.lead_number}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label={`Actions for ${lead.full_name}`} size="xs" data-no-drag />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            {onMove && stage !== "CONVERTED" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuLabel>Stage</DropdownMenuLabel>
                    {LEAD_STAGES.filter((target) => target !== stage && target !== "CONVERTED").map((target) => (
                      <DropdownMenuItem key={target} destructive={target === "LOST"} onSelect={() => onMove(target)}>
                        {LEAD_STAGE_LABELS[target]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-2xs text-ink-muted">
        {lead.project_name && <Badge variant="outline">{lead.project_name}</Badge>}
        {lead.flat_type_name && <Badge variant="neutral">{lead.flat_type_name}</Badge>}
        {budget && <span className="money">{budget}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-2xs text-ink-subtle">
        <span className="inline-flex min-w-0 items-center gap-1">
          <UserRound className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{lead.assigned_user_name ?? "Unassigned"}</span>
        </span>
        <Tooltip
          content={
            lead.next_follow_up_at
              ? `Follow-up ${formatRelative(lead.next_follow_up_at)}`
              : `Source: ${LEAD_SOURCE_LABELS[lead.source]}`
          }
        >
          <span
            className={cn("money inline-flex shrink-0 items-center gap-1", overdue && "font-semibold text-danger-fg")}
          >
            <CalendarClock className="size-3" aria-hidden="true" />
            {lead.next_follow_up_at ? formatRelative(lead.next_follow_up_at) : LEAD_SOURCE_LABELS[lead.source]}
          </span>
        </Tooltip>
      </div>
    </article>
  );
}
