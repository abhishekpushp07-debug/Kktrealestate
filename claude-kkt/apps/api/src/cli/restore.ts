/**
 * Restore CLI (audit B9): loads a backup ZIP produced by POST /api/v1/admin/backup into an EMPTY PostgreSQL database.
 *
 *   pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url <postgres url of an empty database> --confirm [--allow-stripped]
 *   pnpm --filter @kkt/api restore -- --file <backup.zip> --verify-only
 *   (inside the API image: node dist/cli/restore.js …)
 *
 * Verifies the manifest signature (manifest.sig, HMAC under the LINK_SIGNING_KEYS ring of the installation that made the backup: set
 * LINK_SIGNING_KEYS or LINK_SIGNING_KEYS_FILE) and every checksum, migrates the target, loads the tables in foreign-key order in one
 * transaction, checks the row counts and runs the integrity report (modules/admin/restore.ts). Exit code 0 only when every count matches
 * and the integrity report is clean; --verify-only checks signature and checksums without a database (exit 0 = authentic and intact).
 */
import { parseArgs } from "node:util";

const USAGE =
  "usage: pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url <postgres url of an empty database> --confirm [--allow-stripped]\n" +
  "       pnpm --filter @kkt/api restore -- --file <backup.zip> --verify-only";

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      file: { type: "string" },
      "database-url": { type: "string" },
      confirm: { type: "boolean", default: false },
      "allow-stripped": { type: "boolean", default: false },
      "verify-only": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.file && values["verify-only"]) {
    const { verifyBackupArchive } = await import("../modules/admin/restore.js");
    const v = await verifyBackupArchive(values.file, (msg) => console.log(msg));
    console.log(
      JSON.stringify(
        {
          ok: true,
          format: v.manifest.format,
          signed_by: v.signed_by,
          generated_at: v.manifest.generated_at,
          company: v.manifest.company,
          tables: v.manifest.table_count,
          rows: v.manifest.row_count,
          files_verified: v.files_verified,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (values.help || !values.file || !values["database-url"]) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  if (!values.confirm) {
    console.error(`refusing to restore without --confirm\n${USAGE}`);
    return 2;
  }
  // The application config is loaded by the modules the restore uses; point it at the target unless the caller already configured one.
  process.env["DATABASE_URL"] ??= values["database-url"];
  const { restoreBackup } = await import("../modules/admin/restore.js");
  const result = await restoreBackup({
    file: values.file,
    databaseUrl: values["database-url"],
    confirm: true,
    allowStripped: values["allow-stripped"],
    log: (msg) => console.log(msg),
  });
  const rows = result.tables.reduce((s, t) => s + t.restored, 0);
  const dirty = result.integrity.filter((i) => !i.ok);
  console.log(
    JSON.stringify(
      {
        ok: dirty.length === 0,
        signed_by: result.signed_by,
        tables: result.tables.length,
        rows,
        integrity: result.integrity,
        duration_ms: result.duration_ms,
      },
      null,
      2,
    ),
  );
  return dirty.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`restore failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
