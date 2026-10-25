/**
 * Admin module (SPEC §2 backup export + right to erasure, §10/§11 recompute/reconcile, §17 guarded reseed, company settings, job triggers).
 * Auto-registered under /api/v1 by the module loader. Backup, reseed and erase additionally require the Super Admin role (403 SUPER_ADMIN_ONLY).
 *
 * Service surface other modules may call:
 *   numberingPreview(db, company, businessDate?) · loadSettings(db, companyId) · buildBackup(db, opts) · createBackup(app, opts) · listBackups(app, companyId)
 *   eraseCustomer(app, input) · activeBookingsOf(db, customerId) · bookingsInScope(db, user, scope) · reconcileBookings(db, targets) · recomputeBookings(db, targets)
 *   reconciliationJob(db) · systemFacts(app) · requireSuperAdmin(user) · ZipWriter / readCentralDirectory / readZipEntry / crc32
 */
import type { FastifyInstance } from "fastify";
import { registerBackupRoutes } from "./backup.js";
import { registerEraseRoutes } from "./erase.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerToolRoutes } from "./tools.js";

export { requireSuperAdmin, SUPER_ADMIN_ROLE } from "./common.js";
export { numberingPreview, loadSettings, toSettingsResponse, mergeJson } from "./settings.js";
export { buildBackup, createBackup, listBackups, backupTables, tableScope, isSensitiveColumn, backupLink, signBackupToken, verifyBackupToken, loadBackupMeta, BACKUP_TTL_SECONDS, BACKUP_LINK_TTL_SECONDS, BACKUP_FORMAT, BACKUP_MAX_ROWS_PER_TABLE, type BackupManifest, type BackupTableScope, type BuildBackupOptions, type BuiltBackup } from "./backup.js";
export { eraseCustomer, activeBookingsOf, erasedPhone, erasedName, type EraseInput } from "./erase.js";
export { bookingsInScope, reconcileBookings, recomputeBookings, reconciliationJob, systemFacts, loadReseed, toJobRunRow, type RebuildScope } from "./tools.js";
export { ZipWriter, ZipEntryStream, readCentralDirectory, readZipEntry, crc32, dosDateTime, type ZipEntryInfo } from "./zip.js";

/** Fastify plugin: settings, backup, tools (recompute/reconcile/jobs/system/reseed) and erasure routes. */
export default async function adminModule(app: FastifyInstance): Promise<void> {
  registerSettingsRoutes(app);
  registerBackupRoutes(app);
  registerToolRoutes(app);
  registerEraseRoutes(app);
}
