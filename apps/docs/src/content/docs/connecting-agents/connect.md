---
title: plandesk connect
description: Bind a codebase to a Plan Desk project with commit-safe MCP wiring.
---

`plandesk connect` is the recommended way to wire MCP credentials and teach agent repo conventions — without committing secrets.

With `plandesk serve` running, from a codebase you want bound to a Plan Desk project:

```bash
plandesk connect --project "Checkout Revamp"
```

## What it writes

`connect` is idempotent — safe to re-run:

| Path                                                                    | Committed?          | Purpose                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.plandesk/config.json`                                                 | yes                 | Pins repo → project **or** workspace. `--project`: v1 (`projectId`, `projectName`, `serverUrl`). `--workspace`: `plandesk-connect-v2` (`{ serverUrl, orgId, workspaceId, workspaceName, projectIds }`) |
| `.plandesk/skill.md`                                                    | yes                 | Agent conventions ([The Skill](/connecting-agents/skill/))                                                                                                                                             |
| `.plandesk/token`                                                       | **no** (gitignored) | Scoped agent key — written for a hosted `connect --to` (project- or workspace-scoped); local loopback needs none                                                                                       |
| `.claude/skills/plandesk/SKILL.md` / `.agents/skills/plandesk/SKILL.md` | yes                 | Symlinks → `.plandesk/skill.md` (skill discovery)                                                                                                                                                      |
| `.mcp.json`                                                             | yes                 | MCP server entry with a `headersHelper` that reads the token                                                                                                                                           |
| `CLAUDE.md` / `AGENTS.md`                                               | yes                 | Sentinel block `@.plandesk/skill.md`                                                                                                                                                                   |
| `.codex/commands/plandesk.md`                                           | yes                 | Codex command → skill file                                                                                                                                                                             |

## Workflow

1. Resolves the project (by id or name) **or** workspace (by name) the repo binds to. A workspace bind resolves the workspace and collects **all** of its project ids into `config.json`.
2. **Local (default):** no token — loopback is zero-auth, so `.plandesk/token` is not written unless you pass `--token` explicitly. **Hosted (`--to <org>`):** mints a scoped agent key into `.plandesk/token` (gitignored), using the owner key `plandesk login` stored — **project-scoped** with `--project`, **workspace-scoped** with `--workspace`. A workspace-scoped key reaches every project in that workspace and nothing else in the org.
3. Writes `.plandesk/config.json` (committed project binding).
4. Merges the `plandesk` entry into `.mcp.json`. The entry uses a
   `headersHelper` that reads `.plandesk/token` at connection time, so the
   token works with **zero manual setup** — no `export` needed. Set
   `PLANDESK_MCP_TOKEN` only if you want to override the file.
5. Symlinks the skill into `.claude/skills/plandesk/` and
   `.agents/skills/plandesk/` (created if missing) so agents discover it as a
   skill.
6. Inserts an idempotent sentinel block in `CLAUDE.md` (and `AGENTS.md` if present):

   ```markdown
   <!-- plandesk:start -->

   @.plandesk/skill.md

   <!-- plandesk:end -->
   ```

7. Writes `.codex/commands/plandesk.md` for Codex.

After connecting, start a **new** agent session so MCP tools reload. No token
export is required.

## Options

```
plandesk connect [--repo <dir>] [--project <id|name>] [--workspace <name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
plandesk connect --to <org> [--project <id|name>] [--workspace <name>] [--repo <dir>] [--print]   # hosted: mint a scoped key
```

- `--project <id|name>` — bind the repo to a single project (writes a v1 config).
- `--workspace <name>` — bind the repo to a whole workspace (writes a `plandesk-connect-v2` config). On `--to`, mints a **workspace-scoped** key.
- `--to <org>` — hosted: mint a scoped agent key with the login owner key. Local is the default when `--to` is omitted.
- `--print` — dry-run without writing files.
- `--agent` — target Claude, Codex, or both (default: detect).

A repo already bound to a workspace cannot be silently rebound to a different project/workspace — rebind with an explicit `--project` or `--workspace`.

## Connect to a workspace

`--workspace` is for multi-project engagements — one client or product with several projects. The agent's MCP `list_projects` then returns only that workspace's projects (token-enforced; cross-workspace project ids return 404). See [Workspaces](/reference/workspaces/).

```bash
plandesk connect --workspace "Fiji TV"            # local
plandesk connect --to <org> --workspace "Fiji TV" # hosted: workspace-scoped key
```

The bound config:

```json
{
  "version": "plandesk-connect-v2",
  "serverUrl": "http://127.0.0.1:7526",
  "orgId": "<org-id>",
  "workspaceId": "<team-id>",
  "workspaceName": "Fiji TV",
  "projectIds": ["<project-id>", "<project-id>"]
}
```

## Disconnect

Remove binding: `plandesk disconnect` (does not revoke the token).

## Manual alternative

If you prefer not to use `connect`, see [MCP Setup](/connecting-agents/mcp-setup/) for manual token creation and `claude mcp add` / `codex mcp add` registration.
