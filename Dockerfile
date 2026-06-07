# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-slim AS runtime

RUN groupadd --system plandesk \
  && useradd --system --gid plandesk --home-dir /app plandesk \
  && mkdir -p /data \
  && chown plandesk:plandesk /data

WORKDIR /app

COPY --from=build --chown=plandesk:plandesk /app/node_modules ./node_modules
COPY --from=build --chown=plandesk:plandesk /app/package.json ./package.json
COPY --from=build --chown=plandesk:plandesk /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-cli/dist ./packages/plandesk-cli/dist
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-cli/bin ./packages/plandesk-cli/bin
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-cli/package.json ./packages/plandesk-cli/package.json
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-api/dist ./packages/plandesk-api/dist
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-api/package.json ./packages/plandesk-api/package.json
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-db/dist ./packages/plandesk-db/dist
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-db/drizzle ./packages/plandesk-db/drizzle
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-db/package.json ./packages/plandesk-db/package.json
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-mcp/dist ./packages/plandesk-mcp/dist
COPY --from=build --chown=plandesk:plandesk /app/packages/plandesk-mcp/package.json ./packages/plandesk-mcp/package.json
COPY --from=build --chown=plandesk:plandesk /app/apps/plandesk-web/dist ./apps/plandesk-web/dist

ENV NODE_ENV=production
ENV PLANDESK_DATA_DIR=/data

USER plandesk

EXPOSE 3847

CMD ["node", "packages/plandesk-cli/bin/plandesk", "serve", "--host", "0.0.0.0"]
