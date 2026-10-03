# syntax=docker/dockerfile:1
#
# Plan Desk server image: `plandesk serve` plus the web app, built locally.
# The server prepares its own database at boot (a file on /data, or the
# PLANDESK_DB_URL database), so there is no entrypoint script and no migrate step.
#
#   docker build -t plandesk:local .
#   docker compose up --build        (see compose.yaml and .env.example)

FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Only what the server needs: the CLI, its workspace deps and the web SPA.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/plandesk-api/package.json packages/plandesk-api/
COPY packages/plandesk-cli/package.json packages/plandesk-cli/
COPY packages/plandesk-db/package.json packages/plandesk-db/
COPY packages/plandesk-mcp/package.json packages/plandesk-mcp/
COPY packages/plandesk-server/package.json packages/plandesk-server/
COPY apps/plandesk-web/package.json apps/plandesk-web/
RUN pnpm install --frozen-lockfile --filter "@plandesk/cli..." --filter "plandesk-web..."

COPY packages/plandesk-api packages/plandesk-api
COPY packages/plandesk-cli packages/plandesk-cli
COPY packages/plandesk-db packages/plandesk-db
COPY packages/plandesk-mcp packages/plandesk-mcp
COPY packages/plandesk-server packages/plandesk-server
COPY apps/plandesk-web apps/plandesk-web
# The CLI build vendors .agents/ into dist/templates, as for the npm package.
COPY .agents .agents
RUN pnpm --filter "@plandesk/cli..." --filter plandesk-web build
# The CLI as npm installs it (its `files` and production deps), plus the SPA.
RUN pnpm --filter @plandesk/cli deploy --prod --legacy /out \
  && cp -r apps/plandesk-web/dist /out/web

FROM node:22-slim
RUN groupadd --system plandesk \
  && useradd --system --gid plandesk --home-dir /app plandesk \
  && mkdir -p /data && chown plandesk:plandesk /data
WORKDIR /app
COPY --from=build /out ./

ENV NODE_ENV=production \
    PLANDESK_WEB_DIST=/app/web \
    PLANDESK_DATA_DIR=/data \
    PLANDESK_STATE_DIR=/data \
    PLANDESK_PORT=7526
USER plandesk
VOLUME /data
EXPOSE 7526
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7526/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Any plandesk command runs too: `docker compose run --rm plandesk doctor`.
ENTRYPOINT ["node", "bin/plandesk"]
CMD ["serve", "--host", "0.0.0.0"]
