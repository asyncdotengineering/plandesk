---
title: MCP Setup
description: Connect Claude Code or Codex to a running Plan Desk server.
---

Connect Claude Code or Codex to a running Plan Desk server so agents can read projects, update tasks, write docs, and record agent runs. This is the standard flow for connecting an MCP-capable agent to a local Plan Desk server.

## Prerequisites

1. Plan Desk is installed and serving:

   ```bash
   npm i -g @plandesk/cli
   plandesk init
   plandesk serve
   ```

   **From source (contributors):** clone [asyncdotengineering/plandesk](https://github.com/asyncdotengineering/plandesk), run `pnpm install && pnpm build`, add `packages/plandesk-cli/bin` to `PATH`, then `plandesk init && plandesk serve`.

2. At least one project exists (create in the UI or `plandesk import --in examples/checkout-revamp.json`).

## Step 1 — Create an MCP token

Tokens are user-scoped, revocable, and shown **once** at creation.

### Via the UI

1. Open [http://127.0.0.1:3847/settings/mcp](http://127.0.0.1:3847/settings/mcp).
2. Enter a name (e.g. `Claude Code`) and click **Create**.
3. Copy the raw token immediately — it cannot be retrieved later.
4. The page shows ready-to-run `claude mcp add` and `codex mcp add` commands with your token filled in.

### Via the CLI

```bash
plandesk token create --name "Claude Code"
```

The token is printed to stdout (prefix `plandesk_mcp_…`).

Revoke tokens from **Settings → MCP** in the UI. Revoked tokens return HTTP 401 on MCP calls.

## Step 2 — Register the MCP server

Plan Desk exposes Streamable HTTP MCP at:

```
http://127.0.0.1:3847/mcp/
```

Auth header: `Authorization: Bearer <token>`.

### Claude Code

```bash
claude mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer plandesk_mcp_…"
```

Replace `plandesk_mcp_…` with your token. For Docker or remote hosts, use the reachable origin (e.g. `http://your-host:3847/mcp/`).

### Codex

```bash
codex mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer plandesk_mcp_…"
```

### Token-file helper (commit-safe, zero setup)

For teams sharing repo config without committing secrets, use [`plandesk connect`](/connecting-agents/connect/) — it writes `.mcp.json` with a `headersHelper` that reads the gitignored `.plandesk/token` at connection time:

```json
{
  "mcpServers": {
    "plandesk": {
      "type": "http",
      "url": "http://127.0.0.1:3847/mcp/",
      "headersHelper": "… reads .plandesk/token (or $PLANDESK_MCP_TOKEN if set) …"
    }
  }
}
```

No export is needed — `connect` generates the token, writes it to `.plandesk/token` (gitignored), and the helper picks it up automatically. Set `PLANDESK_MCP_TOKEN` only to override the file.

## Step 3 — Start a new agent session

MCP tool lists load at session start. After adding or changing the server, **start a new Claude Code or Codex session**.

Verify tools are available — you should see 27 Plan Desk tools (see [REST + MCP API](/reference/api/)).

## Step 4 — Add agent conventions (skill)

Agents work best with repo-local conventions. Two options:

1. **`plandesk connect`** — writes `.plandesk/skill.md` and wires it into `CLAUDE.md` / Codex commands automatically.
2. **Manual** — copy [The Skill](/connecting-agents/skill/) into your repo and reference it from `CLAUDE.md` or agent instructions.

The skill-file pattern applies: keep conventions in a committed markdown file the agent reads every session.

## Troubleshooting

```bash
plandesk doctor                    # workspace DB + tables
plandesk doctor --repo .           # + binding, token, MCP tool list
```

| Symptom            | Check                                                           |
| ------------------ | --------------------------------------------------------------- |
| MCP 401            | Token revoked or wrong value; create a new token                |
| Server unreachable | `plandesk serve` running; `--url` matches                       |
| Tools missing      | New agent session after `mcp add`                               |
| Wrong project      | `.plandesk/config.json` `projectId`; re-run `connect --project` |

## Factory Desk

Programmatic access without Claude/Codex: install `@plandesk/mcp-client` from npm (or use `packages/plandesk-mcp-client` from a cloned repo) with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`.
