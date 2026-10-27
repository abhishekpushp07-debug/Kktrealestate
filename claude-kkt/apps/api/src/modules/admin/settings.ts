/**
 * Company settings (SPEC §2 numbering prefixes, §13 SLA hours, §12 hold hours; settings jsonb) with a preview of the next document
 * number per scope for the current financial year. PATCH is versioned (body.version or If-Match), audited and drops the company cache.
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  CompanyNumberingSchema,
  CompanySettingsPatchSchema,
  CompanySettingsResponseSchema,
  CompanySettingsValuesSchema,
  type AdminNumberingPreview,
  type CompanySettingsPatch,
  type CompanySettingsResponse,
} from "@kkt/contracts";
import { companies, documents, sequences, type CompanySettings, type Executor, type Numbering } from "@kkt/db";
import { DEFAULT_NUMBER_PATTERN, financialYear, formatNumber, todayIST } from "@kkt/domain";
import { config } from "../../config.js";
import { writeAudit } from "../../lib/audit.js";
import { invalidateCompany } from "../../lib/company.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { applyUpdate, expectedVersion, withOptionalVersion } from "../../lib/version.js";
import { adminMeta, staff } from "./common.js";

type CompanyRow = typeof companies.$inferSelect;

/** Numbering scopes in display order with the prefix used when the company has not configured one (mirrors lib/numbering). */
const SCOPES: readonly { scope: keyof Numbering; fallback: string }[] = [
  { scope: "customer", fallback: "CUST-" },
  { scope: "booking", fallback: "BK-" },
  { scope: "demand", fallback: "DM-" },
  { scope: "receipt", fallback: "RCPT/" },
  { scope: "ticket", fallback: "SR-" },
  { scope: "visit", fallback: "SV-" },
];

/**
 * Next number per scope for the financial year of `businessDate` (default: today in IST), e.g. CUST-2526/0001.
 * Reads the sequences table without consuming a number; other modules (ERP forms) may call it to show "next booking number".
 */
export async function numberingPreview(
  db: Executor,
  company: Pick<CompanyRow, "id" | "fyStartMonth" | "numbering">,
  businessDate: string = todayIST(),
): Promise<AdminNumberingPreview[]> {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const rows = await db
    .select({ scope: sequences.scope, value: sequences.value })
    .from(sequences)
    .where(and(eq(sequences.companyId, company.id), eq(sequences.fy, fy.label)));
  const current = new Map(rows.map((r) => [r.scope, Number(r.value)]));
  return SCOPES.map(({ scope, fallback }) => {
    const cfg = company.numbering[scope] ?? { prefix: fallback };
    const last = current.get(scope) ?? 0;
    return {
      scope,
      fy: fy.label,
      last_sequence: last,
      next_number: formatNumber(cfg.prefix || fallback, fy.label, last + 1, cfg.format ?? DEFAULT_NUMBER_PATTERN),
    };
  });
}

/** Public URL of the company logo (served as CMS media), or null. */
function logoUrl(logoDocumentId: string | null): string | null {
  return logoDocumentId ? `${config.API_PUBLIC_URL}/api/v1/public/media/${logoDocumentId}` : null;
}

/** Wire shape of the company settings. */
export function toSettingsResponse(c: CompanyRow, preview: AdminNumberingPreview[]): CompanySettingsResponse {
  return {
    id: c.id,
    name: c.name,
    legal_name: c.legalName,
    gstin: c.gstin,
    phone: c.phone,
    email: c.email,
    address: c.address ?? null,
    logo_document_id: c.logoDocumentId,
    logo_url: logoUrl(c.logoDocumentId),
    letterhead: c.letterhead ?? {},
    fy_start_month: c.fyStartMonth,
    numbering: c.numbering,
    settings: c.settings,
    updated_at: c.updatedAt.toISOString(),
    version: c.version,
    numbering_preview: preview,
  };
}

/** Loads the company row of the caller (fresh, not cached) with its numbering preview. */
export async function loadSettings(db: Executor, companyId: string): Promise<CompanySettingsResponse> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw ApiError.notFound("Company");
  return toSettingsResponse(c, await numberingPreview(db, c));
}

/** Maps the wire update onto company columns (only keys that were sent); numbering/settings are merged onto the stored row by mergeJson(). */
function changesOf(body: Partial<CompanySettingsPatch>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) out["name"] = body.name;
  if (body.legal_name !== undefined) out["legalName"] = body.legal_name;
  if (body.gstin !== undefined) out["gstin"] = body.gstin;
  if (body.phone !== undefined) out["phone"] = body.phone;
  if (body.email !== undefined) out["email"] = body.email;
  if (body.address !== undefined) out["address"] = body.address;
  if (body.logo_document_id !== undefined) out["logoDocumentId"] = body.logo_document_id;
  if (body.letterhead !== undefined) out["letterhead"] = body.letterhead;
  if (body.fy_start_month !== undefined) out["fyStartMonth"] = body.fy_start_month;
  return out;
}

/** 400 VALIDATION_ERROR with the Zod issues under `details.issues` (same shape as the request validator). */
function invalid(prefix: string, issues: { path: PropertyKey[]; message: string }[]): ApiError {
  const list = issues.map((i) => ({ path: [prefix, ...i.path.map(String)].join("."), message: i.message }));
  return ApiError.badRequest(list.map((i) => `${i.path}: ${i.message}`).join("; "), { issues: list });
}

