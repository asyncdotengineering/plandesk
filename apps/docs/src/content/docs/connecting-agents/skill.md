---
title: The Skill
description: Agent conventions for Plan Desk MCP — task labels, docs, edges, and agent runs.
---

Embed this file in a repo so Claude Code, Codex, or other MCP agents follow Plan Desk conventions. `plandesk connect` writes the same content to `.plandesk/skill.md` and references it from `CLAUDE.md`.

Copy to your repo as `.plandesk/skill.md` or add to agent instructions. Keep it committed — no secrets.

---

# Plan Desk MCP Instructions

## Setup

At the start of any session where Plan Desk may be used, list the available
Plan Desk MCP tools before calling them. Do not assume tool names or parameter
shapes; if expected tools are missing, say so before proceeding.

Never guess or hardcode a Plan Desk project, task, or document ID. Resolve the
project as below; look up tasks/documents by name and use the returned ID.

## Resolving the project

1. Read `.plandesk/config.json`. If `projectId` is present, use it. Stop here —
   do not ask which project.
2. (Fallback, only if no config file) check conversation history for a named
   project; then the working-directory name for a close match; then an explicit
   name in the request.
3. Single clear match → act directly. Multiple → show options and ask.
   None → say so and ask.

## Task creation

- Labels: short, imperative, outcome-focused — "Verb Noun in Location".
  The label must make clear what "done" looks like.
- Status at creation: `todo` (defined, ready) or `scope` (needs design/sizing).
  Never create a task as `in_progress`.
- Non-trivial tasks REQUIRE a description with:
  1. **Problem** — what must change; reference class/method names, never line numbers.
  2. **Action Items** — specific, independently completable steps.
  3. **References** — linked documents or related tasks.
- Before creating, check for an existing task covering the same work; prefer
  updating/linking over duplicating.
- Creating several tasks: space ~200 units apart, group related, place blockers
  above what they block.

## Documents

- Title prefix: `Investigation:`, `Scope:`, `Design:`, or `Fix:`.
- Include a `Status:` line near the top: "Ready to implement",
  "Open — requires investigation", "Ready for review", or "Superseded".
- After creating a document, link it to its primary task in the same step.

## Edges

- Connect related tasks with labeled edges. Prefer the vocabulary:
  `blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`.
- When you discover a new dependency while working, add the edge.

## Agent runs

1. Start a run at the beginning of any multi-step Plan Desk operation.
2. Record progress after each meaningful unit of work (not every tool call).
3. Complete or fail the run before the session ends — never leave one open.

## Never do

- Guess or hardcode IDs.
- Reference line numbers in tasks or documents.
- Create non-trivial tasks without a description.
- Set a task to `in_progress` at creation.
- Skip the duplicate check before creating a task.
- Delete Plan Desk tasks or documents (v1 has no delete tool by design).
- Leave an agent run open at session end.
- Create a document without linking it to a task.
