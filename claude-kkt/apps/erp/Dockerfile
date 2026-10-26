# syntax=docker/dockerfile:1.7
# Staff ERP: static Vite build served by unprivileged nginx (port 8080) with CSP and security headers (apps/erp/nginx.conf).
FROM node:22-alpine AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/erp ./apps/erp
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @kkt/erp... && pnpm --filter @kkt/erp build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# CSP_CONNECT_SRC: origins the ERP may call besides its own (the API is same-origin under /api behind Caddy/Ingress)
ENV CSP_CONNECT_SRC="'self'" \
    NGINX_ENVSUBST_FILTER=^CSP_
COPY apps/erp/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/erp/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz > /dev/null || exit 1
