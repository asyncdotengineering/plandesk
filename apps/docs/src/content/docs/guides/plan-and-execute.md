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

### Plan with an agent

You don't have to draw every node by hand. A connected agent can build the plan for you from a brief or RFC with one call to `scaffold_project_from_plan` — it creates the project, all tasks, the dependency edges, and linked spec documents atomically, then the canvas renders the whole graph. Prompt it like:

> Use Plan Desk MCP. Read `docs/rfc.md` and scaffold a project from it: a task per milestone with `todo`/`scope` status, dependency edges between them, and a spec document linked to the first task. Use `scaffold_project_from_plan`.

You review and adjust on the canvas; the agent executes from there.

## 2. Connect an agent

With `plandesk serve` running, bind your codebase to the project:

```bash
cd /path/to/your/repo
plandesk connect --project "Checkout Revamp"
```

`connect` writes commit-safe project binding and MCP wiring:

| Path                      | Committed? | Purpose                                            |
| ------------------------- | ---------- | -------------------------------------------------- |
| `.plandesk/config.json`   | yes        | Pins repo → project (`projectId`, server URL)      |
| `.plandesk/skill.md`      | yes        | Agent conventions                                  |
| `.plandesk/token`         | no         | Raw MCP bearer token (gitignored)                  |
| `.claude/skills/plandesk/` / `.agents/skills/plandesk/` | yes | Skill symlinks → `.plandesk/skill.md` |
| `.mcp.json`               | yes        | MCP entry; `headersHelper` reads `.plandesk/token` |
| `CLAUDE.md` / `AGENTS.md` | yes        | Idempotent include of `@.plandesk/skill.md`        |

The token is generated for you and read from `.plandesk/token` automatically —
no export needed (set `PLANDESK_MCP_TOKEN` only to override).

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

The agent works through Plan Desk's 23 MCP tools and resolves the project from `.plandesk/config.json` — no guessing IDs. Two make the loop tight:

- **`get_next_task`** returns the next actionable `todo` task — one whose prerequisite tasks are all `done` — plus the blocked tasks and what each is waiting on. The agent loops `get_next_task` → read the linked doc → `update_task` to `in_progress` → do the work → `update_task` to `done`, until nothing actionable remains. No need to eyeball the graph for what's unblocked.
- **`scaffold_project_from_plan`** lets the agent stand up an entire plan — project, tasks, dependency edges, and linked spec docs — in one atomic call (see _Plan with an agent_ below).

## 4. Watch it live

As the agent calls `update_task` and `record_agent_progress`, changes stream over SSE to every open view:

- Canvas status badges update on **Flow**
- Cards move on **Board**
- **Agents activity** shows the run and progress events

No refresh needed — MCP writes and UI edits share the same service layer.

## 5. Steer with comments

Planning is a conversation, not a one-shot handoff. Leave a comment on any document in the UI — optionally anchored to a selected passage — to give the agent feedback or direction. The agent pulls open comments with `list_comments`, addresses them, and calls `resolve_comment` to close the loop; the resolution shows up in your UI live. An agent can also `add_comment` to leave a question or suggestion for you. Comments are never deleted by an agent — they're resolved.

This is the steering wheel: plan once, then nudge with comments instead of re-writing the brief.

## 6. Conventions keep agents consistent

The committed `.plandesk/skill.md` (written by `plandesk connect`) teaches agents to:

- Resolve the project from `.plandesk/config.json`
- Use task statuses correctly (`scope`, `todo`, `in_progress`, `done`, `backlog`)
- Stand up a plan with `scaffold_project_from_plan`; pick work with `get_next_task`
- Link documents to tasks; add edges when dependencies emerge
- Pull document comments with `list_comments` and `resolve_comment` when addressed
- Start, record, and complete agent runs — never leave a run open
- Never delete tasks or documents (there is no delete tool by design)

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
