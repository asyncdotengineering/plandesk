---
title: CLI Reference
description: plandesk commands — init, serve, url, token, export, import, connect, disconnect, doctor, and the collaboration tier (publish, push, pull, sync, share, deploy).
---

Install the CLI globally from npm (Node ≥ 20):

```bash
npm i -g @plandesk/cli
```

This provides the `plandesk` binary and bundles the web UI. All commands below assume a global install. Contributors running from a cloned repo can use `packages/plandesk-cli/bin/plandesk` instead.

```
plandesk help [--commands]
plandesk init [--data-dir <dir>]
plandesk serve [--port <n>] [--strict-port] [--host <addr>] [--data-dir <dir>]
plandesk url [--repo <dir>] [--lan]
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

| Command                  | Purpose                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `help`                   | A crash course (orientation + key commands + doc links) for humans and agents; `help --commands` prints the full grammar |
| `init`                   | Create workspace DB, run migrations, and assign a project-local port (3400–3499) stored in `.plandesk/workspace.json`   |
| `serve`                  | Start REST + SSE + MCP + web UI; reads the port from `workspace.json` if no `--port` flag is given                      |
| `url`                    | Print the server URL for this project (`$(plandesk url)` in scripts); `--lan` returns the LAN IP instead of loopback    |
| `token create`           | Create MCP bearer token (shown once)                                                                                     |
| `export` / `import`      | Lossless `plandesk-export-v1` JSON round-trip                                                                            |
| `connect` / `disconnect` | Bind / unbind a repo to a project + agent configs; re-run `connect` after upgrading to regenerate artifacts              |
| `doctor`                 | Check DB health; with `--repo`, validate binding + MCP reachability                                                      |
| `version`                | Print the installed CLI version (also `--version`); see [Upgrading](/reference/upgrading/)                              |

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
| `--data-dir`    | nearest `.plandesk/` walking up from cwd, then `PLANDESK_DATA_DIR`, then `~/.plandesk` | Workspace directory |
| `--repo`        | cwd                     | Target repository directory                                                |
| `--port`        | from `workspace.json`, then `3847` | Preferred HTTP port for serve (auto-rotates to the next free port if busy) |
| `--strict-port` | —                                  | Fail instead of rotating when the port is in use                           |
| `--host`        | `0.0.0.0`                          | Bind address (`PLANDESK_HOST`)                                             |
| `--lan`         | —                                  | `url` command returns the LAN IP instead of `127.0.0.1`                   |
| `--project`     | —                                  | Project id or name for connect/export                                      |
| `--url`         | from `server.json` → `workspace.json` → `http://127.0.0.1:3847` | Plan Desk server URL for connect  |
| `--token`       | —                       | MCP token for connect                                                      |
| `--agent`       | detect                  | Agent config target for connect                                            |
| `--print`       | —                       | Dry-run connect without writing files                                      |
| `--out`         | —                       | Output file for export                                                     |
| `--in`          | —                       | Input file for import                                                      |

## Environment variables

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | (see `--data-dir`) | Workspace directory override          |
| `PLANDESK_HOST`          | `0.0.0.0`     | Bind address                               |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | When set, enables HTTP basic auth on the UI and REST API |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Overrides the token read from `.plandesk/token` |

## Validation and metrics

```bash
pnpm validate   # live health, serve, MCP list-tools smoke
pnpm metrics    # v1 performance targets (see Validation & Metrics)
```
