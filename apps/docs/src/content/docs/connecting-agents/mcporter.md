---
title: Use Plan Desk with mcporter
description: Call Plan Desk's MCP tools straight from your terminal (or a TypeScript script) with mcporter — no agent session required.
---

[mcporter](https://mcporter.sh) is a CLI and TypeScript runtime for the Model Context Protocol: it lets you call any MCP server's tools like normal functions — from the shell or from code — without loading a giant tool-schema prompt into an agent. Pair it with Plan Desk when you want to **drive the plan from the terminal**: check the next task, flip a status, list projects, or script the loop — without opening an agent session.

Plan Desk exposes Streamable HTTP MCP at `http://127.0.0.1:7526/mcp/` with `Authorization: Bearer <token>`, which is exactly what mcporter connects to.

## Prerequisites

1. Plan Desk is serving and has a project:

   ```bash
   plandesk serve            # http://127.0.0.1:7526
   ```

2. A token — **hosted orgs only**. Local loopback is zero-auth, so skip this and omit the `Authorization` header below entirely. For a hosted org, reuse the scoped agent key `plandesk connect --to <org>` wrote to `.plandesk/token`:

   ```bash
   export PLANDESK_MCP_TOKEN="$(cat .plandesk/token)"
   ```

mcporter is run with `npx mcporter …` (no install needed), or install it via npm/Homebrew.

## Step 1 — Add Plan Desk to mcporter

mcporter reads `~/.mcporter/mcporter.json` (global) or `config/mcporter.json` (project). Add Plan Desk as an HTTP server; mcporter expands `$env:` placeholders, so the token stays out of the file:

```json
{
  "mcpServers": {
    "plandesk": {
      "description": "Plan Desk planning MCP",
      "baseUrl": "http://127.0.0.1:7526/mcp/",
      "headers": {
        "Authorization": "Bearer $env:PLANDESK_MCP_TOKEN"
      }
    }
  }
}
```

For a Docker or remote sync host, use the reachable origin (e.g. `http://your-host:7526/mcp/`).

## Step 2 — List and inspect the tools

```bash
npx mcporter list                  # lists configured servers — you should see "plandesk"
npx mcporter list plandesk         # prints TypeScript-style signatures for all 64 tools
npx mcporter list plandesk --brief # compact one-line-per-tool view
```

`mcporter list plandesk` is the source of truth for each tool's exact arguments — read it before calling.

## Step 3 — Call tools

Arguments are `key:value` (pseudo-TypeScript), or a parenthesized call:

```bash
# No-arg tool: list projects (grab the project id you want)
npx mcporter call plandesk.list_projects

# The build-loop pick: the next actionable task for a project
npx mcporter call plandesk.get_next_task project_id:<project-id>

# Flip a task's status
npx mcporter call plandesk.update_task task_id:<task-id> status:done

# Parenthesized form (handy for values with spaces)
npx mcporter call 'plandesk.add_comment(target_type: "document", target_id: "<doc-id>", body: "ship behind a flag")'
```

Because these go through the same MCP service as an agent, every call streams to the live UI — a `update_task` here moves the card on the board with no refresh, same as if Claude did it.

## Optional — generate a typed CLI or client

mcporter can turn Plan Desk into a standalone CLI or a typed TS client — useful for scripts, CI, or giving an agent a small typed surface instead of the full schema:

```bash
npx mcporter generate-cli plandesk --bundle dist/plandesk.js   # standalone CLI
npx mcporter emit-ts plandesk --mode client --out src/plandesk-client.ts
```

## Notes & troubleshooting

- **Server must be running** — mcporter talks to your local `plandesk serve`; if it's down, calls fail. (`serve` uses a fixed port (7526) and fails if that port is busy — free the port, or start it on a different one with `--port` and point `baseUrl` at that.)
- **401 Unauthorized** — `PLANDESK_MCP_TOKEN` is unset, wrong, or revoked. Re-export it, or create a new token.
- **No `plandesk` server listed** — check the config path and that the JSON is valid; mcporter also supports `${VAR}` and `${VAR:-fallback}` interpolation if you prefer.
- **Resolve ids without guessing** — `plandesk.list_projects` for project ids; a project's tasks come from `plandesk.get_project`. There is no delete tool by design.

## See also

- [MCP Setup](/connecting-agents/mcp-setup/) — connect Claude Code / Codex (full agent sessions)
- [REST + MCP API](/reference/api/) — all 64 tools and their purposes
- [The Skill](/connecting-agents/skill/) — the conventions agents follow
