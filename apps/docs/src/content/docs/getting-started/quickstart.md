---
title: Quickstart
description: Install Plan Desk, start the server, and open the UI.
---

Node ≥ 20 required.

## Install from npm

```bash
npm i -g @plandesk/cli
plandesk init
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). Create a project in the UI, or import the dogfood fixture below.

The workspace database defaults to the machine-global board at `~/.plandesk/workspace.db` (one board per machine; not committed). `plandesk init --local-db` opts into a repo-local `.plandesk/workspace.db`. Commands that open a workspace prefer an existing repo-local db if present, otherwise the global board. Override with `--data-dir` or `PLANDESK_DATA_DIR`.

## Install from source (contributors)

To hack on the monorepo instead of using the published CLI:

```bash
git clone https://github.com/asyncdotengineering/plandesk
cd plandesk
pnpm install && pnpm build
export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
plandesk init
plandesk serve
```

## Dogfood demo

Import a sample checkout-revamp plan (canvas, labeled edges, linked docs, agent run):

```bash
plandesk import --in examples/checkout-revamp.json
```

The command prints the new project UUID. Open it in the UI, then run `plandesk connect --project "Checkout Revamp"` from a repo to let an agent inspect and update tasks over MCP.

## Next steps

- [Your first project](/getting-started/first-project/) — plan on the canvas, attach specs, use the board
- [From idea to development with Claude Code](/guides/idea-to-development/) — let Claude plan it, then build it from the live plan
- [Plan & execute a project](/guides/plan-and-execute/) — connect an agent and work from the live plan

## Development

From a cloned repo:

```bash
pnpm build          # compile all packages + web assets
pnpm test           # unit + integration tests
pnpm lint           # ESLint + Prettier
pnpm format         # apply Prettier
```
