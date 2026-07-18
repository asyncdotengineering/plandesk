---
title: CLI Reference
description: plandesk commands — workspace, authentication, project, and collaboration operations.
---

Install the CLI globally from npm (Node ≥ 20):

```bash
npm i -g @plandesk/cli
```

This provides the `plandesk` binary and bundles the web UI. All commands below assume a global install. Contributors running from a cloned repo can use `packages/plandesk-cli/bin/plandesk` instead.

```
plandesk help [--commands]
plandesk init [--data-dir <dir>] [--local-db]
plandesk login [--server <url>]
plandesk logout
plandesk whoami
plandesk serve [--port <n>] [--strict-port] [--host <addr>] [--data-dir <dir>] [--config <file>]
plandesk migrate [--db <url>] [--db-token <token>] [--data-dir <dir>]   # run schema migrations (local or remote DB)
plandesk url [--repo <dir>] [--lan]
plandesk export --project <id> --out <file.json> [--data-dir <dir>]
plandesk import --in <file.json> [--data-dir <dir>]
plandesk legacy-upgrade [--from <old-workspace.db>] [--data-dir <dir>] [--into-workspace <name>]
plandesk admin invite-owner --email <email> [--data-dir <dir>]                       # self-host first owner (local)
plandesk admin invite-owner --email <email> --db <url> [--db-token <t>] [--secret <s>] # remote (Turso) first owner
plandesk workspace create <name> [--to <org>] [--repo <dir>]
plandesk workspace list [--to <org>] [--repo <dir>]
plandesk connect [--repo <dir>] [--project <id|name>] [--workspace <name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
plandesk connect --to <org> [--project <id|name>] [--workspace <name>] [--repo <dir>] [--print]
plandesk go-online [--to <org>] [--server <url>] [--token <key>] [--all | --workspace <name>...] [--data-dir <dir>]   # push local workspaces + projects to a hosted org (requires login)
plandesk disconnect [--repo <dir>]
plandesk doctor [--data-dir <dir>] [--repo <dir>]
plandesk factory init [--repo <dir>] [--print] [--force]
plandesk factory sync [--write] [--force] [--repo <dir>]

# Collaboration (share a project with a client or team)
plandesk push --to <org-id> [--project <id>] [--repo <dir>]
plandesk pull [--project <id>] [--repo <dir>]
plandesk share create --audience <name> [--public] [--invite <email[,email]>] [--allow-submit] [--expires <30d>] [--project <id>]
plandesk deploy [target]
```

## Commands

