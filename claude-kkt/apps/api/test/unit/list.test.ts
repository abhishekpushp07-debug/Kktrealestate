import { describe, expect, it } from "vitest";
import { roomTypes } from "@kkt/db";
import { escapeLike, resolveSort } from "../../src/lib/list.js";
import { ApiError } from "../../src/lib/errors.js";

describe("list helpers", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
  it("resolves allow-listed sorts and rejects unknown fields", () => {
    const allowed = { name: roomTypes.name, created_at: roomTypes.createdAt };
    expect(resolveSort({ allowed, default: "name" })).toMatchObject({ field: "name", direction: "asc" });
    expect(resolveSort({ allowed, default: "name", requested: "-created_at" })).toMatchObject({
      field: "created_at",
      direction: "desc",
    });
    expect(() => resolveSort({ allowed, default: "name", requested: "password_hash" })).toThrow(ApiError);
  });
});
