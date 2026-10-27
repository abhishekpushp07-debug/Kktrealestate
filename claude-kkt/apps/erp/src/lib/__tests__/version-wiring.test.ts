/**
 * Contract C6 wiring: every ERP call to an endpoint that requires a version (docs/hardening/phase7-foundation.md, "Versions") sends
 * one — If-Match "v<n>" through the `version` option, or the row version in the body. The scan reads the source of every
 * api.post / patch / put / delete / request call and fails on a version-required route that carries no version, so a new button
 * cannot ship answering 428 VERSION_REQUIRED.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conflictDetailsFrom } from "@/lib/conflict-store";
import { describeError, parseErrorEnvelope, versionTag } from "@/lib/api";

const SRC = path.resolve(__dirname, "../..");

/** POST actions that need the row version (foundation list: newly required + already required). PATCH and DELETE always do. */
const VERSIONED_POST = new RegExp(
  [
    "/deactivate",
    "/activate",
    "/cancel",
    "/complete",
    "/no-show",
    "/outcome",
    "/reschedule",
    "/messages",
    "plan-change",
    "other-charges",
    "agreement-revisions",
    "/clear",
    "/bounce",
    "/reverse",
    "construction/status",
    "construction/undo",
    "stage-sequence",
    "generate-flats",
    "/floors",
    "/price",
    "/status",
    "/flat-type",
    "website/publish",
    "/kyc",
    "/stage\\b",
    "/assign",
    "/convert",
    "reset-password",
    "/unlock",
    "/scope",
  ].join("|"),
);

/** Calls that are version-exempt by contract (session revocation) or are not version-required routes. */
const EXEMPT = [
  /SESSIONS_PATH/, // DELETE /auth/sessions[/:id] is exempt (foundation report)
  /portal-access|\$\{path\}\/reset-password/, // POST /customers/:id/portal-access/reset-password is not versioned
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

interface Call {
  file: string;
  line: number;
  method: string;
  text: string;
}

function versionRequiredCalls(): Call[] {
  const calls: Call[] = [];
  const re = /\bapi\.(post|patch|delete|put|request)\s*(?:<[^>]*>)?\s*\(/g;
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    for (const match of src.matchAll(re)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      const text = callText(src, open);
      const method = match[1] ?? "";
      const head = text.slice(1, 200);
      const required = method === "patch" || method === "delete" || (method === "post" && VERSIONED_POST.test(head));
      if (!required || EXEMPT.some((re2) => re2.test(head))) continue;
      calls.push({ file: path.relative(SRC, file), line: src.slice(0, match.index).split("\n").length, method, text });
    }
  }
  return calls;
}

describe("version-required endpoints (contract C6)", () => {
  it("every ERP call to one sends the version (If-Match option or body)", () => {
    const calls = versionRequiredCalls();
    expect(calls.length).toBeGreaterThan(40);
    const missing = calls
      .filter((call) => !/\bversion\b|expected_version/.test(call.text))
      .map((call) => `${call.file}:${call.line} ${call.method} ${call.text.slice(1, 90).replace(/\s+/g, " ")}`);
    expect(missing).toEqual([]);
  });

  it("covers the routes the foundation stage made version-required", () => {
    const heads = versionRequiredCalls().map((call) => `${call.method} ${call.text.slice(0, 200)}`);
    for (const route of [
      // (each pattern must match at least one call)
      /post [\s\S]*\/deactivate/,
      /post [\s\S]*VISITS_PATH[\s\S]*\/cancel/,
      /post [\s\S]*\/messages/,
      /delete [\s\S]*DRAFTS_PATH/,
      /delete [\s\S]*PRESETS_PATH/,
      /delete [\s\S]*co-applicants|delete [\s\S]*\$\{path\}\/\$\{row\.id\}/,
      /delete [\s\S]*config\.path/,
    ]) {
      expect(
        heads.some((head) => route.test(head)),
        String(route),
      ).toBe(true);
    }
  });

  it("If-Match uses the ETag form and conflicts read details.current_version", () => {
    expect(versionTag(7)).toBe('"v7"');
    expect(conflictDetailsFrom({ current_version: 9, current: 9, changed_by: "Asha" })).toMatchObject({
      currentVersion: 9,
      changedBy: "Asha",
    });
    expect(conflictDetailsFrom({ current: 4 })).toMatchObject({ currentVersion: 4 });
    // 428 VERSION_REQUIRED reads as "reload and try again"
    expect(describeError(parseErrorEnvelope(428, { error: { code: "VERSION_REQUIRED", message: "m" } }))).toMatch(
      /Reload/,
    );
  });
});