| Command                  | Purpose                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `<file.md\|.html>` / `open` | Preview & annotate files in the browser (see [Preview & annotate](#preview--annotate)); glob-friendly (`plandesk *.md`) |
| `help`                   | A crash course (orientation + key commands + doc links) for humans and agents; `help --commands` prints the full grammar |
| `init`                   | Create workspace DB, run migrations, and record the board's fixed port (`7526`) in `.plandesk/workspace.json`           |
| `login`                  | Paste a CLI token from the dashboard (owner key) into `~/.plandesk/config.json` (`{ server, token, orgId }`); optional `--server <url>` |
| `logout`                 | Remove the global hosted-server credentials |
| `whoami`                 | Print the configured hosted server and organization |
| `serve`                  | Start REST + MCP + web UI; reads the port from `workspace.json` if no `--port` flag is given                            |
| `url`                    | Print the server URL for this project (`$(plandesk url)` in scripts); `--lan` returns the LAN IP instead of loopback    |
| `export` / `import`      | Lossless `plandesk-export-v1` JSON round-trip                                                                            |
| `legacy-upgrade`         | One-time: lift a pre–better-auth (0.20.x-era) `workspace.db` into the current global board — imports projects/tasks/documents/edges/notes/comments/agent runs, backs up the source file, safe to re-run. `--into-workspace <name>` lands all of an old board's projects in **one workspace** (created if missing; defaults the name to the source folder). See [Upgrading](/reference/upgrading/#the-020x--better-auth-upgrade-breaking) |
| `admin invite-owner`     | Bootstrap the first org owner of a self-hosted instance without GitHub — mints a link-only owner invitation to deliver by hand. Local uses `--data-dir`; **remote** (Turso/libSQL) uses `--db <url> [--db-token]` plus `--secret` (or `PLANDESK_BETTER_AUTH_SECRET`) matching the deployed instance — run `plandesk migrate` against the remote DB first |
| `connect` / `disconnect` | Bind / unbind a repo to a project **or workspace** + agent configs; re-run `connect` after upgrading to regenerate artifacts. `--project` binds one project; `--workspace <name>` binds a whole workspace (writes a `plandesk-connect-v2` config). Hosted: `connect --to <org>` mints a scoped agent key (requires prior `login`) — workspace-scoped with `--workspace`, project-scoped otherwise |
| `workspace create <name>`| Create a workspace (better-auth team) in an org. Local by default (no login); `--to <org>` targets a hosted org (requires `login`). See [Workspaces](/reference/workspaces/) |
| `workspace list`         | List workspaces in an org (`--to <org>` for hosted) |
| `go-online`              | Push one or more **local** workspaces + their projects up to a hosted org (`--to <org>`), creating each hosted workspace if missing. `--all` for every local workspace, repeat `--workspace <name>` to select, or pick interactively. Idempotent: existing same-named projects are skipped. Requires `login`; see [Take a local board online](/guides/going-online/) |
| `doctor`                 | Check DB health; with `--repo`, validate binding + MCP reachability                                                      |
| `factory init`           | Scaffold the project-local `.agents/` factory workspace (policy files + command adapters); see [Factory workspace](/reference/factory/) |
| `version`                | Print the installed CLI version (also `--version`); see [Upgrading](/reference/upgrading/)                              |

## Preview & annotate

`plandesk <file.md>` (or `.markdown` / `.html` / `.htm`) opens a local browser previewer for files your agent wrote — design docs, RFCs, reports, or self-contained HTML artifacts. Shell globs work: `plandesk *.md` opens every match as tabs. The explicit form is `plandesk open <paths…>` (aliases: `preview`, `annotate`); flags: `--port <n>`, `--host <addr>`, `--no-open` (don't launch the browser).

```sh
plandesk report.md              # one file
plandesk *.md                   # all matches, as tabs
plandesk open docs/design.html  # a self-contained HTML artifact
```

**How it renders (the Claude-artifact model).** Markdown renders inside a `sandbox="allow-same-origin"` iframe with **no** `allow-scripts` — any script the markdown injected cannot execute, yet the page can still annotate the text. Self-contained HTML renders inside `sandbox="allow-scripts"` (no same-origin) under a network-dead Content-Security-Policy (`connect-src 'none'`, sent as a header and injected as a `<meta>` that survives JS tampering). Only the files you explicitly open are served — no directory traversal. The server binds loopback by default.

Markdown gets **syntax-highlighted code** (Shiki, light/dark), **Mermaid diagrams** (```mermaid``` blocks), and **styled GFM tables**. Highlighting is done at render time so the reader stays script-free; Mermaid renders in the previewer's parent page and injects static SVG into the sandboxed reader iframe, and its bundle is served locally and lazy-loaded only when a diagram is present.

**Annotate.** Select text in the preview → **Add note**. The note (with a W3C text-quote + position selector) appears in the side rail; resolve it or click it to jump to the passage. Annotations persist and re-open — keyed by the file's path, with a content hash to flag drift.

**Agent loop on files.** Inside a **connected repo**, annotations route to the workspace DB via the artifact-comments API, so your coding agent reads and resolves them over MCP (`list_artifact_comments` / `add_artifact_comment` / `resolve_comment`) — the same "you mark, the agent resolves" loop, now on any file the agent wrote. Standalone (no workspace), they persist to a local sidecar under `~/.plandesk/annotations/`. The startup line states which store is in use.

## Hosted login and connect (two-actor)

Local setup needs no account (`init` → `serve` → `connect --project`). Hosted orgs use a **human + agent** split:

1. **Human** opens the dashboard (signed in via GitHub), clicks **Generate CLI token**, copies the org-wide owner key (shown once).
2. **Human** runs `plandesk login` (or `plandesk login --server https://your-host.example`) and pastes the token when prompted. Credentials land in `~/.plandesk/config.json` as `{ server, token, orgId }`.
3. **Agent (or human)** runs `plandesk connect --to <org> [--project <id|name>]`. That mints a **project-scoped agent key** and writes it to `.plandesk/token` (gitignored). MCP loads it via `${PLANDESK_MCP_TOKEN:-$(cat .plandesk/token)}`.

Agents never run `login`. The owner key stays on the human machine; only the scoped key is in the repo’s ignored token file. There is no `--org` flag — use `--to <org>`.

## Workspaces

A **workspace** groups projects, members, agent keys, and client shares — see [Workspaces](/reference/workspaces/). The CLI surface:

```bash
plandesk workspace create "Fiji TV"               # local; --to <org> for hosted
plandesk workspace list
plandesk connect --workspace "Fiji TV"            # bind a repo to a whole workspace
plandesk connect --to <org> --workspace "Fiji TV" # hosted: mint a workspace-scoped key
plandesk go-online --to <org> --all               # push every local workspace up
plandesk go-online --to <org> --workspace "Fiji TV" --workspace "Acme"
plandesk legacy-upgrade --into-workspace "Fiji TV"  # one old board → one workspace
```

`connect --workspace` writes a `plandesk-connect-v2` config (`{ serverUrl, orgId, workspaceId, workspaceName, projectIds }`) and, on `--to`, mints a **workspace-scoped** key — all projects in that workspace, nothing else. Locally (no `--to`) the loopback owner is used and no token is written. See [plandesk connect](/connecting-agents/connect/).

## Collaboration

Share a planned project with a client or another team over a read-only live portal, and take their issues back into your plan. Full walkthrough: [Plan → share → build with your team](/guides/plan-share-build/); architecture: [Collaboration & sync](/reference/collaboration/).

| Command        | Purpose                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `deploy`       | List deploy guides; `deploy <target>` prints one for a coding agent to run        |
| `push`         | Promote a local project to a hosted org (`--to <org-id>`); one-way                |
| `pull`         | Fetch participant submissions into the local triage inbox                         |
| `share create` | Mint a participant share (token shown once); prints the `<portal>/p/<token>` link |

`share create` flags: `--public` (open named-join) or `--invite a@b,c@d` (invite-only); `--allow-submit` (let the audience file issues); `--expires 30d` (`h`/`d`/`w`). The sync token lives only in git-ignored `.plandesk/sync-token` (or `PLANDESK_SYNC_TOKEN`); participant tokens are stored hashed.

## Options

| Flag            | Default                 | Purpose                                                                    |
| --------------- | ----------------------- | -------------------------------------------------------------------------- |
| `--data-dir`    | nearest `.plandesk/` walking up from cwd, then `PLANDESK_DATA_DIR`, then `~/.plandesk` | Workspace directory |
| `--repo`        | cwd                     | Target repository directory                                                |
| `--port`        | from `workspace.json`, then `7526` | HTTP port for serve; if it's in use, serve fails (one board per machine) — stop the other process or pass a different `--port` |
| `--strict-port` | —                                  | Exit non-zero when the serve port is in use (already the default — one global board, one port) |
| `--host`        | `127.0.0.1`                        | Bind address; LAN exposure is opt-in via `--host 0.0.0.0` or `PLANDESK_HOST` |
| `--lan`         | —                                  | `url` command returns the LAN IP instead of `127.0.0.1`                   |
| `--project`     | —                                  | Project id or name for connect/export                                      |
| `--to`          | —                                  | Hosted org id: `connect --to` mints a scoped agent key (requires `login`); also used by `push`, `go-online`, and `workspace create/list` |
| `--workspace`   | —                                  | (`connect`) bind the repo to a whole workspace, minting a workspace-scoped key on `--to`; (`go-online`) repeatable, select local workspaces to push |
| `--url`         | from `server.json` → `workspace.json` → `http://127.0.0.1:7526` | Plan Desk server URL for connect  |
| `--token`       | —                       | MCP token for connect                                                      |
| `--agent`       | detect                  | Agent config target for connect                                            |
| `--print`       | —                       | Dry-run connect / factory init without writing files                       |
| `--force`       | —                       | `factory init`: scaffold even in a global config dir · `factory sync`: also overwrite customized files |
| `--out`         | —                       | Output file for export                                                     |
| `--in`          | —                       | Input file for import                                                      |
| `--from`        | `~/.plandesk/workspace.db`, else `./.plandesk/workspace.db` | (`legacy-upgrade`) path to the old workspace.db to import |
| `--into-workspace` | (folder name)                  | (`legacy-upgrade`) create and import into a named workspace; pass with no value to default the name to the source folder |
| `--all`         | —                                  | (`go-online`) push every local workspace to the hosted org |
| `--server`      | from `login`                       | (`go-online`) hosted server URL override |
| `--token`       | —                       | (`connect`) MCP token; (`go-online`) hosted owner-key override (otherwise from `login`) |

## Environment variables

| Variable                 | Default       | Purpose                                    |
| ------------------------ | ------------- | ------------------------------------------ |
| `PLANDESK_DATA_DIR`      | (see `--data-dir`) | Workspace directory override          |
| `PLANDESK_HOST`          | `127.0.0.1`   | Bind address (set `0.0.0.0` to expose on the LAN) |
| `PLANDESK_AUTH_PASSWORD` | (unset)       | When set, enables HTTP basic auth on the UI and REST API |
| `PLANDESK_MCP_TOKEN`     | (unset)       | Overrides the token read from `.plandesk/token` |
| `PLANDESK_PORT`          | (see `--port`) | Serve port override |
| `PLANDESK_BETTER_AUTH_SECRET` | (unset)  | better-auth signing secret; required for hosted/non-loopback auth and for remote `admin invite-owner` |
| `PLANDESK_DB_URL` / `PLANDESK_DB_TOKEN` | (unset) | Remote libSQL/Turso URL + token for `plandesk migrate` and hosted serve |
| `PLANDESK_SYNC_TOKEN`    | (unset)       | Legacy remote-pull credential for the sync path |

## Validation and metrics

```bash
pnpm validate   # live health, serve, MCP list-tools smoke
pnpm metrics    # v1 performance targets (see Validation & Metrics)
```
