/**
 * Admin module (SPEC §2 backup export + right to erasure, §10/§11 recompute/reconcile, §17 guarded reseed, company settings, job triggers).
 * Auto-registered under /api/v1 by the module loader. Backup, reseed and erase additionally require the Super Admin role (403 SUPER_ADMIN_ONLY).
 *
 * Service surface other modules may call:
 *   numberingPreview(db, company, businessDate?) · loadSettings(db, companyId) · writeBackupArchive(db, file, opts) · runBackupJob(ctx) · listBackups(db, companyId)
 *   restoreBackup({ file, databaseUrl, confirm }) (restore CLI: src/cli/restore.ts) · partitionMaintenance(db)
 *   eraseCustomer(app, input) · activeBookingsOf(db, customerId) · bookingsInScope(db, user, scope) · reconcileBookings(db, targets) · recomputeBookings(db, targets)
 *   reconciliationJob(db) · systemFacts(app) · requireSuperAdmin(user)
 */
import type { FastifyInstance } from "fastify";
import { registerBackupRoutes } from "./backup.js";
import { registerEraseRoutes } from "./erase.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerToolRoutes } from "./tools.js";

export { requireSuperAdmin, SUPER_ADMIN_ROLE } from "./common.js";
export { numberingPreview, loadSettings, toSettingsResponse, mergeJson } from "./settings.js";
export {
  writeBackupArchive,
  runBackupJob,
  listBackups,
  loadDoneBackup,
  toBackupRow,
  backupTables,
  tableScope,
  isSensitiveColumn,
  backupLink,
  signBackupToken,
  verifyBackupToken,
  fkLoadOrder,
  schemaVersion,
  pgClient,
  BACKUP_TTL_SECONDS,
  BACKUP_LINK_TTL_SECONDS,
  BACKUP_FORMAT,
  BACKUP_BATCH_SIZE,
  BACKUP_PATH,
  RESTORE_MD,
  type BackupManifest,
  type BackupManifestTable,
  type BackupTableScope,
  type WriteBackupOptions,
} from "./backup.js";
export { restoreBackup, readZipEntries, readZipText, type RestoreOptions, type RestoreResult } from "./restore.js";
export { eraseCustomer, activeBookingsOf, erasedPhone, erasedName, type EraseInput } from "./erase.js";
export {
  bookingsInScope,
  reconcileBookings,
  recomputeBookings,
  reconciliationJob,
  partitionMaintenance,
  systemFacts,
  loadReseed,
  toJobRunRow,
  type RebuildScope,
} from "./tools.js";

/** Fastify plugin: settings, backup, tools (recompute/reconcile/jobs/system/reseed) and erasure routes. */
export default async function adminModule(app: FastifyInstance): Promise<void> {
  registerSettingsRoutes(app);
  registerBackupRoutes(app);
  registerToolRoutes(app);
  registerEraseRoutes(app);
}
