---
title: plandesk connect
description: Bind a codebase to a Plan Desk project with commit-safe MCP wiring.
---

`plandesk connect` is the recommended way to wire MCP credentials and teach agent repo conventions — without committing secrets.

With `plandesk serve` running, from a codebase you want bound to a Plan Desk project:

```bash
export PATH="$PWD/../plandesk/packages/plandesk-cli/bin:$PATH"   # adjust if needed
plandesk connect --project "Checkout Revamp"
```

## What it writes

`connect` is idempotent — safe to re-run:

| Path                          | Committed?          | Purpose                                                    |
| ----------------------------- | ------------------- | ---------------------------------------------------------- |
| `.plandesk/config.json`       | yes                 | Pins repo → project (`projectId`, server URL)              |
| `.plandesk/skill.md`          | yes                 | Agent conventions ([The Skill](/connecting-agents/skill/)) |
| `.plandesk/token`             | **no** (gitignored) | Raw MCP bearer token                                       |
| `.mcp.json`                   | yes                 | MCP server entry using `${PLANDESK_MCP_TOKEN}`             |
| `CLAUDE.md` / `AGENTS.md`     | yes                 | Sentinel block `@.plandesk/skill.md`                       |
| `.codex/commands/plandesk.md` | yes                 | Codex command → skill file                                 |

## Workflow

1. Resolves the project (by id or name).
2. Creates or reuses an MCP token in `.plandesk/token` (gitignored).
3. Writes `.plandesk/config.json` (committed project binding).
4. Merges the `plandesk` entry into `.mcp.json`.
5. Inserts an idempotent sentinel block in `CLAUDE.md` (and `AGENTS.md` if present):

   ```markdown
   <!-- plandesk:start -->

   @.plandesk/skill.md

   <!-- plandesk:end -->
   ```

6. Writes `.codex/commands/plandesk.md` for Codex.

## Before each agent session

Source the token before starting an agent session:

```bash
export PLANDESK_MCP_TOKEN="$(cat .plandesk/token)"
```

Start a **new** agent session so MCP tools reload.

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
