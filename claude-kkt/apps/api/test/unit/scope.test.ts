import { describe, expect, it } from "vitest";
import { flats } from "@kkt/db";
import { ApiError } from "../../src/lib/errors.js";
import { assertPermission, ensureProjectAccess, scopeFilter } from "../../src/lib/scope.js";

describe("scope helpers", () => {
  const all = { allProjects: true, projectIds: [] };
  const scoped = { allProjects: false, projectIds: ["a"] };
  const none = { allProjects: false, projectIds: [] };
  it("scopeFilter is undefined for all-project users and a condition otherwise", () => {
    expect(scopeFilter(all, flats.projectId)).toBeUndefined();
    expect(scopeFilter(scoped, flats.projectId)).toBeDefined();
    expect(scopeFilter(none, flats.projectId)).toBeDefined();
  });
  it("ensureProjectAccess throws 404 (never 403) outside scope", () => {
    expect(() => ensureProjectAccess(all, "zzz")).not.toThrow();
    expect(() => ensureProjectAccess(scoped, "a")).not.toThrow();
    try {
      ensureProjectAccess(scoped, "b");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(404);
    }
    expect(() => ensureProjectAccess(scoped, null)).toThrow(ApiError);
  });
  it("assertPermission throws 403 FORBIDDEN", () => {
    const user = { permissions: new Set(["master.read"]) };
    expect(() => assertPermission(user, "master.read")).not.toThrow();
    try {
      assertPermission(user, "master.write");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as ApiError).statusCode).toBe(403);
      expect((e as ApiError).code).toBe("FORBIDDEN");
    }
  });
});
