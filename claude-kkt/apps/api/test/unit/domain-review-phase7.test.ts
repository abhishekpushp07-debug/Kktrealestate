import { describe, expect, it } from "vitest";
import { MoneyError, toBasisPoints } from "@kkt/domain";
import { ApiError } from "../../src/lib/errors.js";
import { checkImportHeader } from "../../src/modules/masters/importer.js";
import { kindDef } from "../../src/modules/masters/kinds.js";
import { translateDomainError } from "../../src/modules/inventory/service.js";

/** Phase 7 domain review (docs/hardening/phase7-review-domain.md). */
function caught(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected a throw");
}

describe("translateDomainError: MoneyError → 422 INVALID_AMOUNT", () => {
  const card = "11111111-1111-4111-8111-111111111111";

  it("a percent failure names the rate card and points at plc_rules", () => {
    const err = caught(() =>
      translateDomainError(
        (() => {
          try {
            toBasisPoints("1.255");
          } catch (e) {
            return e;
          }
        })(),
        { rateCardId: card },
      ),
    );
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("INVALID_AMOUNT");
    expect(err.message).toMatch(/Correct the PLC rule value/);
    expect(err.details).toMatchObject({ rate_card_id: card, issues: [{ path: "plc_rules", code: "money" }] });
  });

  it("any other money failure (out of the safe range) names the card but does not blame the PLC rules", () => {
    const err = caught(() =>
      translateDomainError(new MoneyError("Amount 9007199254740993 exceeds the safe integer range"), {
        rateCardId: card,
      }),
    );
    expect(err.code).toBe("INVALID_AMOUNT");
    expect(err.message).not.toMatch(/PLC/);
    expect(err.details).toMatchObject({ rate_card_id: card, issues: [{ path: "", code: "money" }] });
  });

  it("without a rate card the domain message is kept as is", () => {
    const err = caught(() => translateDomainError(new MoneyError('Percent "x" is not a decimal number')));
    expect(err.message).toBe('Percent "x" is not a decimal number');
    expect(err.details).not.toHaveProperty("rate_card_id");
  });
});

describe("checkImportHeader: own keys only", () => {
  it("Object.prototype member names are unknown columns, real columns are known", () => {
    const def = kindDef("ROOM_TYPES");
    expect(checkImportHeader(def, ["name", "code", "sort_order"])).toEqual({ ignored: [] });
    for (const h of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      const err = caught(() => checkImportHeader(def, ["name", "code", h]));
      expect(err.code, h).toBe("IMPORT_UNKNOWN_COLUMNS");
      expect((err.details as { unknown_columns: string[] }).unknown_columns).toEqual([h]);
    }
  });
});