/**
 * Merges a partial `numbering` / `settings` patch onto the stored jsonb and validates the result against the complete strict schema, so a
 * patch of one SLA value never resets force_mfa_for_admins (or anything else) to a default, and the stored document is always complete.
 * Every numbering pattern is additionally rendered once with the engine: a pattern the engine cannot format must never be stored
 * (it would turn every create and GET /settings/company into a 500).
 */
export function mergeJson(
  current: Pick<CompanyRow, "numbering" | "settings">,
  body: Pick<CompanySettingsPatch, "numbering" | "settings">,
): { numbering?: Numbering; settings?: CompanySettings } {
  const out: { numbering?: Numbering; settings?: CompanySettings } = {};
  if (body.numbering !== undefined) {
    const merged: Record<string, unknown> = { ...current.numbering };
    for (const [scope, cfg] of Object.entries(body.numbering)) if (cfg !== undefined) merged[scope] = cfg;
    const parsed = CompanyNumberingSchema.safeParse(merged);
    if (!parsed.success) throw invalid("numbering", parsed.error.issues);
    for (const { scope, fallback } of SCOPES) {
      const cfg = parsed.data[scope];
      try {
        formatNumber(cfg.prefix || fallback, "2526", 1, cfg.format ?? DEFAULT_NUMBER_PATTERN);
      } catch (err) {
        throw invalid("numbering", [
          { path: [scope, "format"], message: err instanceof Error ? err.message : "Invalid number pattern" },
        ]);
      }
    }
    out.numbering = parsed.data as Numbering;
  }
  if (body.settings !== undefined) {
    const { sla_hours, ...rest } = body.settings;
    const merged: Record<string, unknown> = { ...current.settings };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) merged[k] = v;
    if (sla_hours !== undefined) {
      const sla: Record<string, unknown> = { ...current.settings.sla_hours };
      for (const [k, v] of Object.entries(sla_hours)) if (v !== undefined) sla[k] = v;
      merged["sla_hours"] = sla;
    }
    const parsed = CompanySettingsValuesSchema.safeParse(merged);
    if (!parsed.success) throw invalid("settings", parsed.error.issues);
    out.settings = parsed.data as CompanySettings;
  }
  return out;
}

/** Fields of the audit snapshot (snake_case wire names of the changed columns). */
function snapshot(c: CompanyRow, keys: string[]): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    name: c.name,
    legalName: c.legalName,
    gstin: c.gstin,
    phone: c.phone,
    email: c.email,
    address: c.address,
    logoDocumentId: c.logoDocumentId,
    letterhead: c.letterhead,
    fyStartMonth: c.fyStartMonth,
    numbering: c.numbering,
    settings: c.settings,
  };
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()] = wire[k] ?? null;
  return out;
}

const UpdateBody = withOptionalVersion(CompanySettingsPatchSchema);

/** GET/PATCH /settings/company. */
export function registerSettingsRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/settings/company",
    permission: "settings.manage",
    schema: {
      response: { 200: CompanySettingsResponseSchema },
      summary: "Company profile, letterhead, numbering (with next-number preview) and settings",
      tags: ["settings"],
    },
    handler: async (req) => loadSettings(app.db, staff(req).companyId),
  });

  route(app, {
    method: "PATCH",
    url: "/settings/company",
    permission: "settings.manage",
    schema: {
      body: UpdateBody,
      response: { 200: CompanySettingsResponseSchema },
      summary:
        "Update company settings (partial: numbering scopes and settings keys merge onto the stored values; version via body or If-Match; audited; company cache invalidated)",
      tags: ["settings"],
    },
    handler: async (req) => {
      const user = staff(req);
      const body = req.body as CompanySettingsPatch;
      const version = expectedVersion(req, body);
      const changes = changesOf(body);
      if (Object.keys(changes).length === 0 && body.numbering === undefined && body.settings === undefined)
        throw ApiError.badRequest("Nothing to update");
      const meta = adminMeta(req);
      const result = await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, user.companyId))
          .limit(1)
          .for("update");
        if (!before) throw ApiError.notFound("Company");
        const merged = mergeJson(before, body);
        if (merged.numbering) changes["numbering"] = merged.numbering;
        if (merged.settings) changes["settings"] = merged.settings;
        if (typeof changes["logoDocumentId"] === "string") {
          const [doc] = await tx
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                eq(documents.id, changes["logoDocumentId"]),
                eq(documents.companyId, user.companyId),
                eq(documents.isDeleted, false),
              ),
            )
            .limit(1);
          if (!doc)
            throw ApiError.badRequest("logo_document_id does not refer to a live document of this company", {
              issues: [{ path: "logo_document_id", message: "Unknown document" }],
            });
        }
        const after = await applyUpdate(tx, companies, user.companyId, version, changes, "company");
        const keys = Object.keys(changes);
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: meta.actor,
          ip: meta.ip,
          requestId: meta.requestId,
          action: "company.update",
          entityType: "company",
          entityId: user.companyId,
          before: snapshot(before, keys),
          after: snapshot(after, keys),
        });
        return toSettingsResponse(after, await numberingPreview(tx, after));
      });
      await invalidateCompany(app.redis, user.companyId);
      return result;
    },
  });
}
