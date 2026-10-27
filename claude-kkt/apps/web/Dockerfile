# syntax=docker/dockerfile:1.7
# Marketing website: Next.js standalone server (port 3000), non-root.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# Public URLs are inlined into client bundles and image remotePatterns at build time,
# so pass them as build args (docker-compose: build.args) — they can still be overridden at runtime for server code.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_PORTAL_URL=http://localhost:8081
ARG NEXT_PUBLIC_ERP_URL=http://localhost:5173
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_PORTAL_URL=$NEXT_PUBLIC_PORTAL_URL \
    NEXT_PUBLIC_ERP_URL=$NEXT_PUBLIC_ERP_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @kkt/web... && pnpm --filter @kkt/web build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tini && addgroup -S -g 10001 kkt && adduser -S -u 10001 -G kkt -h /app kkt
WORKDIR /app
COPY --from=build --chown=kkt:kkt /repo/apps/web/.next/standalone ./
COPY --from=build --chown=kkt:kkt /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=kkt:kkt /repo/apps/web/public ./apps/web/public
# hash-based CSP of ISR pages (see apps/web/csp-hook.cjs): loaded before Next.js creates its HTTP server
COPY --from=build --chown=kkt:kkt /repo/apps/web/csp-hook.cjs ./apps/web/csp-hook.cjs
USER kkt
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--require", "./apps/web/csp-hook.cjs", "apps/web/server.js"]
