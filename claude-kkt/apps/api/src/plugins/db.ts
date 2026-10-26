import fp from "fastify-plugin";
import { createDb, type DB, type DbHandle } from "@kkt/db";
import { config } from "../config.js";
import { installListExports } from "../lib/list.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Primary Drizzle handle (reads + writes). */
    db: DB;
    /** Read replica handle; falls back to the primary when DATABASE_REPLICA_URL is unset. */
    dbReplica: DB;
  }
}

/**
 * Fastify plugin exposing `app.db` (Drizzle), `app.sql` (postgres.js) and `app.dbReplica`; pools close on shutdown. It also installs the
 * list-export hooks of lib/list.ts (X-Export-* headers on CSV lists, keyset CSV pages for the export job), which every list route shares.
 */
export default fp(async (app) => {
  const primary: DbHandle = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
  const replica: DbHandle | null = config.DATABASE_REPLICA_URL ? createDb(config.DATABASE_REPLICA_URL, { max: Math.max(2, Math.floor(config.DATABASE_POOL_MAX / 2)) }) : null;
  app.decorate("db", primary.db);
  app.decorate("sql", primary.sql);
  app.decorate("dbReplica", replica ? replica.db : primary.db);
  installListExports(app);
  app.addHook("onClose", async () => {
    await primary.close().catch(() => undefined);
    if (replica) await replica.close().catch(() => undefined);
  });
}, { name: "db" });
