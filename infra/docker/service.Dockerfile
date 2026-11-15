# syntax=docker/dockerfile:1
# Image of one Node service of the workspace (services/* or apps/gateway).
#   docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=services/identity -t heatmap/identity .
#
# There is no build step: Node runs the TypeScript sources directly (type stripping). Node does
# not strip types under node_modules, so the workspace layout is kept: @heatmap/* packages stay
# symlinks into packages/ and only third-party code lives in node_modules.
ARG NODE_VERSION=24.12.0

# ---------------------------------------------------------------- dependencies (production only)
FROM node:${NODE_VERSION}-alpine AS deps
ARG SERVICE
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/common/package.json packages/common/
COPY packages/contracts/package.json packages/contracts/
COPY ${SERVICE}/package.json ${SERVICE}/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "{./${SERVICE}}..."

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=root:root /app /app
COPY --chown=root:root packages/common/src packages/common/src
COPY --chown=root:root packages/contracts/src packages/contracts/src
COPY --chown=root:root ${SERVICE}/src ${SERVICE}/src
# Sources are owned by root and read-only for the process user.
USER node
WORKDIR /app/${SERVICE}
ENV HOST=0.0.0.0
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/ready" || exit 1
CMD ["node", "--import", "@heatmap/common/otel", "src/main.ts"]
