---
title: From idea to development with Claude Code
description: A worked example — take a one-line idea, let Claude Code plan it in Plan Desk, then build it from the live plan over MCP.
---

This is the whole loop, end to end: you start with an idea, Claude Code turns it into a plan on Plan Desk, and then Claude Code does the development against that live plan — picking the next unblocked task, writing the code, updating status, and taking your feedback as comments. You watch it happen on the canvas.

We'll use one running example: **"Add rate limiting to our public API."**

If you want the conceptual version of this workflow, see [Plan & execute a project](/guides/plan-and-execute/). This page is the hands-on walkthrough.

## 0. Install and serve

```bash
npm i -g @plandesk/cli
plandesk init
plandesk serve
```

Leave it running. The UI is at [http://127.0.0.1:3847](http://127.0.0.1:3847); the MCP server is at `http://127.0.0.1:3847/mcp/`.

## 1. Register Plan Desk in Claude Code

Create a token and add the MCP server so Claude Code can reach Plan Desk:

```bash
plandesk token create --name "Claude Code"        # prints plandesk_mcp_…

claude mcp add --transport http plandesk http://127.0.0.1:3847/mcp/ \
  --header "Authorization: Bearer plandesk_mcp_…"
```

Start a **new** Claude Code session so the tools load. You should see Plan Desk's 46 MCP tools (see [REST + MCP API](/reference/api/)). The two that drive this workflow are `scaffold_project_from_plan` (plan once) and `get_next_task` (the build loop).

## 2. Turn the idea into a plan — let Claude do it

In Claude Code, hand it the idea and ask it to scaffold the plan. One call to `scaffold_project_from_plan` creates the project, every task, the dependency edges, and a linked spec — atomically:

> Use Plan Desk MCP. I want to **add rate limiting to our public API**. Scaffold a project from this idea with `scaffold_project_from_plan`: a task per unit of work with `todo`/`scope` status, dependency edges between them (so what blocks what is explicit), and a `Design:` spec document linked to the first task. Keep task labels imperative.

Claude builds something like:

- **Design: rate-limit strategy** (`scope`) → spec doc linked
- **Add token-bucket middleware** (`todo`) — _depends_on_ Design
- **Wire Redis counter store** (`todo`) — _depends_on_ middleware
- **Return 429 + Retry-After** (`todo`) — _depends_on_ middleware
- **Add config + per-route limits** (`todo`) — _feeds_ rollout
- **Rollout behind a flag** (`todo`) — _depends_on_ the rest

Open the project in the UI — the whole graph renders on the **Flow** canvas. You didn't draw a single node.

:::note
`scaffold_project_from_plan` creates a brand-new project. For adding to an existing plan, Claude uses the granular `create_task` / `create_edge` / `create_document` tools instead.
:::

## 3. Bind your repo to the project

Now point the codebase you'll build in at this project, so every future session resolves it automatically and follows Plan Desk conventions:

```bash
cd /path/to/your/api-repo
plandesk connect --project "Add rate limiting to our public API"
```

This writes `.plandesk/config.json` (the project binding), `.plandesk/skill.md` (the conventions Claude follows), a git-ignored `.plandesk/token`, an `.mcp.json` whose `headersHelper` reads that token automatically (no export needed), skill symlinks in `.claude/skills/plandesk/` and `.agents/skills/plandesk/`, and an idempotent `@.plandesk/skill.md` include in `CLAUDE.md`. See [plandesk connect](/connecting-agents/connect/).

Start a **new** Claude Code session in the repo. It now knows the project without being told, and the skill file teaches it the build loop, dependency vocabulary, and the comments workflow.

## 4. Review and refine the plan

Before any code, look at what Claude proposed on the **Flow** canvas. Adjust task statuses, fix an edge, tighten the spec. If something needs rethinking, leave a **comment** on the spec document (optionally select a passage first) — that's how you steer without rewriting the brief.

## 5. Build it — inside Claude Code, from the live plan

In the repo session, point Claude at the plan and let it work the loop:

> Use Plan Desk MCP. Start an agent run for this project. Then loop: call `get_next_task`, read its linked document, explain the relevant files, make the smallest correct change, run the tests, set the task `in_progress` then `done`, and `record_agent_progress`. Stop when `get_next_task` has nothing actionable. Don't delete tasks.

What Claude does each iteration:

1. **`get_next_task`** → the next `todo` whose prerequisites are all `done` (no guessing which work is unblocked).
2. Reads the task's linked spec document with `get_document`.
3. Writes the code and runs the tests in your repo.
4. **`update_task`** → `in_progress`, then `done`.
5. **`record_agent_progress`** → a one-line note on the run.
6. Repeats. When everything is blocked or done, `get_next_task` says so and Claude completes the run.

Because dependencies are real edges, Claude builds in the right order — it won't start "Wire Redis counter store" until "Add token-bucket middleware" is `done`.

## 6. Steer mid-build with comments

You don't have to interrupt the session to change direction. Open the spec or any document in the UI and add a comment — for example, on the rollout task's doc:

> Start the flag at 1% and ramp over a week, not an instant cutover.

Next time Claude checks in (the skill tells it to pull open comments with `list_comments` at the start of a task and after finishing one), it reads your feedback, adjusts, and calls `resolve_comment`. The resolution shows up in your UI live — the comment moves to **resolved** with no refresh. Claude can also `add_comment` to leave you a question.

## 7. Watch it live

Every `update_task`, `record_agent_progress`, and `resolve_comment` streams over SSE to every open view, with no refresh:

- **Flow** — status badges flip as tasks move to `done`
- **Board** — cards advance across columns
- **Agents activity** — the run and its progress events
- **Document comments** — resolve live when Claude addresses them

That's the whole arc: an idea became a connected plan, Claude Code built it from that plan in dependency order, and you steered with comments — all local, all live.

## Recap

| Step   | You                            | Claude Code                                                           |
| ------ | ------------------------------ | --------------------------------------------------------------------- |
| Plan   | Give the idea                  | `scaffold_project_from_plan` → project + tasks + edges + spec         |
| Bind   | `plandesk connect --project …` | resolves the project every session                                    |
| Review | Adjust canvas, leave comments  | —                                                                     |
| Build  | —                              | loop `get_next_task` → code → `update_task` → `record_agent_progress` |
| Steer  | Comment in the UI              | `list_comments` → fix → `resolve_comment`                             |

## Next steps

- [The Skill](/connecting-agents/skill/) — the exact conventions Claude follows
- [REST + MCP API](/reference/api/) — all 46 tools
- [Plan & execute a project](/guides/plan-and-execute/) — the conceptual workflow + Codex setup
