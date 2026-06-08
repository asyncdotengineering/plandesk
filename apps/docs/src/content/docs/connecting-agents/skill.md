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

## Standing up a plan

When asked to plan a project, feature, or RFC from scratch, prefer the one-shot
`scaffold_project_from_plan` tool over many separate calls: it creates the
project, all tasks, their dependency edges, and linked spec documents in a
single atomic call. Give each task a stable `key` (a slug you choose) and
reference those keys in `edges` (`from`/`to`) and in a document's `link_to`.
The server resolves keys to real IDs and returns a `key_to_id` map. Use the
granular `create_task`/`create_edge`/`create_document` tools when ADDING to an
existing plan; use `scaffold_project_from_plan` to build a new one.

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

## Executing the plan

To work a plan, do not guess what is next — call `get_next_task`. It returns the
next actionable `todo` task (one whose prerequisite tasks are all `done`), plus
the `blocked` tasks and what each is `waiting_on`. The loop:

1. `get_next_task` → the next unblocked task.
2. Read its linked document before changing anything.
3. `update_task` to `in_progress`, do the work, then `update_task` to `done`.
4. Repeat until `get_next_task` reports no actionable task.

Edge direction drives sequencing: `from → to` with most labels (`blocks`,
`feeds`, `enables`, …) means `from` finishes before `to`; `depends_on` reverses
it (`from depends_on to` ⇒ `to` first). Add edges so dependencies sequence right.

## Comments

People leave comments on documents in the UI to give you feedback or direction.

- At the start of a session, and after finishing a task, pull open feedback with
  `list_comments` (by `project_id`, optionally one `document_id`). By default you
  get unresolved comments.
- Address each comment, then `resolve_comment` to close the loop — resolving
  updates the commenter's UI live.
- Use `add_comment` to leave a suggestion or question on a document for a person.

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
- Delete Plan Desk tasks or documents (there is no delete tool by design).
- Leave open document comments unaddressed — read them with `list_comments` and
  `resolve_comment` once handled (resolving replaces deleting).
- Leave an agent run open at session end.
- Create a document without linking it to a task.
