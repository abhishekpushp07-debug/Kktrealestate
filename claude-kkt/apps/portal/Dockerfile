# syntax=docker/dockerfile:1.7
# Customer portal (web): Expo static export served by unprivileged nginx (port 8080) with CSP and security headers (apps/portal/nginx.conf).
FROM node:22-alpine AS build
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/portal ./apps/portal
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @kkt/portal... && cd apps/portal && npx expo export --platform web

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV CSP_CONNECT_SRC="'self'" \
    NGINX_ENVSUBST_FILTER=^CSP_
COPY apps/portal/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz > /dev/null || exit 1
