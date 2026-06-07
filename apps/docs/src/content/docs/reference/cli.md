---
title: CLI Reference
description: plandesk commands — init, serve, token, export, import, connect, disconnect, doctor.
---

Install the CLI globally from npm (Node ≥ 20):

```bash
npm i -g @plandesk/cli
```

This provides the `plandesk` binary and bundles the web UI. All commands below assume a global install. Contributors running from a cloned repo can use `packages/plandesk-cli/bin/plandesk` instead.

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

## Commands

| Command                  | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `init`                   | Create workspace DB and run migrations                              |
| `serve`                  | Start REST + SSE + MCP + web UI (default `127.0.0.1:3847`)          |
| `token create`           | Create MCP bearer token (shown once)                                |
| `export` / `import`      | Lossless `plandesk-export-v1` JSON round-trip                       |
| `connect` / `disconnect` | Bind / unbind a repo to a project + agent configs                   |
| `doctor`                 | Check DB health; with `--repo`, validate binding + MCP reachability |

## Options

| Flag         | Default                 | Purpose                                   |
| ------------ | ----------------------- | ----------------------------------------- |
| `--data-dir` | `~/.plandesk`           | Workspace directory (`PLANDESK_DATA_DIR`) |
| `--repo`     | cwd                     | Target repository directory               |
| `--port`     | `3847`                  | HTTP port for serve                       |
| `--host`     | `127.0.0.1`             | Bind address (`PLANDESK_HOST`)            |
| `--project`  | —                       | Project id or name for connect/export     |
| `--url`      | `http://127.0.0.1:3847` | Plan Desk server URL for connect          |
| `--token`    | —                       | MCP token for connect                     |
| `--agent`    | detect                  | Agent config target for connect           |
| `--print`    | —                       | Dry-run connect without writing files     |
| `--out`      | —                       | Output file for export                    |
| `--in`       | —                       | Input file for import                     |

## Environment variables

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | `~/.plandesk` | Workspace directory                        |
| `PLANDESK_HOST`          | `127.0.0.1`   | Bind address                               |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | Required when binding non-loopback         |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Bearer token for `.mcp.json` env expansion |

## Validation and metrics

```bash
pnpm validate   # live health, serve, MCP list-tools smoke
pnpm metrics    # v1 performance targets (see Validation & Metrics)
```
