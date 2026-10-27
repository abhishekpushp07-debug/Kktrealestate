import { resetDatabase } from "../src/reset.js";
import { TEST_DATABASE_URL } from "./env.js";

/** Resets kkt_test once before the whole run so every test file starts from a migrated schema. */
export default async function setup(): Promise<void> {
  await resetDatabase(TEST_DATABASE_URL, { nodeEnv: "test", confirm: "yes" });
}
