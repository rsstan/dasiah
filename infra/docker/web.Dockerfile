# syntax=docker/dockerfile:1
# Frontend: Vite build, served by Caddy together with the /api reverse proxy to the gateway
# (one origin for the browser, as in production).
#   docker build -f infra/docker/web.Dockerfile -t heatmap/web .
ARG NODE_VERSION=24.12.0

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@heatmap/web..."
COPY tsconfig.base.json ./
COPY packages/contracts/src packages/contracts/src
COPY apps/web apps/web
ARG VITE_MAP_STYLE_URL=
RUN pnpm --filter @heatmap/web run build

FROM caddy:2.11.9-alpine
COPY infra/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
