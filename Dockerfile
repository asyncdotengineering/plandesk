# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm build
# NOTE: `pnpm prune --prod` is intentionally NOT used — in this workspace it
# deletes the per-package node_modules/@plandesk/* symlinks, which breaks
# `@plandesk/db` resolution at runtime. We accept a slightly larger image to
# keep workspace resolution intact (still one slim, non-root container).

FROM node:22-slim AS runtime

RUN groupadd --system plandesk \
  && useradd --system --gid plandesk --home-dir /app plandesk \
  && mkdir -p /data \
  && chown plandesk:plandesk /data

WORKDIR /app

# Copy the root store (node_modules/.pnpm) and the full package trees. Each
# package's node_modules holds pnpm workspace symlinks (@plandesk/* + deps)
# that resolve into the root .pnpm store — cherry-picking only dist/ breaks
# `@plandesk/db` resolution at runtime. Dev deps were already pruned above.
COPY --from=build --chown=plandesk:plandesk /app/node_modules ./node_modules
COPY --from=build --chown=plandesk:plandesk /app/package.json ./package.json
COPY --from=build --chown=plandesk:plandesk /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=plandesk:plandesk /app/packages ./packages
COPY --from=build --chown=plandesk:plandesk /app/apps/plandesk-web/dist ./apps/plandesk-web/dist

ENV NODE_ENV=production
ENV PLANDESK_DATA_DIR=/data

USER plandesk

EXPOSE 3847

CMD ["node", "packages/plandesk-cli/bin/plandesk", "serve", "--host", "0.0.0.0"]
