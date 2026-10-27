/**
 * Cross-surface INR golden test (audit v3 H5): the ERP, the customer portal, the website and packages/domain (receipts, PDFs)
 * must print the same full and short forms for every row of INR_GOLDEN_CASES, so a customer never sees "₹100 L" on one screen
 * and "₹1 Cr" on another. The sweep below also compares every surface with the domain engine on boundary-heavy values.
 */
import { describe, expect, it } from "vitest";
import { INR_GOLDEN_CASES, formatInr, formatInrShort } from "@kkt/contracts";
import * as domain from "../../../../../packages/domain/src/money";
import * as portal from "../../../../portal/src/lib/format";
import * as web from "../../../../web/lib/format";
import * as erp from "../format";

const surfaces = {
  contracts: { full: (p: number) => formatInr(p), short: (p: number) => formatInrShort(p) },
  domain: { full: (p: number) => domain.formatINR(p), short: (p: number) => domain.formatINRShort(p) },
  erp: { full: (p: number) => erp.formatINR(p), short: (p: number) => erp.formatINRShort(p) },
  portal: { full: (p: number) => portal.formatINR(p), short: (p: number) => portal.formatINRShort(p) },
} as const;

describe.each(Object.entries(surfaces))("%s", (_name, surface) => {
  it.each(INR_GOLDEN_CASES.map((c) => [c.paise, c.full, c.short] as const))(
    "%s paise → %s / %s",
    (paise, full, short) => {
      expect(surface.full(paise)).toBe(full);
      expect(surface.short(paise)).toBe(short);
    },
  );
});

describe("website", () => {
  // The website shows whole rupees (formatINR rounds half-up, like the domain's paise: "never"); the short form is shared.
  it.each(INR_GOLDEN_CASES.map((c) => [c.paise, c.full, c.short] as const))(
    "%s paise → %s / %s",
    (paise, full, short) => {
      expect(web.formatINRShort(paise)).toBe(short);
      expect(web.formatINR(paise)).toBe(domain.formatINR(paise, { paise: "never" }));
      if (paise % 100 === 0) expect(web.formatINR(paise)).toBe(full);
    },
  );
});

describe("every surface agrees with the domain engine on a boundary sweep", () => {
  const values: number[] = [];
  for (const unit of [100, 1_00_000_00, 1_00_00_000_00]) {
    for (const k of [1, 9, 10, 99, 100, 999]) {
      for (const delta of [-501, -500, -499, -51, -50, -49, -1, 0, 1, 49, 50, 51, 499, 500, 501]) {
        const v = unit * k + delta * (unit / 1000 >= 1 ? unit / 1000 : 1);
        values.push(v, -v);
      }
    }
  }
  for (let i = 0; i < 2000; i += 1) values.push(Math.floor(Math.sin(i + 1) * 1e13));

  it("full and short forms match packages/domain", () => {
    for (const v of values) {
      const want = { full: domain.formatINR(v), short: domain.formatINRShort(v) };
      expect({ full: erp.formatINR(v), short: erp.formatINRShort(v) }).toEqual(want);
      expect({ full: portal.formatINR(v), short: portal.formatINRShort(v) }).toEqual(want);
      expect({ full: formatInr(v), short: formatInrShort(v) }).toEqual(want);
      expect(web.formatINRShort(v)).toBe(want.short);
      expect(web.formatINR(v)).toBe(domain.formatINR(v, { paise: "never" }));
    }
  });

  it("no surface prints a K unit or a Unicode minus", () => {
    for (const v of values) {
      for (const text of [erp.formatINRShort(v), portal.formatINRShort(v), web.formatINRShort(v)]) {
        expect(text).not.toMatch(/K|−/);
      }
    }
  });
});
