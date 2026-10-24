import { expect } from "vitest";

/** Returns the deepest `cause` message of an error chain (drizzle wraps driver errors). */
export function rootMessage(err: unknown): string {
  let current: unknown = err;
  let message = "";
  while (current instanceof Error) {
    message = current.message;
    current = current.cause;
  }
  return message;
}

/** Asserts that `promise` rejects and that the underlying Postgres error message matches `re`. */
export async function rejectsWithPg(promise: Promise<unknown>, re: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the query to be rejected").not.toBeNull();
  expect(rootMessage(caught)).toMatch(re);
}
