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
RUN pnpm install --frozen-lockfile --filter @kkt/web... && pnpm --filter @kkt/web build
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
