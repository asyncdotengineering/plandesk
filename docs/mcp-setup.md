# MCP setup — Claude Code and Codex

Connect Claude Code or Codex to a running Plan Desk server so agents can read projects, update tasks, write docs, and record agent runs. This is the standard flow for connecting an MCP-capable agent to a local Plan Desk server.

## Prerequisites

1. Plan Desk is built and serving:

   ```bash
   pnpm install && pnpm build
   export PATH="$PWD/packages/plandesk-cli/bin:$PATH"
   plandesk init
   plandesk serve
   ```

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

### Env-var token (commit-safe)

For teams sharing repo config without committing secrets, use `plandesk connect` — it writes `.mcp.json` with:

```json
{
  "mcpServers": {
    "plandesk": {
      "type": "http",
      "url": "http://127.0.0.1:3847/mcp/",
      "headers": {
        "Authorization": "Bearer ${PLANDESK_MCP_TOKEN}"
      }
    }
  }
}
```

Export before each session:

```bash
export PLANDESK_MCP_TOKEN="$(cat .plandesk/token)"
```

## Step 3 — Start a new agent session

MCP tool lists load at session start. After adding or changing the server, **start a new Claude Code or Codex session**.

Verify tools are available — you should see 10 Plan Desk tools (see below).

## Step 4 — Add agent conventions (skill)

Agents work best with repo-local conventions. Two options:

1. **`plandesk connect`** — writes `.plandesk/skill.md` and wires it into `CLAUDE.md` / Codex commands automatically.
2. **Manual** — copy [docs/skills/plandesk-mcp.md](skills/plandesk-mcp.md) into your repo and reference it from `CLAUDE.md` or agent instructions.

The skill-file pattern applies: keep conventions in a committed markdown file the agent reads every session.

## MCP tools (v1)

| Tool                    | Purpose                              |
| ----------------------- | ------------------------------------ |
| `list_projects`         | List accessible projects             |
| `get_project`           | Tasks, docs summary, canvas snapshot |
| `create_task`           | Add canvas node + task row           |
| `update_task`           | Status, label, description, position |
| `create_document`       | Markdown body; optional link to task |
| `update_document`       | Patch title/body/status line         |
| `create_edge`           | Labeled dependency between tasks     |
| `start_agent_run`       | Begin external agent session         |
| `record_agent_progress` | Append progress event                |
| `complete_agent_run`    | Close run (completed or failed)      |

At session start, list tools before calling them. Resolve the project from `.plandesk/config.json` when present — do not guess IDs.

## Repo binding with `plandesk connect`

From a codebase directory (with `plandesk serve` running):

```bash
plandesk connect --project "Checkout Revamp"
```

This:

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

Dry-run: `plandesk connect --print`.

Disconnect: `plandesk disconnect` (does not revoke the token).

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

Programmatic access without Claude/Codex: use `packages/plandesk-mcp-client` with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`. See the [RFC §4.6](../plandesk-rfc/02-requirements-interfaces.md#46-factory-desk-integration-adapter).
