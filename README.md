# Plan Desk

**Local-first, self-hostable planning workspace** — canvas + docs-on-nodes + tasks + board + MCP for product teams and agent workflows.

Plan Desk is a graph-native planning app you run on your machine: map dependencies on a flow canvas, attach specs to nodes, track status on a board, and let Claude Code or Codex read and update the plan over MCP. Data stays in a local SQLite workspace; export/import keeps projects portable.

## Quickstart

From the repo root (Node ≥ 20, [pnpm](https://pnpm.io) 10):

```bash
pnpm install && pnpm build
export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
plandesk init
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). Create a project in the UI, or import the dogfood fixture (below).

The workspace database defaults to `~/.plandesk/workspace.db`. Override with `--data-dir` or `PLANDESK_DATA_DIR`.

## Self-host (Docker)

Build and run on port 3847:

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose up --build
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

**Auth required for non-loopback bind:** Docker sets `PLANDESK_HOST=0.0.0.0`. You must set `PLANDESK_AUTH_PASSWORD` (via `.env` or the environment) or the server refuses to start. Loopback dev (`plandesk serve` on `127.0.0.1`) does not require a password.

Data persists in the `plandesk-data` Docker volume (`PLANDESK_DATA_DIR=/data` in the container).

## Connect an agent

Two steps: wire MCP credentials, then teach the agent repo conventions.

### Option A — `plandesk connect` (recommended)

With `plandesk serve` running, from a codebase you want bound to a Plan Desk project:

```bash
export PATH="$PWD/../plandesk/packages/plandesk-cli/bin:$PATH"   # adjust if needed
plandesk connect --project "Checkout Revamp"
```

`connect` writes (idempotent — safe to re-run):

| Path                          | Committed?          | Purpose                                                       |
| ----------------------------- | ------------------- | ------------------------------------------------------------- |
| `.plandesk/config.json`       | yes                 | Pins repo → project (`projectId`, server URL)                 |
| `.plandesk/skill.md`          | yes                 | Agent conventions ([full skill](docs/skills/plandesk-mcp.md)) |
| `.plandesk/token`             | **no** (gitignored) | Raw MCP bearer token                                          |
| `.mcp.json`                   | yes                 | MCP server entry using `${PLANDESK_MCP_TOKEN}`                |
| `CLAUDE.md` / `AGENTS.md`     | yes                 | Sentinel block `@.plandesk/skill.md`                          |
| `.codex/commands/plandesk.md` | yes                 | Codex command → skill file                                    |

Source the token before starting an agent session:

```bash
export PLANDESK_MCP_TOKEN="$(cat .plandesk/token)"
```

Start a **new** agent session so MCP tools reload.

Dry-run without writing files: `plandesk connect --print`.

Remove binding: `plandesk disconnect`.

See [docs/mcp-setup.md](docs/mcp-setup.md) for the full Claude Code + Codex flow.

### Option B — Manual MCP registration

Create a token (CLI or **Settings → MCP** in the UI), then register the server:

```bash
# CLI
plandesk token create --name "Claude Code"

# Claude Code
claude mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer <token>"

# Codex
codex mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer <token>"
```

Add the [Plan Desk skill](docs/skills/plandesk-mcp.md) to your repo (or copy from `.plandesk/skill.md` after `connect`).

## Dogfood demo

Import a sample checkout-revamp plan (canvas, labeled edges, linked docs, agent run):

```bash
plandesk import --in examples/checkout-revamp.json
```

The command prints the new project UUID. Open it in the UI, then run `plandesk connect --project "Checkout Revamp"` from a repo to let an agent inspect and update tasks over MCP.

## CLI reference

```
plandesk init [--data-dir <dir>]
plandesk serve [--port 3847] [--host <addr>] [--data-dir <dir>]
plandesk token create --name <name> [--data-dir <dir>]
plandesk export --project <id> --out <file.json> [--data-dir <dir>]
plandesk import --in <file.json> [--data-dir <dir>]
plandesk connect [--repo <dir>] [--project <id|name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
plandesk disconnect [--repo <dir>]
plandesk doctor [--data-dir <dir>] [--repo <dir>]
```

| Command                  | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `init`                   | Create workspace DB and run migrations                              |
| `serve`                  | Start REST + SSE + MCP + web UI (default `127.0.0.1:3847`)          |
| `token create`           | Create MCP bearer token (shown once)                                |
| `export` / `import`      | Lossless `plandesk-export-v1` JSON round-trip                       |
| `connect` / `disconnect` | Bind / unbind a repo to a project + agent configs                   |
| `doctor`                 | Check DB health; with `--repo`, validate binding + MCP reachability |

Environment variables:

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | `~/.plandesk` | Workspace directory                        |
| `PLANDESK_HOST`          | `127.0.0.1`   | Bind address                               |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | Required when binding non-loopback         |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Bearer token for `.mcp.json` env expansion |

## Architecture

Monorepo layout:

```
apps/plandesk-web/          React SPA (canvas, docs, board, settings)
packages/plandesk-api/      Hono REST + SSE
packages/plandesk-db/       SQLite schema + Drizzle migrations
packages/plandesk-mcp/      MCP server (Streamable HTTP, 10 tools)
packages/plandesk-cli/      plandesk binary (init, serve, connect, …)
packages/plandesk-mcp-client/  Factory Desk / programmatic MCP consumer
```

Product design and interfaces: [Plan Desk RFC](../plandesk-rfc/README.md).

## Metrics

v1 performance targets are measured in [METRICS.md](METRICS.md) (`pnpm metrics`). Summary (localhost, Apple M1 Pro, Node 22):

| Metric                     | Target   | Measured |
| -------------------------- | -------- | -------- |
| Cold start → first project | < 5 s    | 0.42 s   |
| MCP list + inspect p95     | < 2 s    | 4.9 ms   |
| SSE task update p95        | < 500 ms | 1.9 ms   |
| Export/import              | lossless | pass     |

## Validation

Run the full test suite and live validation commands (health, serve, MCP list tools):

```bash
pnpm test
pnpm validate
```

`pnpm validate` runs `scripts/validate.sh` against an ephemeral `plandesk serve` instance.

## Development

```bash
pnpm build          # compile all packages + web assets
pnpm test           # unit + integration tests
pnpm lint           # ESLint + Prettier
pnpm format         # apply Prettier
```

## License

Private / see repository owner.
