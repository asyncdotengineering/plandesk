---
title: Take a local board online
description: Move a project you've been planning locally into a hosted Plan Desk organization — managed or self-hosted — and bind your repo to it.
---

Plan Desk is local-first by default: `plandesk init && plandesk serve` runs entirely on your machine, no account, no network. Going online is an opt-in step you take when you want your board reachable from somewhere other than `127.0.0.1` — for a teammate, another machine, or just to stop worrying about backups.

This guide takes work you've already been planning locally — a single project or a whole **workspace** of them — and promotes it into a hosted organization. Plan Desk's tenancy is Org → Workspace → Project; see [Workspaces](/reference/workspaces/).

## 1. Pick a hosted home

You have two options, and they use the exact same CLI flow:

- **Managed** — sign in at `plandesk.asyncdot.com`. asyncdot runs the server; you bring nothing but a browser and a GitHub account.
- **Self-hosted** — stand up your own instance (Docker or Cloudflare Workers) and point the same commands at it with `--server <your-url>`. See [Self-host Plan Desk for your team](./self-host-for-teams/) for the full runbook, or the [deployment topologies](/self-hosting/topologies/) overview if you're still deciding.

Everything below reads the same either way — swap in your own server URL wherever `plandesk login` appears.

## 2. Sign in and get a CLI token

Open the hosted dashboard and sign in with **GitHub**. The first time you sign in, Plan Desk auto-provisions a personal organization for you — you're its owner, with nothing to configure.

Once signed in, go to **Settings → MCP → Generate CLI token** and copy the org-wide owner key. It's shown once — store it somewhere safe before you navigate away.

## 3. `plandesk login`

Back in your terminal:

```bash
plandesk login --server <your-hosted-url>
```

Omit `--server` to use the built-in default (`https://plandesk.asyncdot.com`). Paste the token when prompted. It's written to `~/.plandesk/config.json` alongside the server URL and your organization id — this is a one-time, per-machine step, not per-repo.

## 4. Promote your local work

You have two paths. Use `go-online` when you've organized your work into **workspaces** — it carries the whole structure up. Use `push` for a single project.

### Take a whole workspace online (`go-online`)

`plandesk go-online` pushes one or more **local** workspaces — and every project in them — up to a hosted org, creating each hosted workspace if it doesn't exist yet. It's **idempotent**: re-running skips projects whose names already exist in the destination workspace.

```bash
plandesk go-online --to <org-id> --all                         # every local workspace
plandesk go-online --to <org-id> --workspace "Fiji TV" --workspace "Acme"   # just these
plandesk go-online --to <org-id>                                # pick interactively
```

On success it reports how many workspaces and projects it pushed, plus per-workspace counts. `--to <org-id>` is required; the server and owner token come from `plandesk login` (override with `--server` / `--token`). Because projects import into the org-default workspace and are then moved into their target workspace, each hosted project's `workspace_id` matches its team.

### Promote a single project (`push`)

For a one-off project that isn't part of a workspace, from the repo where it has been living locally:

```bash
plandesk push --to <org-id>
```

`push` requires `--to <org-id>` — there's no ambient "current org," you always say which one. On success it prints:

```
Promoted to org <orgId> as <globalProjectId> on <serverUrl>.
```

The server URL it promotes to comes from `.plandesk/config.json`'s `serverUrl` if the repo is already connected, otherwise from `--remote`/`--url`, falling back to the server you logged into. The token comes from `plandesk login`. This is a one-way promotion — your local project's full plan (tasks, edges, documents, notes, comments) is copied into the hosted org as a new project.

## 5. Bind the repo for your agent

Your coding agent still needs a way to reach the board over MCP — and it should never hold your owner key. Mint it a scoped one:

```bash
plandesk connect --to <org-id> --project <id|name>      # one project: project-scoped key
plandesk connect --to <org-id> --workspace "Fiji TV"    # whole workspace: workspace-scoped key
```

This mints a **scoped agent key** (not your owner key) and writes it to `.plandesk/token` (gitignored) — project-scoped with `--project`, workspace-scoped with `--workspace`. `.mcp.json` reads it automatically. Start a new agent session afterward so MCP tools reload.

## You're online

Your board now lives in the hosted org, and your agent talks to it with a key scoped to just this project. From here:

- Working solo, self-hosted or managed — you're done.
- Bringing a team onto a shared, always-on instance — continue to [Self-host Plan Desk for your team](./self-host-for-teams/) to invite them and connect their repos.
