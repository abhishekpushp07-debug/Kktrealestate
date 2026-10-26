/**
 * Restore CLI (audit B9): loads a backup ZIP produced by POST /api/v1/admin/backup into an EMPTY PostgreSQL database.
 *
 *   pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url <postgres url of an empty database> --confirm [--allow-stripped]
 *
 * Verifies every checksum, migrates the target, loads the tables in foreign-key order in one transaction, checks the row counts and runs
 * the integrity report (modules/admin/restore.ts). Exit code 0 only when every count matches and the integrity report is clean.
 */
import { parseArgs } from "node:util";

const USAGE = "usage: pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url <postgres url of an empty database> --confirm [--allow-stripped]";

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      file: { type: "string" },
      "database-url": { type: "string" },
      confirm: { type: "boolean", default: false },
      "allow-stripped": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
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
    file: values.file, databaseUrl: values["database-url"], confirm: true, allowStripped: values["allow-stripped"],
    log: (msg) => console.log(msg),
  });
  const rows = result.tables.reduce((s, t) => s + t.restored, 0);
  const dirty = result.integrity.filter((i) => !i.ok);
  console.log(JSON.stringify({ ok: dirty.length === 0, tables: result.tables.length, rows, integrity: result.integrity, duration_ms: result.duration_ms }, null, 2));
  return dirty.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (err: unknown) => {
  console.error(`restore failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
