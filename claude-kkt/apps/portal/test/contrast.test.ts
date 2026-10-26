import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations (docs/qa/contrast.mjs)
import { check } from "../../../docs/qa/contrast.mjs";

interface Row { label: string; fg: string; bg: string; ratio: number; min: number; pass: boolean; note: string }

/** WCAG AA at the token level (audit H): every text pair ≥ 4.5:1, every UI-component boundary (field borders, focus rings) ≥ 3:1. */
describe("portal design tokens meet WCAG AA contrast (docs/qa/contrast.mjs)", () => {
  const rows = check("portal") as Row[];

  it("every checked pair passes", () => {
    expect(rows.filter((r) => !r.pass).map((r) => `${r.label}: ${r.ratio}:1 < ${r.min}:1`)).toEqual([]);
  });

  it("no pair is exempted as informational: form-field boundaries are real 3:1 checks", () => {
    expect(rows.filter((r) => r.note !== "")).toEqual([]);
    expect(rows.some((r) => /border/.test(r.label) && r.min === 3)).toBe(true);
  });
});
