---
title: Research, plan, build, and share
description: The whole lifecycle — research and plan with Claude Code, track it in Plan Desk, build from the live plan, and share progress with your team or client.
---

This is Plan Desk's full arc, end to end: a fuzzy idea becomes a researched plan, the plan becomes the single source of truth your agent builds from, and the live plan becomes a window your team or client can watch — and feed back into. Four moves, one connected graph, all local-first.

Each move has a hands-on guide; this page is the map that connects them.

## 1. Research & plan with Claude Code

Start with an idea and let Claude Code do the thinking on the page. Hand it the goal and have it research the codebase, then scaffold a plan in one call — `scaffold_project_from_plan` creates the project, a task per unit of work, the dependency edges between them, and a linked spec, atomically. You review the graph on the **Flow** canvas and steer with comments instead of rewriting the brief.

The plan _is_ the brief: imperative task labels, concrete specs, and real dependency edges (`blocks`, `depends_on`, `feeds`, …) so what's unblocked is never a guess.

→ Hands-on: [From idea to development with Claude Code](/guides/idea-to-development/) · concepts: [Plan & execute a project](/guides/plan-and-execute/)

## 2. Track with Plan Desk

Once the plan exists, it's the live source of truth — not a doc that rots. Tasks carry status (`scope` → `todo` → `in_progress` → `done`), specs live on the nodes, and every view (Flow, Board, Agents activity, document comments) updates over SSE with no refresh. People and agents read and write the **same** graph, locally, offline-capable.

Bind your repo so every session resolves the project automatically:

```bash
plandesk connect --project "Add rate limiting to our public API"
```

This writes the project binding plus `.plandesk/skill.md` — the conventions your agent follows (the build loop, dependency vocabulary, the comments workflow). See [The Skill](/connecting-agents/skill/).

## 3. Build with live tracking

Claude Code works the plan as a loop, in dependency order: `get_next_task` (the next `todo` whose prerequisites are all `done`) → read the linked spec → make the smallest correct change → run tests → `update_task` to `in_progress`, then `done` → `record_agent_progress`. Because dependencies are real edges, it never starts blocked work.

You watch it happen live and steer mid-build with **comments** — drop a note on a spec and the agent picks it up with `list_comments`, adjusts, and `resolve_comment`s it, live in your UI.

→ Hands-on: [From idea to development with Claude Code](/guides/idea-to-development/)

## 4. Share with your team

When you want a client or another team to see progress — and feed issues back — promote the project to a hosted org (`plandesk push --to <org-id>`) and share a link. It serves a **read-only view computed live** from the hosted plan. They open the link, join by name, and watch status move; with submit enabled they file issues into a moderated inbox. You pull those in, triage them into real tasks, and your agent builds them — status flowing back to them live. Your repo, internal docs, and edit access never leave your machine: the view is **allow-list** and participants can only **propose**, never write.

→ Hands-on: [Plan → share → build with your team](/guides/plan-share-build/) · architecture: [Collaboration & sync](/reference/collaboration/)

## The whole loop

| Move     | What happens                                              | Driven by                                                |
| -------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Research | Idea → researched plan on the canvas                      | Claude Code + `scaffold_project_from_plan`               |
| Track    | The graph becomes the live source of truth                | Plan Desk (local, SSE-live) + `plandesk connect`         |
| Build    | Agent builds in dependency order; you steer with comments | `get_next_task` loop + comments                          |
| Share    | Team watches live, files issues; you triage into tasks    | `plandesk deploy` / `share create` / `pull` + MCP triage |

Same connected plan throughout — no handoffs, no status decks, no copy-paste between tools.
