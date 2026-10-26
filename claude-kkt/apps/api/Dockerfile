# syntax=docker/dockerfile:1.7
# KKT API + worker image (one image, two commands). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t kkt-api .
# Runs as a non-root user with production dependencies only; the @kkt/* workspace packages are bundled into dist/ by tsup.
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @kkt/api...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# apps/api/assets holds optional operator overrides (assets/fonts) and may be absent from a clean checkout (git keeps no empty
# directories): create it so the runtime COPY below never fails
RUN mkdir -p apps/api/assets && pnpm --filter @kkt/api build
# production dependencies only (no vitest/tsup/typescript/autocannon in the runtime image)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @kkt/api deploy --prod --legacy /prod/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    API_PORT=4000 \
    METRICS_PORT=9464 \
    API_WORKERS=auto \
    STORAGE_LOCAL_DIR=/data/storage
RUN apk add --no-cache tini \
 && addgroup -S -g 10001 kkt && adduser -S -u 10001 -G kkt -h /app kkt \
 && mkdir -p /data/storage && chown kkt:kkt /data/storage
WORKDIR /app
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/assets ./assets
USER kkt
EXPOSE 4000 9464
# liveness: the process answers HTTP (dependency outages show in /api/v1/ready, not here)
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/api/v1/health" > /dev/null || exit 1
# tini forwards SIGTERM to node (graceful drain) and reaps zombies
ENTRYPOINT ["/sbin/tini", "--"]
# tracing is preloaded with --import (a no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set)
CMD ["node", "--import", "./dist/telemetry.js", "dist/server.js"]
# other commands of the same image:
#   migrate job:  node dist/server.js migrate
#   worker:       node --import ./dist/telemetry.js dist/worker.js
