---
title: CLI Reference
description: plandesk commands — init, serve, token, export, import, connect, disconnect, doctor, and the collaboration tier (publish, push, pull, sync, share, deploy).
---

Install the CLI globally from npm (Node ≥ 20):

```bash
npm i -g @plandesk/cli
```

This provides the `plandesk` binary and bundles the web UI. All commands below assume a global install. Contributors running from a cloned repo can use `packages/plandesk-cli/bin/plandesk` instead.

```
plandesk init [--data-dir <dir>]
plandesk serve [--port 3847] [--strict-port] [--host <addr>] [--data-dir <dir>]
plandesk token create --name <name> [--data-dir <dir>]
plandesk export --project <id> --out <file.json> [--data-dir <dir>]
plandesk import --in <file.json> [--data-dir <dir>]
plandesk connect [--repo <dir>] [--project <id|name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
plandesk disconnect [--repo <dir>]
plandesk doctor [--data-dir <dir>] [--repo <dir>]

# Collaboration (share a project with a client or team)
plandesk publish --remote <url> [--project <id>] [--sync-token <t>] [--repo <dir>]
plandesk push [--project <id>] [--repo <dir>]
plandesk pull [--project <id>] [--repo <dir>]
plandesk sync --watch [--project <id>] [--repo <dir>]
plandesk share create --audience <name> [--public] [--invite <email[,email]>] [--allow-submit] [--expires <30d>] [--project <id>]
plandesk deploy [target]
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

## Collaboration

Share a planned project with a client or another team over a read-only live portal, and take their issues back into your plan. Full walkthrough: [Plan → share → build with your team](/guides/plan-share-build/); architecture: [Collaboration & sync](/reference/collaboration/).

| Command        | Purpose                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `deploy`       | List deploy guides; `deploy <target>` prints one for a coding agent to run        |
| `publish`      | Register a project with a sync server + first push (writes git-ignored token)     |
| `push`         | Push the allow-list projection for each active share                              |
| `pull`         | Fetch participant submissions into the local triage inbox                         |
| `sync --watch` | Stream local changes to the portal (~2s) so participants see status live          |
| `share create` | Mint a participant share (token shown once); prints the `<portal>/p/<token>` link |

`share create` flags: `--public` (open named-join) or `--invite a@b,c@d` (invite-only); `--allow-submit` (let the audience file issues); `--expires 30d` (`h`/`d`/`w`). The sync token lives only in git-ignored `.plandesk/sync-token` (or `PLANDESK_SYNC_TOKEN`); participant tokens are stored hashed.

## Options

| Flag            | Default                 | Purpose                                                                    |
| --------------- | ----------------------- | -------------------------------------------------------------------------- |
| `--data-dir`    | `~/.plandesk`           | Workspace directory (`PLANDESK_DATA_DIR`)                                  |
| `--repo`        | cwd                     | Target repository directory                                                |
| `--port`        | `3847`                  | Preferred HTTP port for serve (auto-rotates to the next free port if busy) |
| `--strict-port` | —                       | Fail instead of rotating when the port is in use                           |
| `--host`        | `127.0.0.1`             | Bind address (`PLANDESK_HOST`)                                             |
| `--project`     | —                       | Project id or name for connect/export                                      |
| `--url`         | `http://127.0.0.1:3847` | Plan Desk server URL for connect                                           |
| `--token`       | —                       | MCP token for connect                                                      |
| `--agent`       | detect                  | Agent config target for connect                                            |
| `--print`       | —                       | Dry-run connect without writing files                                      |
| `--out`         | —                       | Output file for export                                                     |
| `--in`          | —                       | Input file for import                                                      |

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
