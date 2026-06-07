---
title: Plan & execute a project
description: Plan once on the canvas, then let an agent execute from the live plan over MCP.
---

Plan Desk's core workflow: build a connected plan (graph + specs + status) that both people and agents work from — locally, with live updates across every view.

If you haven't planned in the UI yet, start with [Your first project](/getting-started/first-project/).

## 1. Plan — graph, edges, and specs

Map the work as a directed graph on the **Flow** canvas (`/projects/:id/flow`):

- Create tasks with status `scope` (needs design) or `todo` (ready to pick up).
- Draw labeled dependency edges (`blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`).
- Attach a spec document to the key task — agents read it before changing code.

The plan is the brief. Keep task labels imperative and descriptions concrete (problem, action items, references). See [The Skill](/connecting-agents/skill/) for conventions agents follow.

## 2. Connect an agent

With `plandesk serve` running, bind your codebase to the project:

```bash
cd /path/to/your/repo
plandesk connect --project "Checkout Revamp"
```

`connect` writes commit-safe project binding and MCP wiring:

| Path                      | Committed? | Purpose                                       |
| ------------------------- | ---------- | --------------------------------------------- |
| `.plandesk/config.json`   | yes        | Pins repo → project (`projectId`, server URL) |
| `.plandesk/skill.md`      | yes        | Agent conventions                             |
| `.plandesk/token`         | no         | Raw MCP bearer token (gitignored)             |
| `.mcp.json`               | yes        | MCP entry using `${PLANDESK_MCP_TOKEN}`       |
| `CLAUDE.md` / `AGENTS.md` | yes        | Idempotent include of `@.plandesk/skill.md`   |

Before each agent session:

```bash
export PLANDESK_MCP_TOKEN="$(cat .plandesk/token)"
```

Start a **new** Claude Code or Codex session so MCP tools reload.

**Manual alternative:** create a token in **Settings → MCP**, then register the server:

```bash
claude mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer plandesk_mcp_…"
```

For Codex with an env-var token:

```bash
codex mcp add plandesk --url http://127.0.0.1:3847/mcp/ \
  --bearer-token-env-var PLANDESK_MCP_TOKEN
```

See [MCP Setup](/connecting-agents/mcp-setup/) and [plandesk connect](/connecting-agents/connect/) for full details.

## 3. Execute — prompt the agent against the live plan

Open Claude Code or Codex in the bound repo and point it at Plan Desk. Example prompt:

> Use Plan Desk MCP. Inspect this project, read the tasks, documents, and edges. Start an agent run. Pick the next `todo` task that isn't blocked, explain the relevant files, make the smallest safe change, update the task to `in_progress` then `done`, record progress, and complete the run. Do not delete tasks.

The agent uses 10 MCP tools: `list_projects`, `get_project`, `create_task`, `update_task`, `create_document`, `update_document`, `create_edge`, `start_agent_run`, `record_agent_progress`, `complete_agent_run`. It resolves the project from `.plandesk/config.json` — no guessing IDs.

## 4. Watch it live

As the agent calls `update_task` and `record_agent_progress`, changes stream over SSE to every open view:

- Canvas status badges update on **Flow**
- Cards move on **Board**
- **Agents activity** shows the run and progress events

No refresh needed — MCP writes and UI edits share the same service layer.

## 5. Conventions keep agents consistent

The committed `.plandesk/skill.md` (written by `plandesk connect`) teaches agents to:

- Resolve the project from `.plandesk/config.json`
- Use task statuses correctly (`scope`, `todo`, `in_progress`, `done`, `backlog`)
- Link documents to tasks; add edges when dependencies emerge
- Start, record, and complete agent runs — never leave a run open
- Never delete tasks or documents (v1 has no delete tool by design)

Review or customize the skill content in [The Skill](/connecting-agents/skill/).

## Troubleshooting

```bash
plandesk doctor                    # workspace DB health
plandesk doctor --repo .           # + binding, token, MCP tool list
```

| Symptom            | Check                                                           |
| ------------------ | --------------------------------------------------------------- |
| MCP 401            | Token revoked or wrong value; create a new token                |
| Server unreachable | `plandesk serve` running; `--url` matches                       |
| Tools missing      | New agent session after `mcp add` or `connect`                  |
| Wrong project      | `.plandesk/config.json` `projectId`; re-run `connect --project` |
