---
title: The Skill
description: Agent conventions for Plan Desk MCP — task labels, docs, notes, files, artifacts, sharing, edges, and agent runs.
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
- **Build-contract depth.** Non-trivial tasks are build contracts, not tickets —
  a worker executes the task start-to-done without re-reading any parent RFC,
  PRD, or ticket. The description REQUIRES:
  1. **Problem** — what must change; reference class/method names, never line numbers.
  2. **Action Items** — specific, independently completable steps.
  3. **Interfaces** — the concrete signatures/types/API/CLI surface this task
     introduces or touches, named exactly (function signatures, endpoint
     shapes, CLI flags, config keys).
  4. **Pseudocode** — control flow for any behavior that isn't obvious from
     the interfaces alone. Skip only for a small, single-obvious-path edit.
  5. **Validation contract** — the specific test, command, or observable
     outcome that proves this task done; align it to the parent Goal's
     `verification_surface` when the task belongs to one.
  6. **References** — linked documents or related tasks.
- Descriptions stay consumer-clean: no internal RFC/PRD/ticket references
  embedded in the text — link a Plan Desk document instead of citing an
  external ticket ID inline.
- Before creating, check for an existing task covering the same work; prefer
  updating/linking over duplicating.
- Creating several tasks: space ~200 units apart, group related, place blockers
  above what they block.

## Documents

- Write bodies as well-structured Markdown — `##` headings, bullet lists,
  fenced code blocks, and blank lines between paragraphs. Bodies render as
  rich text in the UI (a Notion-style editor); a wall of unbroken text is unreadable for people.
- Title prefix: `Investigation:`, `Scope:`, `Design:`, or `Fix:`.
- Include a `Status:` line near the top: "Ready to implement",
  "Open — requires investigation", "Ready for review", or "Superseded".
- After creating a document, link it to its primary task in the same step.

## Notes

Notes are free-form working notes scoped to the project — findings, context,
scratch reasoning, anything worth referring back to later. They are distinct
from documents: notes are not linked to tasks, not nested, and not part of the
formal plan or client share. Reach for a note when the content is for working
memory rather than a deliverable spec.

- `list_notes` (by `project_id`) to see existing notes; `get_note` to read one.
- `create_note` to capture a new note (give it a clear `title`); `update_note`
  to revise the title or body.
- Write bodies as well-structured Markdown — `##` headings, bullet lists, blank
  lines between paragraphs. Bodies render as rich text in the UI.

## Files

- Use `attach_file` to upload an image and get back `{ file_id, url }`; embed it
  in a document, task, or comment body as `![alt](url)` instead of inlining
  base64 — keeps bodies lean. `mime` defaults to `image/png`.

## Edges

- Connect related tasks with labeled edges. Prefer the vocabulary:
  `blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`.
- When you discover a new dependency while working, add the edge.

## Executing the plan

Follow `.agents/factory/factory.md` for the per-item contract (pull → red gate →
delegate → prove → gate → ship, with the agent-run lifecycle). The loop below is
the tool-level default it builds on.

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

## Keeping the board true

The board is only useful when it matches reality. Two standing rules:

- **Atomic status updates** — flip a task's status in the same step as the work
  event it reflects, never in a batch at the end: `update_task` to
  `in_progress` the moment you start, `done` the moment the work is verified,
  back to `todo` (or `scope`) if you stop without finishing. At any instant the
  board should show what is actually happening right now.
- **Reconcile against reality** — at the start of a session, after any long
  break, and before reporting a plan finished, sweep the whole board against
  the actual state of the work: recent commits, the working tree, what is
  verifiably built and shipped. Fix every mismatch with `update_task` — work
  that is done but not `done`, tasks `in_progress` that nobody is working on,
  planned tasks the code shows are already built or obsolete. Note non-obvious
  corrections in the task description or a document comment so the drift and
  its fix are traceable.

## Comments

People leave comments on documents in the UI to give you feedback or direction —
the composer is a full editor, so a comment can carry formatting, images, and
the same annotation overlay as the document editor.

- At the start of a session, and after finishing a task, pull open feedback with
  `list_comments` (by `project_id`, optionally one `document_id`). By default you
  get unresolved comments.
- Address each comment, then `resolve_comment` to close the loop — resolving
  updates the commenter's UI live.
- Use `add_comment` to leave a suggestion or question on a document for a person.
- People can also annotate **files you wrote** (not just workspace documents) — see
  the next section. Pull those with `list_artifact_comments` (by `project_id` +
  `artifact_id`), address them, and `resolve_comment` the same way.

## Reviewing files (the CLI previewer)

Beyond the workspace UI, a person can open any Markdown or HTML file you produced
in a local previewer and annotate it:

```
plandesk <file.md>        # or: plandesk *.md, plandesk open <paths...>
```

They highlight text and attach notes. In a connected repo those annotations are
stored as `artifact` comments in this project's board, so you read and resolve
them over MCP exactly like document comments — `list_artifact_comments` to pull,
`resolve_comment` to close. This closes the "you write a file → the human marks it
up → you fix it" loop on files, not just documents. When you finish a deliverable
file, tell the person they can review it with `plandesk <that file>`.

## Artifacts

An artifact is a stored agent deliverable — a report, an RFC, an HTML diagram —
kept in the workspace (not a file on disk).

- `create_artifact` to store one (`title`, `content`, optional `kind`:
  `markdown` or `html`); the returned `artifact_id` is exactly the id
  `list_artifact_comments`/`add_artifact_comment` use, so a human's annotation
  and your `update_artifact` revision close the loop without a file on disk.
- `get_artifact` to read one back before revising; `list_artifacts` to check
  what a project already has before creating a duplicate.
- Prefer an artifact over a Note or Document when the deliverable is a finished
  piece meant to be read and marked up (a report, a spec, a diagram) rather than
  tracked plan state. `artifact_id` is opaque — pass through what `create_artifact`
  or `list_artifact_comments` gave you, never construct it.

## Sharing

- `create_share_link` hands a delegated worker or sub-agent full context for one
  task or document without giving it MCP access: pass exactly one of `task_id`/
  `document_id`, get back `{ url, markdown_url, expires_at }`. Put
  `Context: <markdown_url>` in the worker's brief instead of pasting context —
  `markdown_url` returns the resource as agent-ready Markdown with linked docs
  inlined and embedded images fetchable.
- `expires` defaults to `24h`; pass `never` only when the link truly needs to
  outlive a session — it stays public to anyone who has it.

## Agent runs

1. Start a run at the beginning of any multi-step Plan Desk operation.
2. Record progress after each meaningful unit of work (not every tool call).
3. Complete or fail the run before the session ends — never leave one open.

## Never do

- Guess or hardcode IDs.
- Batch status updates for the end of a session — statuses change atomically
  as the work happens.
- Leave a task `in_progress` that nobody is actively working on.
- Reference line numbers in tasks or documents.
- Create non-trivial tasks without a description.
- Set a task to `in_progress` at creation.
- Skip the duplicate check before creating a task.
- Delete Plan Desk tasks, documents, notes, or artifacts (there is no delete tool by design).
- Inline large images as base64 in a document/task/comment body — `attach_file`
  and embed the returned `url` instead.
- Leave open document comments unaddressed — read them with `list_comments` and
  `resolve_comment` once handled (resolving replaces deleting).
- Leave an agent run open at session end.
- Create a document without linking it to a task.
