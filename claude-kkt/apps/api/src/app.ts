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
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { recordRequest } from "./lib/metrics.js";
import { installRouteRegistry } from "./lib/routes.js";
import { auditModule } from "./modules/audit/index.js";
import { registerDiscoveredModules } from "./modules/loader.js";
import { authModule } from "./modules/auth/index.js";
import { mastersModule } from "./modules/masters/index.js";
import { notificationsModule } from "./modules/notifications/index.js";
import { rolesModule } from "./modules/roles/index.js";
import { searchModule } from "./modules/search/index.js";
import { systemModule } from "./modules/system/index.js";
import { usersModule } from "./modules/users/index.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import idempotencyPlugin from "./plugins/idempotency.js";
import loadShedPlugin from "./plugins/loadShed.js";
import redisPlugin from "./plugins/redis.js";
import requestContextPlugin, { genReqId } from "./plugins/requestContext.js";

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
}

/** Builds the fully configured Fastify application (plugins, modules under /api/v1, error envelope). Does not listen. */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    ...(opts.logger === false ? { logger: false } : opts.logger === true || opts.logger === undefined ? { loggerInstance: logger } : { loggerInstance: opts.logger }),
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

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, hsts: config.NODE_ENV === "production" });
  await app.register(cors, {
    origin: [config.ERP_ORIGIN, config.WEB_ORIGIN, config.PORTAL_ORIGIN],
    credentials: false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "If-Match", "If-None-Match", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Idempotent-Replayed", "Retry-After", "ETag", "X-Response-Time"],
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
  await app.register(swaggerUi, { routePrefix: "/api/v1/docs", staticCSP: true, uiConfig: { docExpansion: "list", persistAuthorization: true } });

  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(requestContextPlugin);
  await app.register(loadShedPlugin);
  await app.register(authPlugin);
  await app.register(idempotencyPlugin);

  app.addHook("onResponse", async (req, reply) => {
    recordRequest(req.routeOptions.url ?? "unmatched", req.method, reply.statusCode, reply.elapsedTime / 1000);
  });

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
