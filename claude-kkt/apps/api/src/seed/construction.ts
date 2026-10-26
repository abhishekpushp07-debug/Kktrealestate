/** Step 5 — tower construction status (jump-ahead with intermediate dates) and two navy/gold photos per completed stage. */
import { placeholderPng, type SeedContext } from "./context.js";
import { STAGES, type StageName } from "./masters.js";

interface StageRow {
  id: string;
  stage_id: string;
  name: string;
  status: string;
  completed_on: string | null;
  photos: unknown[];
}
interface Construction {
  version: number;
  stages: StageRow[];
  construction_percent: number;
}

export async function construction(ctx: SeedContext, blockId: string): Promise<Construction> {
  return ctx.get<Construction>(`/api/v1/blocks/${blockId}/construction`);
}

/**
 * Marks `target` COMPLETED on `completedOn` (plus every still-pending earlier stage on the given intermediate dates), through
 * POST /blocks/:id/construction/status — the same call the ERP makes, so the dues engine raises exactly the implied demands.
 */
export async function completeStage(
  ctx: SeedContext,
  blockId: string,
  target: StageName,
  completedOn: string,
  intermediate: Partial<Record<StageName, string>> = {},
  notes?: string,
): Promise<{ demands_raised: number; demand_numbers: string[] }> {
  const c = await construction(ctx, blockId);
  const intermediate_dates: Record<string, string> = {};
  for (const [name, date] of Object.entries(intermediate)) if (date) intermediate_dates[ctx.stages[name]!] = date;
  const r = await ctx.post<{ demands_raised: number; demand_numbers: string[] }>(
    `/api/v1/blocks/${blockId}/construction/status`,
    {
      version: c.version,
      stage_id: ctx.stages[target]!,
      completed_on: completedOn,
      intermediate_dates,
      notes: notes ?? null,
      notify_buyers: true,
    },
  );
  return r;
}

/** Dates for a jump: every stage up to (excluding) `target` gets an evenly spaced date between `firstDaysAgo` and `lastDaysAgo`. */
export function stageDates(
  ctx: SeedContext,
  target: StageName,
  firstDaysAgo: number,
  lastDaysAgo: number,
): { completedOn: string; intermediate: Partial<Record<StageName, string>> } {
  const idx = STAGES.indexOf(target);
  const intermediate: Partial<Record<StageName, string>> = {};
  for (let i = 0; i < idx; i++) {
    const daysAgo = idx === 0 ? firstDaysAgo : Math.round(firstDaysAgo - ((firstDaysAgo - lastDaysAgo) * i) / idx);
    intermediate[STAGES[i]!] = ctx.D(daysAgo);
  }
  return { completedOn: ctx.D(lastDaysAgo), intermediate };
}

/** Uploads two captioned photos for every COMPLETED stage of a block that has none yet (visible to buyers + shown on website). */
export async function addStagePhotos(ctx: SeedContext, project: string, blockCode: string): Promise<number> {
  const p = ctx.project(project);
  const block = p.blocks[blockCode]!;
  const c = await construction(ctx, block.id);
  let added = 0;
  for (const stage of c.stages) {
    if (stage.status !== "COMPLETED" || stage.photos.length > 0) continue;
    for (const n of [1, 2]) {
      const caption = `${block.name.split(" – ")[0]} · ${stage.name}`;
      const png = await placeholderPng(
        `${stage.name} ${n === 1 ? "– site view" : "– progress"}`,
        `${p.name} · ${block.name} · completed ${stage.completed_on ?? ""}`,
      );
      const documentId = await ctx.uploadDocument(
        { entity_type: "STAGE", entity_id: stage.id, title: `${caption} (${n}/2)` },
        {
          name: `${p.code.toLowerCase()}-${blockCode.toLowerCase()}-${stage.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}.png`,
          data: png,
          type: "image/png",
        },
      );
      await ctx.post(`/api/v1/blocks/${block.id}/construction/${stage.stage_id}/photos`, {
        document_id: documentId,
        caption: `${caption} (${n}/2)`,
        visible_to_buyers: true,
        show_on_website: true,
        sort_order: n,
      });
      added += 1;
    }
  }
  return added;
}

export async function seedConstruction(ctx: SeedContext): Promise<void> {
  ctx.log(
    "construction: Tower A through 3rd Slab, Tower B through Foundation, Tower C Excavation, GGV Q through Plastering (block P is driven by the worked example)",
  );
  const sgh = ctx.project("SGH");
  const ggv = ctx.project("GGV");
  // Tower A: one jump to 3rd Slab with intermediate dates (D-140 … D-55)
  const a = stageDates(ctx, "3rd Slab", 140, 55);
  await completeStage(
    ctx,
    sgh.blocks["A"]!.id,
    "3rd Slab",
    a.completedOn,
    a.intermediate,
    "Third slab cast on schedule",
  );
  // Tower B: two single steps
  await completeStage(ctx, sgh.blocks["B"]!.id, "Excavation", ctx.D(60), {}, "Excavation complete; dewatering done");
  await completeStage(ctx, sgh.blocks["B"]!.id, "Foundation", ctx.D(30), {}, "Raft foundation cast");
  // Tower C: excavation only
  await completeStage(ctx, sgh.blocks["C"]!.id, "Excavation", ctx.D(25), {}, "Excavation complete");
  // GGV Q: jump to Plastering (D-150 … D-60)
  const q = stageDates(ctx, "Plastering", 150, 60);
  await completeStage(
    ctx,
    ggv.blocks["Q"]!.id,
    "Plastering",
    q.completedOn,
    q.intermediate,
    "Internal plastering complete",
  );
  for (const [proj, code] of [
    ["SGH", "A"],
    ["SGH", "B"],
    ["SGH", "C"],
    ["GGV", "Q"],
  ] as const)
    ctx.counts["stage_photos"] = (ctx.counts["stage_photos"] ?? 0) + (await addStagePhotos(ctx, proj, code));
}
