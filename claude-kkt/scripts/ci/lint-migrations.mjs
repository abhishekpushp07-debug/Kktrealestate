#!/usr/bin/env node
// Migration lint (CI job "Migration lint"; docs/DATA-MODEL.md "Writing migrations"). Rejects, in NEW migration files, statements that
// take long blocking locks on tables that already hold data:
//
//   index-not-concurrent   CREATE INDEX on an existing table outside packages/db/src/sql/online (drizzle migrations run inside a
//                          transaction, which blocks writes for the whole build); inside src/sql/online the index must be CONCURRENTLY
//   constraint-not-valid   ADD CONSTRAINT … CHECK / FOREIGN KEY (or ADD COLUMN … REFERENCES) on an existing table without NOT VALID
//                          (validate it later with VALIDATE CONSTRAINT in src/sql/online: that scan does not block writes)
//   unique-without-index   ADD CONSTRAINT … UNIQUE / PRIMARY KEY on an existing table without USING INDEX (build the index
//                          CONCURRENTLY first, then attach it)
//   alter-column-type      ALTER COLUMN … TYPE on an existing table (rewrites the table under ACCESS EXCLUSIVE: add a new column,
//                          backfill in batches, switch over)
//   set-not-null           ALTER COLUMN … SET NOT NULL on an existing table without a prior validated CHECK (col IS NOT NULL)
//                          (with one, PostgreSQL ≥ 12 skips the full-table scan)
//
// A table is "existing" unless the same file creates it. A deliberate exception carries a comment right before the statement:
//   -- lint-migrations: allow <rule> — <reason>
//
//   node scripts/ci/lint-migrations.mjs --base origin/main     # files added since that ref (CI)
//   node scripts/ci/lint-migrations.mjs <file.sql>…            # these files
//   node scripts/ci/lint-migrations.mjs --all                  # every migration file (report; older files predate the rules)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATION_DIRS = ["packages/db/drizzle", "packages/db/src/sql", "packages/db/src/sql/online"];

/** Splits SQL into statements (respects quotes, dollar quotes and comments); each keeps its leading comments in `raw`. */
export function splitStatements(text) {
  const out = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      const e = text.indexOf("\n", i);
      i = e === -1 ? n : e + 1;
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e === -1 ? n : e + 2;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && !(text[i] === c && text[i + 1] !== c)) i += text[i] === c ? 2 : 1;
      i++;
    } else if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (m) {
        const e = text.indexOf(m[0], i + m[0].length);
        i = e === -1 ? n : e + m[0].length;
      } else i++;
    } else if (c === ";") {
      out.push({ raw: text.slice(start, i), start });
      i++;
      start = i;
    } else i++;
  }
  if (text.slice(start).trim()) out.push({ raw: text.slice(start), start });
  return out
    .map(({ raw, start: at }) => ({
      raw,
      sql: stripComments(raw).replace(/\s+/g, " ").trim(),
      // 1-based line of the statement's first token (after leading comments and blank lines)
      line: text.slice(0, at + significantOffset(raw)).split("\n").length,
    }))
    .filter((s) => s.sql !== "");
}

/** Offset of the first character of `raw` that is not whitespace or a comment. */
function significantOffset(raw) {
  let i = 0;
  for (;;) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (raw.startsWith("--", i)) {
      const e = raw.indexOf("\n", i);
      if (e === -1) return raw.length;
      i = e + 1;
    } else if (raw.startsWith("/*", i)) {
      const e = raw.indexOf("*/", i + 2);
      if (e === -1) return raw.length;
      i = e + 2;
    } else return i;
  }
}

function stripComments(s) {
  // comments outside quotes (statement text is short; a simple scan is enough)
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "-" && s[i + 1] === "-") {
      const e = s.indexOf("\n", i);
      i = e === -1 ? s.length : e + 1;
      out += " ";
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      i = e === -1 ? s.length : e + 2;
      out += " ";
    } else if (s[i] === "'" || s[i] === '"' || s[i] === "$") {
      const q = s[i] === "$" ? (/^\$[A-Za-z_]*\$/.exec(s.slice(i))?.[0] ?? null) : s[i];
      if (!q) {
        out += s[i++];
        continue;
      }
      const e = s.indexOf(q, i + q.length);
      const end = e === -1 ? s.length : e + q.length;
      out += s.slice(i, end);
      i = end;
    } else out += s[i++];
  }
  return out.replace(/-->\s*statement-breakpoint/g, " ");
}

