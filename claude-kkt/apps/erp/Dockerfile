FROM node:22-alpine AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/erp ./apps/erp
RUN pnpm install --frozen-lockfile --filter @kkt/erp... && pnpm --filter @kkt/erp build
FROM nginx:1.27-alpine
COPY apps/erp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/erp/dist /usr/share/nginx/html
