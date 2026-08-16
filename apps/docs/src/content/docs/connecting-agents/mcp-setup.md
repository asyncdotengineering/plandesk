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

## Step 1 — Auth: none locally, a CLI token for hosted

**Local (the default, no account).** On loopback (`127.0.0.1`), the server treats the caller as the workspace owner — no token, no login, nothing to create. Skip straight to [Step 2](#step-2--register-the-mcp-server) and register the server with no `Authorization` header at all.

**Hosted (connecting to an organization).** Auth is better-auth and two-actor — a human provisions access, an agent never logs in:

1. **Human** opens the dashboard (signed in via GitHub) and goes to **Settings → MCP** → **Generate CLI token**. This mints an **org-wide owner key**, shown once — copy it immediately.
2. **Human** runs `plandesk login` (or `plandesk login --server <url>`) and pastes that key. It's stored in `~/.plandesk/config.json`.
3. **Agent (or human)** runs `plandesk connect --to <org> [--project <id|name>]` from the repo. This mints a **project-scoped agent key** into the repo's gitignored `.plandesk/token` — the file the MCP registration below reads. The owner key never leaves the human's machine.

There is no standalone "create an MCP token" UI or CLI command anymore — a token only exists as the byproduct of `login` (owner key) or `connect --to` (scoped agent key). Full grammar: [CLI Reference — hosted login and connect](/reference/cli/#hosted-login-and-connect-two-actor).

## Step 2 — Register the MCP server

Plan Desk exposes Streamable HTTP MCP at:

```
http://127.0.0.1:7526/mcp/
```

### Claude Code — local (no token needed)

```bash
claude mcp add --transport http plandesk http://127.0.0.1:7526/mcp/
```

### Claude Code — hosted (with a scoped agent key from Step 1)

```bash
claude mcp add --transport http plandesk http://127.0.0.1:7526/mcp/ \
  --header "Authorization: Bearer $(cat .plandesk/token)"
```

For Docker or remote hosts, use the reachable origin (e.g. `http://your-host:7526/mcp/`).

### Codex

```bash
codex mcp add --transport http plandesk http://127.0.0.1:7526/mcp/ \
  --header "Authorization: Bearer $(cat .plandesk/token)"   # omit --header entirely for local
```

### Token-file helper (commit-safe, zero setup)

For teams sharing repo config without committing secrets, use [`plandesk connect`](/connecting-agents/connect/) — it writes `.mcp.json` with a `headersHelper` that reads the gitignored `.plandesk/token` at connection time (empty/absent on local loopback, which needs none):

```json
{
  "mcpServers": {
    "plandesk": {
      "type": "http",
      "url": "http://127.0.0.1:7526/mcp/",
      "headersHelper": "… reads .plandesk/token (or $PLANDESK_MCP_TOKEN if set) …"
    }
  }
}
```

No export is needed — `connect` generates the token, writes it to `.plandesk/token` (gitignored), and the helper picks it up automatically. Set `PLANDESK_MCP_TOKEN` only to override the file.

## Step 3 — Start a new agent session

MCP tool lists load at session start. After adding or changing the server, **start a new Claude Code or Codex session**.

Verify tools are available — you should see 46 Plan Desk tools (see [REST + MCP API](/reference/api/)).

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

| Symptom            | Check                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| MCP 401            | Hosted only — scoped agent key wrong/revoked; re-run `plandesk connect --to <org>` for a fresh one (local loopback doesn't 401) |
| Server unreachable | `plandesk serve` running; `--url` matches                                                                                       |
| Tools missing      | New agent session after `mcp add`                                                                                               |
| Wrong project      | `.plandesk/config.json` `projectId`; re-run `connect --project`                                                                 |

## Factory Desk

Programmatic access without Claude/Codex: install `@plandesk/mcp-client` from npm (or use `packages/plandesk-mcp-client` from a cloned repo) with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`.
