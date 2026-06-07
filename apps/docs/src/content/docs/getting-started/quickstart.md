---
title: Quickstart
description: Install Plan Desk, start the server, and open the UI.
---

From the repo root (Node ≥ 20, [pnpm](https://pnpm.io) 10):

```bash
pnpm install && pnpm build
export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
plandesk init
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). Create a project in the UI, or import the dogfood fixture below.

The workspace database defaults to `~/.plandesk/workspace.db`. Override with `--data-dir` or `PLANDESK_DATA_DIR`.

## Dogfood demo

Import a sample checkout-revamp plan (canvas, labeled edges, linked docs, agent run):

```bash
plandesk import --in examples/checkout-revamp.json
```

The command prints the new project UUID. Open it in the UI, then run `plandesk connect --project "Checkout Revamp"` from a repo to let an agent inspect and update tasks over MCP.

## Development

```bash
pnpm build          # compile all packages + web assets
pnpm test           # unit + integration tests
pnpm lint           # ESLint + Prettier
pnpm format         # apply Prettier
```
