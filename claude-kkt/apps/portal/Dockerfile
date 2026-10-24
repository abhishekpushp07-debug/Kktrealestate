FROM node:22-alpine AS build
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/portal ./apps/portal
RUN pnpm install --frozen-lockfile --filter @kkt/portal... && cd apps/portal && npx expo export --platform web
FROM nginx:1.27-alpine
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
