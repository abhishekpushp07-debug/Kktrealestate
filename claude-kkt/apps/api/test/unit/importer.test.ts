import { describe, expect, it } from "vitest";
import { DocumentTypeCreateSchema, FlatTypeCreateSchema, RoomTypeCreateSchema } from "@kkt/contracts";
import { coerceCsvValue, csvRecordToInput } from "../../src/modules/masters/importer.js";
import { documentTypesKind, flatTypesKind, roomTypesKind } from "../../src/modules/masters/kinds.js";

describe("CSV coercion", () => {
  it("coerces numbers, booleans, lists and JSON according to the field schema", () => {
    const shape = RoomTypeCreateSchema.shape;
    expect(coerceCsvValue(shape.sort_order, "12")).toBe(12);
    expect(coerceCsvValue(shape.sort_order, "")).toBeUndefined();
    expect(coerceCsvValue(shape.code, "123")).toBe("123");
    const doc = DocumentTypeCreateSchema.shape;
    expect(coerceCsvValue(doc.is_kyc, "yes")).toBe(true);
    expect(coerceCsvValue(doc.is_kyc, "0")).toBe(false);
    expect(coerceCsvValue(doc.applies_to, "CUSTOMER|BOOKING")).toEqual(["CUSTOMER", "BOOKING"]);
    expect(coerceCsvValue(doc.applies_to, '["CUSTOMER"]')).toEqual(["CUSTOMER"]);
    const ft = FlatTypeCreateSchema.shape;
    expect(coerceCsvValue(ft.rooms, '[{"room_type_id":"x","label":"L","length_ft":10,"width_ft":12}]')).toEqual([{ room_type_id: "x", label: "L", length_ft: 10, width_ft: 12 }]);
    expect(coerceCsvValue(ft.bhk, "2.5")).toBe(2.5);
  });
  it("ignores unknown columns and parses into the create schema", () => {
    const input = csvRecordToInput(roomTypesKind, { name: "Study", code: "study", sort_order: "3", ignored: "x" });
    expect(input).toEqual({ name: "Study", code: "study", sort_order: 3 });
    expect(RoomTypeCreateSchema.parse(input).code).toBe("STUDY");
    const doc = csvRecordToInput(documentTypesKind, { name: "PAN", code: "PAN", applies_to: "CUSTOMER", is_kyc: "true" });
    expect(DocumentTypeCreateSchema.safeParse(doc).success).toBe(true);
    expect(csvRecordToInput(flatTypesKind, { name: "x", code: "X", bhk: "abc" })).toEqual({ name: "x", code: "X", bhk: "abc" });
  });
});
