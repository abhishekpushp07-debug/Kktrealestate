import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  PricePreviewQuerySchema,
  PricePreviewResponseSchema,
  RateCardActivateSchema,
  RateCardApplyResponseSchema,
  RateCardApplySchema,
  RateCardCreateSchema,
  RateCardFilterSchema,
  RateCardListResponseSchema,
  RateCardPreviewRequestSchema,
  RateCardPreviewResponseSchema,
  RateCardRowSchema,
  RateCardUpdateSchema,
  type PlcRule,
  type RateCardApplyResponse,
  type RateCardRate,
  type RateCardRow,
} from "@kkt/contracts";
import {
  blocks,
  flatTypes,
  plcTypes,
  projects,
  rateCardPlcRules,
  rateCardRates,
  rateCards,
  type Executor,
} from "@kkt/db";
import type { AuditEntry } from "../../lib/audit.js";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../lib/scope.js";
import { applyUpdate, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { assertFilterScope } from "./projects.js";
import {
  flatTypeToDomain,
  loadActiveRateCard,
  loadBlock,
  loadFlat,
  loadProject,
  loadRateCardDomain,
  meta,
  patchBody,
  priceWith,
  repriceFlats,
  writeAuditMany,
  type DbRateCard,
  type LoadedRateCard,
  type RepriceChange,
} from "./service.js";

const idParams = z.object({ id: IdSchema });

/** Hydrates rate card rows with their rates (flat type code/name) and PLC rules (type name) in two batch queries. */
export async function toRateCardRows(db: Executor, rows: readonly DbRateCard[]): Promise<RateCardRow[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [rates, rules] = await Promise.all([
    db
      .select({ r: rateCardRates, code: flatTypes.code, name: flatTypes.name })
      .from(rateCardRates)
      .innerJoin(flatTypes, eq(flatTypes.id, rateCardRates.flatTypeId))
      .where(inArray(rateCardRates.rateCardId, ids))
      .orderBy(asc(flatTypes.code)),
    db
      .select({ r: rateCardPlcRules, name: plcTypes.name })
      .from(rateCardPlcRules)
      .innerJoin(plcTypes, eq(plcTypes.id, rateCardPlcRules.plcTypeId))
      .where(inArray(rateCardPlcRules.rateCardId, ids))
      .orderBy(asc(rateCardPlcRules.sortOrder), asc(rateCardPlcRules.createdAt)),
  ]);
  const ratesByCard = new Map<string, RateCardRow["rates"]>();
  for (const { r, code, name } of rates)
    ratesByCard.set(r.rateCardId, [
      ...(ratesByCard.get(r.rateCardId) ?? []),
      {
        flat_type_id: r.flatTypeId,
        flat_type_code: code,
        flat_type_name: name,
        rate_per_sqft_paise: r.ratePerSqftPaise,
        lump_sum_paise: r.lumpSumPaise,
      },
    ]);
  const rulesByCard = new Map<string, RateCardRow["plc_rules"]>();
  for (const { r, name } of rules)
    rulesByCard.set(r.rateCardId, [
      ...(rulesByCard.get(r.rateCardId) ?? []),
      {
        plc_type_id: r.plcTypeId,
        plc_type_name: name,
        calc_mode: r.calcMode,
        value: Number(r.value),
        applies_to: r.appliesTo,
        floors_gte: r.floorsGte,
        facings: r.facings.length > 0 ? r.facings : null,
        sort_order: r.sortOrder,
      },
    ]);
  return rows.map((c) => ({
    id: c.id,
    company_id: c.companyId,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    created_by: c.createdBy,
    version: c.version,
    project_id: c.projectId,
    name: c.name,
    effective_from: c.effectiveFrom,
    status: c.status,
    activated_at: c.activatedAt ? c.activatedAt.toISOString() : null,
    superseded_at: c.supersededAt ? c.supersededAt.toISOString() : null,
    rates: ratesByCard.get(c.id) ?? [],
    plc_rules: rulesByCard.get(c.id) ?? [],
  }));
}

/** Loads a rate card the user may see (scope through its project); 404 otherwise. */
export async function loadRateCard(
  db: Executor,
  user: StaffContext,
  id: string,
  forUpdate = false,
): Promise<DbRateCard> {
  const q = db
    .select()
    .from(rateCards)
    .where(and(eq(rateCards.id, id), eq(rateCards.companyId, user.companyId)))
    .limit(1)
    .$dynamic();
  const [row] = await (forUpdate ? q.for("update") : q);
  if (!row) throw ApiError.notFound("Rate card");
  ensureProjectAccess(user, row.projectId, "Rate card");
  return row;
}

async function viewOne(db: Executor, row: DbRateCard): Promise<RateCardRow> {
  const [v] = await toRateCardRows(db, [row]);
  if (!v) throw ApiError.notFound("Rate card");
  return v;
}

/** 400 when a flat type / PLC type is unknown to the company; 422 when inactive. */
async function assertRatesAndRules(
  tx: Executor,
  companyId: string,
  rates: readonly RateCardRate[] | undefined,
  rules: readonly PlcRule[] | undefined,
): Promise<void> {
  if (rates) {
    const ids = [...new Set(rates.map((r) => r.flat_type_id))];
    if (ids.length !== rates.length) throw ApiError.badRequest("Each flat type once", { field: "rates" });
    const found = await tx
      .select({ id: flatTypes.id, isActive: flatTypes.isActive, name: flatTypes.name })
      .from(flatTypes)
      .where(and(eq(flatTypes.companyId, companyId), inArray(flatTypes.id, ids)));
    if (found.length !== ids.length) throw ApiError.badRequest("Unknown flat type id in rates", { field: "rates" });
    const inactive = found.find((f) => !f.isActive);
    if (inactive)
      throw ApiError.rule(`Flat type ${inactive.name} is inactive`, "FLAT_TYPE_INACTIVE", {
        flat_type_id: inactive.id,
      });
  }
  if (rules && rules.length > 0) {
    const ids = [...new Set(rules.map((r) => r.plc_type_id))];
    const found = await tx
      .select({ id: plcTypes.id, isActive: plcTypes.isActive, name: plcTypes.name })
      .from(plcTypes)
      .where(and(eq(plcTypes.companyId, companyId), inArray(plcTypes.id, ids)));
    if (found.length !== ids.length)
      throw ApiError.badRequest("Unknown PLC type id in plc_rules", { field: "plc_rules" });
    const inactive = found.find((f) => !f.isActive);
    if (inactive)
      throw ApiError.rule(`PLC type ${inactive.name} is inactive`, "PLC_TYPE_INACTIVE", { plc_type_id: inactive.id });
  }
}

/** Replaces the rates and/or PLC rules of a card (child rows carry no version). */
async function replaceChildren(
  tx: Executor,
  cardId: string,
  rates: readonly RateCardRate[] | undefined,
  rules: readonly PlcRule[] | undefined,
): Promise<void> {
  if (rates) {
    await tx.delete(rateCardRates).where(eq(rateCardRates.rateCardId, cardId));
    if (rates.length > 0)
      await tx.insert(rateCardRates).values(
        rates.map((r) => ({
          rateCardId: cardId,
          flatTypeId: r.flat_type_id,
          ratePerSqftPaise: r.rate_per_sqft_paise ?? null,
          lumpSumPaise: r.lump_sum_paise ?? null,
        })),
      );
  }
  if (rules) {
    await tx.delete(rateCardPlcRules).where(eq(rateCardPlcRules.rateCardId, cardId));
    if (rules.length > 0) {
      await tx.insert(rateCardPlcRules).values(
        rules.map((r, i) => ({
          rateCardId: cardId,
          plcTypeId: r.plc_type_id,
          calcMode: r.calc_mode,
          value: r.value,
          appliesTo: r.applies_to,
          floorsGte: r.applies_to === "FLOORS_GTE" ? (r.floors_gte ?? null) : null,
          facings: r.applies_to === "FACING_IN" ? (r.facings ?? []) : [],
          sortOrder: r.sort_order ?? i,
        })),
      );
    }
  }
}

/** Audit rows for a re-pricing: one per flat (its price history) plus the caller's summary row. */
function repriceAudits(
  req: FastifyRequest,
  companyId: string,
  changes: readonly RepriceChange[],
  action: string,
): AuditEntry[] {
  return changes.map((c) => ({
    companyId,
    ...meta(req),
    action,
    entityType: "flat",
    entityId: c.id,
    before: c.before,
    after: { ...c.after, flat_number: c.flatNumber },
  }));
}

/** Re-prices Available flats with a card and writes the audit rows; returns the apply response. */
async function applyCard(
  tx: Executor,
  req: FastifyRequest,
  user: StaffContext,
  card: LoadedRateCard,
  projectId: string,
  blockId: string | undefined,
  dryRun: boolean,
): Promise<RateCardApplyResponse> {
  const result = await repriceFlats(tx, user.companyId, card, { projectId, blockId }, dryRun);
  if (!dryRun) await writeAuditMany(tx, repriceAudits(req, user.companyId, result.changes, "flat.price"));
  return {
    rate_card_id: card.id,
    dry_run: dryRun,
    repriced: result.repriced,
    skipped_not_available: result.skipped_not_available,
    skipped_no_rate: result.skipped_no_rate,
  };
}

const ActivateResponseSchema = RateCardRowSchema.extend({ applied: RateCardApplyResponseSchema.nullable() });
const CSV = ["name", "project_id", "effective_from", "status", "activated_at", "superseded_at", "version"];

/** Rate card routes (SPEC §5): list/create/get/patch (Draft), activate (supersedes), apply (Available flats only), preview. */
export function registerRateCardRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/rate-cards",
    permission: "project.read",
    schema: {
      querystring: RateCardFilterSchema,
      response: { 200: RateCardListResponseSchema },
      summary: "List rate cards (by project; history kept)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      assertFilterScope(user, q.project_id);
      const where: (SQL | undefined)[] = [
        eq(rateCards.companyId, user.companyId),
        scopeFilter(user, rateCards.projectId),
      ];
      if (q.project_id) where.push(eq(rateCards.projectId, q.project_id));
      if (q.status) where.push(eq(rateCards.status, q.status));
      const result = await paginate<DbRateCard>(app.dbReplica, {
        table: rateCards,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [rateCards.name], term: q.search },
        sort: {
          allowed: {
            name: rateCards.name,
            effective_from: rateCards.effectiveFrom,
            status: rateCards.status,
            created_at: rateCards.createdAt,
          },
          default: "-effective_from",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items = await toRateCardRows(app.dbReplica, result.items);
      if (q.format === "csv")
        return sendCsv(
          reply,
          "rate-cards.csv",
          CSV.map((k) => ({ key: k, header: k })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/rate-cards",
    permission: "rate_card.write",
    idempotent: true,
    schema: {
      body: RateCardCreateSchema,
      response: { 201: RateCardRowSchema },
      summary: "Create a Draft rate card with rates and PLC rules",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const body = req.body;
      const row = await app.db.transaction(async (tx) => {
        const project = await loadProject(tx, user, body.project_id);
        if (!project.isActive) throw ApiError.rule("Project is inactive", "PROJECT_INACTIVE");
        await assertRatesAndRules(tx, user.companyId, body.rates, body.plc_rules);
        let created: DbRateCard | undefined;
        try {
          [created] = await tx
            .insert(rateCards)
            .values({
              companyId: user.companyId,
              projectId: project.id,
              name: body.name,
              effectiveFrom: body.effective_from,
              status: "DRAFT",
              createdBy: user.id,
            })
            .returning();
        } catch (e) {
          translatePgError(e, "A rate card");
        }
        if (!created) throw new Error("insert returned no row");
        await replaceChildren(tx, created.id, body.rates, body.plc_rules);
        const view = await viewOne(tx, created);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "rate_card.create",
          entityType: "rate_card",
          entityId: created.id,
          after: view as unknown as Record<string, unknown>,
        });
        return view;
      });
      return reply.code(201).send(row);
    },
  });

  route(app, {
    method: "POST",
    url: "/rate-cards/preview",
    permission: "project.read",
    schema: {
      body: RateCardPreviewRequestSchema,
      response: { 200: RateCardPreviewResponseSchema },
      summary:
        "Price breakup for an existing flat or a hypothetical flat (type + floor + facing + corner) against a rate card or the Active one",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const db = app.dbReplica;
      const project = await loadProject(db, user, body.project_id);
      let card: LoadedRateCard | null;
      let cardName: string | null = null;
      if (body.rate_card_id) {
        const rc = await loadRateCard(db, user, body.rate_card_id);
        if (rc.projectId !== project.id)
          throw ApiError.badRequest("rate_card_id belongs to another project", { field: "rate_card_id" });
        card = await loadRateCardDomain(db, rc.id);
        cardName = rc.name;
      } else {
        card = await loadActiveRateCard(db, project.id);
        if (card)
          cardName =
            (await db.select({ name: rateCards.name }).from(rateCards).where(eq(rateCards.id, card.id)).limit(1))[0]
              ?.name ?? null;
      }
      let flatId: string | null = null;
      let flatTypeId: string;
      let floor: number;
      let floorStart: number;
      let facing: string | null;
      let isCorner: boolean;
      let superBuiltupSqft: number | null = null;
      if (body.flat_id) {
        const flat = await loadFlat(db, user, body.flat_id);
        if (flat.projectId !== project.id)
          throw ApiError.badRequest("flat_id belongs to another project", { field: "flat_id" });
        const [block] = await db
          .select({ floorStart: blocks.floorStart })
          .from(blocks)
          .where(eq(blocks.id, flat.blockId))
          .limit(1);
        flatId = flat.id;
        flatTypeId = flat.flatTypeId;
        floor = flat.floor;
        floorStart = block?.floorStart ?? 1;
        facing = flat.facing;
        isCorner = flat.isCorner;
        superBuiltupSqft = Number(flat.superBuiltupSqft);
      } else {
        flatTypeId = body.flat_type_id!;
        floor = body.floor!;
        floorStart = body.floor_start ?? 1;
        facing = body.facing ?? null;
        isCorner = body.is_corner ?? false;
      }
      const [ft] = await db
        .select()
        .from(flatTypes)
        .where(and(eq(flatTypes.id, flatTypeId), eq(flatTypes.companyId, user.companyId)))
        .limit(1);
      if (!ft) throw ApiError.badRequest("flat_type_id does not exist", { field: "flat_type_id" });
      const domain = flatTypeToDomain(ft);
      const sqft = superBuiltupSqft ?? domain.superBuiltupSqft;
      const resolvedFacing = facing ?? domain.facing ?? null;
      const { price, rateCardId } = priceWith(
        card,
        { floor, floorStart, superBuiltupSqft: sqft, isCorner, facing: resolvedFacing, flatTypeId: ft.id },
        { ...domain, superBuiltupSqft: sqft },
      );
      return {
        project_id: project.id,
        flat_id: flatId,
        flat_type_id: ft.id,
        flat_type_code: ft.code,
        floor,
        facing: resolvedFacing,
        is_corner: isCorner,
        super_builtup_sqft: sqft,
        rate_card_id: rateCardId,
        rate_card_name: rateCardId ? cardName : null,
        base_paise: price.breakup[0]?.amountPaise ?? 0,
        rate_per_sqft_paise: price.ratePerSqftPaise,
        breakup: price.breakup.map((l) => ({ label: l.label, amount_paise: l.amountPaise })),
        total_paise: price.totalPaise,
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/rate-cards/preview",
    permission: "project.read",
    schema: {
      querystring: PricePreviewQuerySchema,
      response: { 200: PricePreviewResponseSchema },
      summary: "Price preview of one flat against a rate card (or the Active one)",
    },
    handler: async (req) => {
      const user = req.user!;
      const db = app.dbReplica;
      const flat = await loadFlat(db, user, req.query.flat_id);
      let card: LoadedRateCard | null;
      if (req.query.rate_card_id) {
        const rc = await loadRateCard(db, user, req.query.rate_card_id);
        if (rc.projectId !== flat.projectId)
          throw ApiError.badRequest("rate_card_id belongs to another project", { field: "rate_card_id" });
        card = await loadRateCardDomain(db, rc.id);
      } else card = await loadActiveRateCard(db, flat.projectId);
      const [[block], [ft]] = await Promise.all([
        db.select({ floorStart: blocks.floorStart }).from(blocks).where(eq(blocks.id, flat.blockId)).limit(1),
        db.select().from(flatTypes).where(eq(flatTypes.id, flat.flatTypeId)).limit(1),
      ]);
      if (!ft) throw ApiError.notFound("Flat type");
      const domain = flatTypeToDomain(ft);
      const sqft = Number(flat.superBuiltupSqft);
      const { price, rateCardId } = priceWith(
        card,
        {
          floor: flat.floor,
          floorStart: block?.floorStart ?? 1,
          superBuiltupSqft: sqft,
          isCorner: flat.isCorner,
          facing: flat.facing,
          flatTypeId: ft.id,
        },
        { ...domain, superBuiltupSqft: sqft },
      );
      return {
        flat_id: flat.id,
        rate_card_id: rateCardId,
        base_paise: price.breakup[0]?.amountPaise ?? 0,
        breakup: price.breakup.map((l) => ({ label: l.label, amount_paise: l.amountPaise })),
        total_paise: price.totalPaise,
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/rate-cards/:id",
    permission: "project.read",
    schema: { params: idParams, response: { 200: RateCardRowSchema }, summary: "Get a rate card" },
    handler: async (req) => viewOne(app.dbReplica, await loadRateCard(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "PATCH",
    url: "/rate-cards/:id",
    permission: "rate_card.write",
    schema: {
      params: idParams,
      body: patchBody(RateCardUpdateSchema),
      response: { 200: RateCardRowSchema },
      summary: "Update a Draft rate card (name, effective date, rates, PLC rules)",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as {
        version?: number;
        name?: string;
        effective_from?: string;
        rates?: RateCardRate[];
        plc_rules?: PlcRule[];
      };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadRateCard(tx, user, req.params.id, true);
        if (existing.status !== "DRAFT")
          throw ApiError.rule(
            `Rate card ${existing.name} is ${existing.status}; only Draft cards can be edited (create a new card instead)`,
            "RATE_CARD_NOT_DRAFT",
            { status: existing.status },
          );
        const before = await viewOne(tx, existing);
        await assertRatesAndRules(tx, user.companyId, body.rates, body.plc_rules);
        const changes: Record<string, unknown> = {};
        if (body.name !== undefined) changes["name"] = body.name;
        if (body.effective_from !== undefined) changes["effectiveFrom"] = body.effective_from;
        const updated = await applyUpdate(tx, rateCards, existing.id, version, changes, "rate_card");
        await replaceChildren(tx, existing.id, body.rates, body.plc_rules);
        const after = await viewOne(tx, updated);
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "rate_card.update",
          entityType: "rate_card",
          entityId: existing.id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/rate-cards/:id/activate",
    permission: "rate_card.write",
    schema: {
      params: idParams,
      body: withOptionalVersion(RateCardActivateSchema),
      response: { 200: ActivateResponseSchema },
      summary:
        "Activate a Draft card: supersedes the project's current Active card in the same transaction and (by default) re-prices Available flats",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body as { version?: number; apply_to_available_flats: boolean };
      const version = expectedVersion(req, body);
      return app.db.transaction(async (tx) => {
        const existing = await loadRateCard(tx, user, req.params.id, true);
        // Serialise activations per project (the partial unique index is the last line of defence).
        await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, existing.projectId)).for("update");
        if (existing.status === "ACTIVE")
          throw ApiError.rule(`Rate card ${existing.name} is already Active`, "RATE_CARD_ALREADY_ACTIVE");
        if (existing.status === "SUPERSEDED")
          throw ApiError.rule(
            `Rate card ${existing.name} was superseded; create a new Draft instead`,
            "RATE_CARD_SUPERSEDED",
          );
        const [rateCount] = await tx
          .select({ n: rateCardRates.id })
          .from(rateCardRates)
          .where(eq(rateCardRates.rateCardId, existing.id))
          .limit(1);
        if (!rateCount) throw ApiError.rule("A rate card needs at least one rate before activation", "RATE_CARD_EMPTY");
        const now = new Date();
        const current = await tx
          .select()
          .from(rateCards)
          .where(and(eq(rateCards.projectId, existing.projectId), eq(rateCards.status, "ACTIVE")))
          .for("update");
        for (const c of current) {
          const superseded = await applyUpdate(
            tx,
            rateCards,
            c.id,
            c.version,
            { status: "SUPERSEDED", supersededAt: now },
            "rate_card",
          );
          await writeAudit(tx, {
            companyId: user.companyId,
            ...meta(req),
            action: "rate_card.supersede",
            entityType: "rate_card",
            entityId: c.id,
            before: { status: c.status },
            after: {
              status: superseded.status,
              superseded_at: now.toISOString(),
              superseded_by_rate_card_id: existing.id,
            },
          });
        }
        let updated: DbRateCard;
        try {
          updated = await applyUpdate(
            tx,
            rateCards,
            existing.id,
            version,
            { status: "ACTIVE", activatedAt: now, supersededAt: null },
            "rate_card",
          );
        } catch (e) {
          translatePgError(e, "An active rate card for this project");
        }
        let applied: RateCardApplyResponse | null = null;
        if (body.apply_to_available_flats) {
          const loaded = await loadRateCardDomain(tx, updated.id);
          if (loaded) applied = await applyCard(tx, req, user, loaded, updated.projectId, undefined, false);
        }
        await writeAudit(tx, {
          companyId: user.companyId,
          ...meta(req),
          action: "rate_card.activate",
          entityType: "rate_card",
          entityId: existing.id,
          before: { status: existing.status },
          after: {
            status: updated.status,
            activated_at: now.toISOString(),
            superseded_rate_card_ids: current.map((c) => c.id),
            applied,
          },
        });
        return { ...(await viewOne(tx, updated)), applied };
      });
    },
  });

  route(app, {
    method: "POST",
    url: "/rate-cards/:id/apply",
    permission: "rate_card.write",
    schema: {
      params: idParams,
      body: RateCardApplySchema,
      response: { 200: RateCardApplyResponseSchema },
      summary:
        "Apply the Active card: re-prices ONLY Available flats (Hold/Booked/Sold keep their price); dry_run counts without writing",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      return app.db.transaction(async (tx) => {
        const card = await loadRateCard(tx, user, req.params.id);
        if (card.status !== "ACTIVE")
          throw ApiError.rule(
            `Rate card ${card.name} is ${card.status}; only the Active card can be applied`,
            "RATE_CARD_NOT_ACTIVE",
            { status: card.status },
          );
        if (body.block_id) {
          const block = await loadBlock(tx, user, body.block_id);
          if (block.projectId !== card.projectId)
            throw ApiError.badRequest("block_id belongs to another project", { field: "block_id" });
        }
        const loaded = await loadRateCardDomain(tx, card.id);
        if (!loaded) throw ApiError.notFound("Rate card");
        const result = await applyCard(tx, req, user, loaded, card.projectId, body.block_id, body.dry_run);
        if (!body.dry_run)
          await writeAudit(tx, {
            companyId: user.companyId,
            ...meta(req),
            action: "rate_card.apply",
            entityType: "rate_card",
            entityId: card.id,
            after: { ...result, block_id: body.block_id ?? null },
          });
        return result;
      });
    },
  });
}
