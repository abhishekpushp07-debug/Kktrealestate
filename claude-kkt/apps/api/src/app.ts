import compress from "@fastify/compress";
import cors from "@fastify/cors";
import etag from "@fastify/etag";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { dbPoolMax } from "./lib/metrics.js";
import { installRouteRegistry } from "./lib/routes.js";
import { auditModule } from "./modules/audit/index.js";
import { registerDiscoveredModules } from "./modules/loader.js";
import { authModule } from "./modules/auth/index.js";
import { mastersModule } from "./modules/masters/index.js";
import { notificationsModule } from "./modules/notifications/index.js";
import { rolesModule } from "./modules/roles/index.js";
import { searchModule } from "./modules/search/index.js";
import { systemModule } from "./modules/system/index.js";
import { lifecycle } from "./modules/system/lifecycle.js";
import { usersModule } from "./modules/users/index.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import errorReporterPlugin from "./plugins/errorReporter.js";
import idempotencyPlugin from "./plugins/idempotency.js";
import loadShedPlugin from "./plugins/loadShed.js";
import redisPlugin from "./plugins/redis.js";
import requestContextPlugin, { genReqId } from "./plugins/requestContext.js";
import telemetryPlugin, { currentTraceId } from "./plugins/telemetry.js";

/** 503 raised by under-pressure load shedding (mapped to the SERVICE_UNAVAILABLE error envelope with Retry-After). */
class UnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "SERVICE_UNAVAILABLE";
  constructor() { super("Service under pressure, retry shortly"); this.name = "UnavailableError"; }
}

/** Options for buildApp. */
export interface BuildAppOptions {
  /** Pino logger instance, `true` for the default logger, or `false` to silence. */
  logger?: FastifyServerOptions["loggerInstance"] | boolean;
  /** Extra routes registered under /api/v1 (tests). */
  extraRoutes?: (app: FastifyInstance) => Promise<void> | void;
  /**
   * Build without Postgres/Redis (OpenAPI generation and the compatibility test): `app.db`, `app.sql`, `app.dbReplica` and `app.redis`
   * are stubs that throw when used. Never listen with an offline app.
   */
  offline?: boolean;
}

/** A stand-in for a database/Redis client in an offline app: any call throws, property chains are allowed (registration-time wiring). */
function offlineStub(what: string): unknown {
  const fail = () => { throw new Error(`${what} is not available in an offline app (buildApp({ offline: true }))`); };
  const handler: ProxyHandler<() => void> = {
    // `then` (not a promise), `getter`/`setter` (Fastify's decorate() would treat the stub as an accessor pair)
    get: (_t, prop) => (prop === "then" || prop === "getter" || prop === "setter" ? undefined : prop === Symbol.toPrimitive ? () => `[offline ${what}]` : new Proxy(fail, handler)),
    apply: fail,
  };
  return new Proxy(fail, handler);
}

const offlineDbPlugin = fp(async (app) => {
  app.decorate("db", offlineStub("database") as FastifyInstance["db"]);
  app.decorate("sql", offlineStub("database") as FastifyInstance["sql"]);
  app.decorate("dbReplica", offlineStub("database") as FastifyInstance["dbReplica"]);
}, { name: "db" });
const offlineRedisPlugin = fp(async (app) => {
  app.decorate("redis", offlineStub("redis") as FastifyInstance["redis"]);
}, { name: "redis" });

