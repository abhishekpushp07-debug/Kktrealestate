/** Test database URL (never the dev database). */
export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/kkt_test";
