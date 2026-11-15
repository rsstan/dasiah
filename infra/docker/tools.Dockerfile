# syntax=docker/dockerfile:1
# Workspace with all dependencies (dev included) and psql, for one-shot and test-only jobs of the
# `full` Compose profile: database initialisation (infra/compose/init.sh) and the OSRM and
# geocoder stubs. Never used for the services themselves (infra/docker/service.Dockerfile).
#   docker build -f infra/docker/tools.Dockerfile -t heatmap/tools .
ARG NODE_VERSION=24.12.0
FROM node:${NODE_VERSION}-alpine
RUN apk add --no-cache bash postgresql-client
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/common/package.json packages/common/
COPY packages/contracts/package.json packages/contracts/
COPY packages/testing/package.json packages/testing/
COPY services/transit-data/package.json services/transit-data/
COPY services/accessibility/package.json services/accessibility/
COPY services/places/package.json services/places/
# The grid CLI and the two stubs with their dependencies; the root's own dependencies (db
# tooling: pg, node-pg-migrate, h3-js) are always installed with the workspace root.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@heatmap/transit-data..." \
      --filter "@heatmap/accessibility..." --filter "@heatmap/places..."
COPY . .