/**
 * Content-Security-Policy of API responses: JSON, files and media never need to run anything, so everything is denied and the API cannot
 * be framed. The Swagger UI pages (/api/v1/docs) get a policy that allows exactly their own scripts and styles.
 */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const DOCS_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://validator.swagger.io; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/** Builds the fully configured Fastify application (plugins, modules under /api/v1, error envelope). Does not listen. */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    ...(opts.logger === false ? { logger: false } : opts.logger === true || opts.logger === undefined ? { loggerInstance: logger } : { loggerInstance: opts.logger }),
    // trace id on every request log line when OpenTelemetry is active (src/telemetry.ts)
    childLoggerFactory: (parent, bindings, childOpts) => {
      const traceId = currentTraceId();
      return parent.child(traceId ? { ...bindings, trace_id: traceId } : bindings, childOpts);
    },
    genReqId: (req) => genReqId(req.headers),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  installRouteRegistry(app);

  await app.register(helmet, {
    contentSecurityPolicy: false, // set per response below (API vs docs)
    crossOriginEmbedderPolicy: false,
    hsts: config.NODE_ENV === "production",
  });
  app.addHook("onSend", async (req, reply, payload) => {
    // while draining (SIGTERM) every response tells the client to reconnect elsewhere instead of reusing this keep-alive socket
    if (lifecycle.draining) reply.header("Connection", "close");
    if (!reply.hasHeader("Content-Security-Policy")) {
      const url = req.routeOptions.url ?? req.url;
      reply.header("Content-Security-Policy", url.startsWith("/api/v1/docs") ? DOCS_CSP : API_CSP);
    }
    return payload;
  });
  await app.register(cors, {
    origin: [config.ERP_ORIGIN, config.WEB_ORIGIN, config.PORTAL_ORIGIN],
    credentials: false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "If-Match", "If-None-Match", "X-Request-Id"],
    // Deprecation/Sunset/Link (docs/VERSIONING.md) and X-Trace-Id must be readable by cross-origin browser clients too (dev servers)
    exposedHeaders: ["X-Request-Id", "Idempotent-Replayed", "Retry-After", "ETag", "X-Response-Time", "X-Trace-Id", "Deprecation", "Sunset", "Link"],
    maxAge: 600,
  });
  await app.register(compress, { global: true, threshold: 1024, encodings: ["br", "gzip", "deflate"] });
  await app.register(etag);
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 0,
    maxRssBytes: 0,
    maxEventLoopUtilization: 0.98,
    retryAfter: 10,
    exposeStatusRoute: false,
    customError: UnavailableError,
  });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 5 } });
  await app.register(sensible, { sharedSchemaId: undefined });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "KKT API", version: config.APP_VERSION, description: "One backend, three front doors: ERP (staff), customer portal, marketing website." },
      servers: [{ url: config.API_PUBLIC_URL }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Staff access token (aud=erp)" }, portalBearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Customer access token (aud=portal)" } } },
    },
    transform: jsonSchemaTransform,
  });
  // staticCSP off: the docs pages get DOCS_CSP from the onSend hook above (swagger-ui's own policy forced upgrade-insecure-requests and
  // blocked its inline styles)
  await app.register(swaggerUi, { routePrefix: "/api/v1/docs", staticCSP: false, uiConfig: { docExpansion: "list", persistAuthorization: true } });

  if (opts.offline) {
    await app.register(offlineDbPlugin);
    await app.register(offlineRedisPlugin);
  } else {
    await app.register(dbPlugin);
    await app.register(redisPlugin);
    dbPoolMax.set(config.DATABASE_POOL_MAX + (config.DATABASE_REPLICA_URL ? Math.max(2, Math.floor(config.DATABASE_POOL_MAX / 2)) : 0));
  }
  await app.register(requestContextPlugin);
  // telemetry before auth: RED metrics for every request, and a METRICS_TOKEN scrape is answered before staff authentication runs
  await app.register(telemetryPlugin);
  await app.register(errorReporterPlugin);
  await app.register(loadShedPlugin);
  await app.register(authPlugin);
  await app.register(idempotencyPlugin);

  await systemModule(app);
  await app.register(async (api) => {
    await authModule(api);
    await usersModule(api);
    await rolesModule(api);
    await mastersModule(api);
    await notificationsModule(api);
    await searchModule(api);
    await auditModule(api);
    if (opts.extraRoutes) await opts.extraRoutes(api);
  }, { prefix: "/api/v1" });
  // Business modules (inventory, crm, money, …) live in src/modules/<name>/index.ts and are auto-discovered;
  // KKT_MODULES=a,b restricts the set (used by per-module test runs).
  await registerDiscoveredModules(app, "/api/v1");

  return app;
}