/** "public"."Foo" / foo → foo */
const name = (s) => s.split(".").pop().replace(/^"|"$/g, "").toLowerCase();
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?`;

/** Splits the actions of ALTER TABLE at top-level commas. */
function topLevelSplit(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Column of a CHECK expression of the form (col IS NOT NULL), else null. */
function notNullCheckColumn(expr) {
  const m = new RegExp(String.raw`^\(*\s*(${IDENT})\s+IS\s+NOT\s+NULL\s*\)*$`, "i").exec(expr.trim());
  return m ? name(m[1]) : null;
}

/**
 * Lints migration files in apply order. `files` = [{path, text}] (path relative to the repository root); `targets` = paths to report
 * (default: all). State that spans files (validated NOT NULL checks) is collected from every file in order. `exemptions` =
 * [{file, rule, table?, reason}] for statements in files this repository cannot annotate (scripts/ci/migration-lint-exemptions.json).
 */
export function lintMigrations(files, targets = null, exemptions = []) {
  const report = targets ? new Set(targets) : null;
  const problems = [];
  /** table → set of columns with a validated CHECK (col IS NOT NULL) */
  const validatedNotNull = new Map();
  /** constraint name → {table, column} for NOT VALID null checks awaiting VALIDATE */
  const pendingChecks = new Map();
  const markValidated = (table, column) => {
    if (!validatedNotNull.has(table)) validatedNotNull.set(table, new Set());
    validatedNotNull.get(table).add(column);
  };
  for (const { path, text } of files) {
    const online = path.replace(/\\/g, "/").includes("/src/sql/online/");
    const created = new Set();
    for (const st of splitStatements(text)) {
      const allowed = new Set([...st.raw.matchAll(/--\s*lint-migrations:\s*allow\s+([\w-]+)/g)].map((m) => m[1]));
      const flag = (rule, msg, table) => {
        if (allowed.has(rule)) return;
        const exempt = exemptions.find((e) => e.file === path && e.rule === rule && (!e.table || e.table === table));
        if (exempt) return;
        if (!report || report.has(path))
          problems.push({ path, line: st.line, rule, message: msg, sql: st.sql.slice(0, 160) });
      };
      const sql = st.sql;
      let m;
      if (
        (m = new RegExp(String.raw`^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, "i").exec(
          sql,
        ))
      ) {
        created.add(name(m[1]));
        // inline NOT NULL checks of a new table count as validated
        for (const c of sql.matchAll(/CHECK\s*\((.*?)\)\s*(?:,|\)$)/gi)) {
          const col = notNullCheckColumn(c[1]);
          if (col) markValidated(name(m[1]), col);
        }
      } else if (
        (m = new RegExp(
          String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${IDENT})`,
          "i",
        ).exec(sql))
      ) {
        const table = name(m[2]);
        if (!created.has(table)) {
          if (online && !m[1])
            flag("index-not-concurrent", `CREATE INDEX on existing table ${table} must be CONCURRENTLY`, table);
          else if (!online)
            flag(
              "index-not-concurrent",
              `CREATE INDEX on existing table ${table}: move it to packages/db/src/sql/online/*.sql as CREATE INDEX CONCURRENTLY IF NOT EXISTS`,
              table,
            );
        }
      } else if (
        (m = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s+(.*)$`, "i").exec(sql))
      ) {
        const table = name(m[1]);
        const existing = !created.has(table);
        for (const action of topLevelSplit(m[2])) {
          let a;
          if (
            (a = new RegExp(
              String.raw`^ADD\s+CONSTRAINT\s+(${IDENT})\s+(CHECK|FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY)\b(.*)$`,
              "i",
            ).exec(action))
          ) {
            const cname = name(a[1]);
            const kind = a[2].toUpperCase().replace(/\s+/g, " ");
            const rest = a[3];
            const notValid = /\bNOT\s+VALID\s*$/i.test(rest);
            if (kind === "CHECK" || kind === "FOREIGN KEY") {
              if (existing && !notValid)
                flag(
                  "constraint-not-valid",
                  `ADD CONSTRAINT ${cname} ${kind} on existing table ${table} needs NOT VALID (then VALIDATE CONSTRAINT in src/sql/online)`,
                  table,
                );
              if (kind === "CHECK") {
                const col = notNullCheckColumn(rest.replace(/\bNOT\s+VALID\s*$/i, "").trim());
                if (col) {
                  if (notValid) pendingChecks.set(cname, { table, column: col });
                  else markValidated(table, col);
                }
              }
            } else if (existing && !/\bUSING\s+INDEX\b/i.test(rest)) {
              flag(
                "unique-without-index",
                `ADD CONSTRAINT ${cname} ${kind} on existing table ${table} builds its index under an exclusive lock: CREATE UNIQUE INDEX CONCURRENTLY first, then ADD CONSTRAINT … USING INDEX`,
                table,
              );
            }
          } else if ((a = /^VALIDATE\s+CONSTRAINT\s+(\S+)/i.exec(action))) {
            const p = pendingChecks.get(name(a[1]));
            if (p) markValidated(p.table, p.column);
          } else if (
            (a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(?:SET\s+DATA\s+)?TYPE\b`, "i").exec(action))
          ) {
            if (existing)
              flag(
                "alter-column-type",
                `ALTER COLUMN ${name(a[1])} TYPE on existing table ${table} rewrites it under ACCESS EXCLUSIVE: add a new column, backfill in batches, switch over`,
                table,
              );
          } else if (
            (a = new RegExp(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+SET\s+NOT\s+NULL\b`, "i").exec(action))
          ) {
            const col = name(a[1]);
            if (existing && !validatedNotNull.get(table)?.has(col))
              flag(
                "set-not-null",
                `SET NOT NULL on ${table}.${col} scans the table under ACCESS EXCLUSIVE: first ADD CONSTRAINT … CHECK (${col} IS NOT NULL) NOT VALID and VALIDATE it (src/sql/online)`,
                table,
              );
          } else if (
            (a = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.*)$/i.exec(action)) &&
            /\bREFERENCES\b/i.test(a[1])
          ) {
            if (existing)
              flag(
                "constraint-not-valid",
                `ADD COLUMN … REFERENCES on existing table ${table} validates the foreign key under lock: add the column, then ADD CONSTRAINT … FOREIGN KEY … NOT VALID`,
                table,
              );
          }
        }
      }
    }
  }
  return problems;
}

/** Migration files in apply order: drizzle journal order (file names sort the same), src/sql, src/sql/online. */
export function migrationFiles(root = ROOT) {
  const out = [];
  for (const d of MIGRATION_DIRS) {
    const abs = join(root, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)
      .filter((x) => x.endsWith(".sql"))
      .sort())
      out.push(`${d}/${f}`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const all = migrationFiles();
  let targets;
  const baseIdx = args.indexOf("--base");
  if (args.includes("--all")) targets = all;
  else if (baseIdx !== -1) {
    const base = args[baseIdx + 1];
    const diff = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", base, "--", ...MIGRATION_DIRS], {
      cwd: ROOT,
      encoding: "utf8",
    });
    targets = diff
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.endsWith(".sql"));
  } else targets = args.map((f) => relative(ROOT, join(process.cwd(), f)).split(sep).join("/"));
  if (targets.length === 0) {
    console.log("lint-migrations: no new migration files");
    return;
  }
  const extra = targets.filter((t) => !all.includes(t));
  const files = [...all, ...extra].map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
  const exemptionsFile = join(ROOT, "scripts", "ci", "migration-lint-exemptions.json");
  const exemptions = existsSync(exemptionsFile) ? JSON.parse(readFileSync(exemptionsFile, "utf8")).exemptions : [];
  for (const e of exemptions)
    if (!e.file || !e.rule || !e.reason || e.reason.length < 20)
      throw new Error(`exemption ${JSON.stringify(e)}: file, rule and a reason are required`);
  const problems = lintMigrations(files, targets, exemptions);
  for (const p of problems)
    console.log(`::error file=${p.path},line=${p.line}::[${p.rule}] ${p.message}\n    ${p.sql}`);
  console.log(`lint-migrations: ${targets.length} file(s) checked, ${problems.length} problem(s)`);
  if (problems.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
