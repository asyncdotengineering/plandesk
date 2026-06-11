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

| Path                                                             | Committed?          | Purpose                                                    |
| ---------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `.plandesk/config.json`                                          | yes                 | Pins repo → project (`projectId`, server URL)              |
| `.plandesk/skill.md`                                             | yes                 | Agent conventions ([The Skill](/connecting-agents/skill/)) |
| `.plandesk/token`                                                | **no** (gitignored) | Raw MCP bearer token                                       |
| `.claude/skills/plandesk/SKILL.md` / `.agents/skills/plandesk/SKILL.md` | yes          | Symlinks → `.plandesk/skill.md` (skill discovery)          |
| `.mcp.json`                                                      | yes                 | MCP server entry with a `headersHelper` that reads the token |
| `CLAUDE.md` / `AGENTS.md`                                        | yes                 | Sentinel block `@.plandesk/skill.md`                       |
| `.codex/commands/plandesk.md`                                    | yes                 | Codex command → skill file                                 |

## Workflow

1. Resolves the project (by id or name).
2. Creates or reuses an MCP token in `.plandesk/token` (gitignored).
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
plandesk connect [--repo <dir>] [--project <id|name>] [--url <url>] [--token <token>] [--agent claude|codex|both] [--print]
```

- `--print` — dry-run without writing files
- `--agent` — target Claude, Codex, or both (default: detect)

## Disconnect

Remove binding: `plandesk disconnect` (does not revoke the token).

## Manual alternative

If you prefer not to use `connect`, see [MCP Setup](/connecting-agents/mcp-setup/) for manual token creation and `claude mcp add` / `codex mcp add` registration.
