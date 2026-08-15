---
name: plandesk
description: Plan Desk planning conventions. Use when planning projects, features, or RFCs; creating or updating Plan Desk tasks, documents, notes, files, artifacts, and edges; executing a plan with get_next_task; sharing context with a delegated worker; or reading and resolving Plan Desk comments.
---

# Plan Desk MCP Instructions

## Setup
At the start of any session where Plan Desk may be used, list the available
Plan Desk MCP tools before calling them. Do not assume tool names or parameter
shapes; if expected tools are missing, say so before proceeding.

Never guess or hardcode a Plan Desk project, task, or document ID. Resolve the
project as below; look up tasks/documents by name and use the returned ID.

New to this repo? Run `plandesk onboard` for the full Plan Desk + Factory model
(how the board works, the execution loop, delegation, and the MCP tools).

### Server must be running (machine-global — not the harness)

MCP tools talk to a **Plan Desk server on the user's machine** (`plandesk serve`).
That process must outlive the agent session. **Do not** start it with the harness
Shell tool's `run_in_background` — that ties the server to this chat and it dies
when the session ends. Start it **globally on the machine**: a detached OS
process the user (or a one-shot setup shell) owns.

**Check first** (from the repo root):

```bash
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "Plan Desk server is up" \
  || echo "No server — start one (below)"
```

`plandesk status` also reports whether a board on this machine is running (by
PID liveness, not just a stale lock file).

**If down, start detached** (survives after the agent's shell exits):

```bash
plandesk serve >>/tmp/plandesk.log 2>&1 &
disown
sleep 2
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "server up" \
  || (echo "not ready — check /tmp/plandesk.log"; tail -20 /tmp/plandesk.log)
```

Tell the user the server is running in the background and that **`plandesk serve`
in a dedicated terminal** is better for day-to-day use (logs stay visible; no
dependency on this session). There is no `plandesk start` — the command is
**`plandesk serve`**.

**First time on this machine** (before serve will work): `npm i -g @plandesk/cli@latest`
(Node ≥ 20), then `plandesk init` (idempotent — creates `~/.plandesk` unless the
repo already has a local `.plandesk/workspace.db`). Full walkthrough:
`plandesk onboard`, or fetch `https://plandesk.asyncdot.com/start.md`.

**Repo not bound yet?** After the server is up, run **`plandesk connect`** from
the repo root — it writes `.plandesk/config.json` and wires MCP. That is setup,
not planning; do not scaffold a second project if the repo is already bound.

**MCP tools still missing after the server is up?** The MCP client loads tools at
**session start** — ask the user to start a **new** agent session (or re-add the
MCP server) once serve and connect are done.

## Referring to board items

**Refer to board items by name.** In anything a person reads — narration, comments,
progress events — name the task or document by its label, carrying the id inside
a link rather than in place of the name. `[Add priority as a first-class task field](<url>)`,
never `2bc337c1`. Ids are for tool calls; names are for people.

## Resolving the project
1. Read `.plandesk/config.json`.
   - If `projectId` is present (v1 config), use it. Stop here — do not ask which project.
   - If `workspaceId` is present (v2 config), the repo is **workspace-bound**.
     `list_projects` returns only that workspace's projects. Resolve the target
     project within the bound workspace. A project id outside the workspace is
     not found.
2. (Fallback, only if no config file) check conversation history for a named
   project; then the working-directory name for a close match; then an explicit
   name in the request.
3. Single clear match → act directly. Multiple → show options and ask.
   None → say so and ask.

## Standing up a plan

When asked to plan a project, feature, or RFC from scratch, prefer the one-shot
`scaffold_project_from_plan` tool over many separate calls: it creates the
project, all tasks, their dependency edges, and linked spec documents in a
single atomic call. Give each task (and any document you need to reference) a
stable `key` (a slug you choose) and reference those keys in `edges`
(`from`/`to`) and in a document's `link_to` (a single key or a list of
task and document keys). The server resolves keys to real IDs and returns a
`key_to_id` map covering both tasks and keyed documents.

`scaffold_project_from_plan` works for both a new and an existing project: omit
`project_id` and pass `name` to create a new one; pass `project_id` (e.g. the
repo-bound project from `.plandesk/config.json`) to scaffold the whole plan
atomically INTO that project. When the repo is already bound, pass
`project_id` — creating a new project duplicates the bound one. Reach for the
granular `create_task`/`create_edge`/`create_document` tools only for a
one-off single addition, not for standing up a whole plan.

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
  6. **Non-goals** — the adjacent work this task explicitly does not do, and
     where it lands instead (an edge or another task). Required when the task
     borders other planned work or its label invites a broader reading; skip
     only when the boundary is unambiguous. A worker with no boundary stated
     will helpfully build past it.
  7. **References** — linked documents or related tasks.
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
  rich text in the UI; a wall of unbroken text is unreadable for people.
- Title prefix: `Investigation:`, `Scope:`, `Design:`, `Decision:`, or `Fix:`.
  `Design:` proposes something to be built; `Decision:` records a call already
  made (context, what was chosen, what follows) and needs no build contract.
- Include a `Status:` line near the top: "Ready to implement",
  "Open — requires investigation", "Ready for review", or "Superseded".
- A document can link to many tasks and to other documents. Prefer
  `link_to` as a list (task and document keys or ids) rather than a single
  primary only; `get_document` returns `links` and `backlinks` so related
  specs can be walked without a second query.
- After creating a document, link it to every task it covers (and any parent
  or related specs) in the same step.

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
- Connect related tasks and documents with labeled edges keyed on
  `from_type`/`from_id`/`to_type`/`to_id` (`task` or `document`).
- **The vocabulary is split by endpoint pair. Use the half that matches.**

  | endpoint pair | labels |
  | --- | --- |
  | task → task | `blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`, `relates` |
  | document → task | `documents` |
  | document → document | `references`, `supersedes`, `extends` |

  `references`, `supersedes`, `extends` and `documents` are **document-scoped**.
  Reaching for one of them to link two tasks is the common mistake: the closest
  task→task label is almost always `relates` (loose association) or `depends_on`
  (real sequencing). The label column is free text, so a wrong label is stored
  without complaint and only shows up as a mislabelled edge on the canvas.
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

**Track the moves within a task with the harness task tools** — when a task needs more than one verifiable step, decompose it with `TaskCreate` / `TaskList` / `TaskUpdate`: one sub-task per move, `in_progress` when you start it, `completed` the moment its done-condition holds. The board decides what is next (durable, survives compaction via the F1 hooks); harness tasks are per-session scratchpad for the moves inside the current item — re-derive from the board after a compaction, never trust the harness list as the source of truth.

**On an unattended run, a progress report is not a stopping point.** Post the
checkpoint and keep working in the same turn; end the turn only at a lane
gate, a genuine blocker, or an empty frontier. Never end by soliciting
continuation — "say continue", "shall I proceed", "ready for the next box?" —
that converts a surfacing moment into a permission request and silently kills
the run the wrapper existed to keep moving (pacing and wakeup mechanics:
`plandesk-timebox`; the posture: `plandesk-autonomy`).

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

People leave comments on documents in the UI to give you feedback or direction.

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

    plandesk <file.md>        # or: plandesk *.md, plandesk open <paths...>

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

## Prototypes

A **prototype** is a named flow of **screens** with one declared viewport.
A project may have many prototypes. A screen is an `html` artifact with a
`prototype_id` — that nullable column is the line between a report and a
screen.

### Create

1. `create_prototype(project_id, name, viewport_width, viewport_height)` —
   also creates a folder and a flow document edged to the prototype.
2. `create_artifact(…, kind: 'html', prototype_id)` to add a screen.
   **Never send `x`/`y`** — the system lays screens out from the link graph.
3. Prefer `plandesk push-artifact <file.html> [--prototype <name>]` over
   inline `content` — inline content means re-emitting the whole document
   on every revision. Preview locally with `plandesk <file.html>` first.
4. Move or copy a screen between prototypes in the same project with
   `move_screen` / `copy_screen` (or the canvas Move / Copy control).
   Copy produces a **new** artifact; comments do not travel.

### `plandesk://` scheme

| Form | Resolution |
| --- | --- |
| `plandesk://artifact/<uuid>` | Pin to exactly this screen |
| `plandesk://artifact/<title>` | Case-insensitive; **this prototype first, then project-wide**. Zero or multiple matches → visibly broken (`to_artifact_id: null`) |
| `plandesk://file/<uuid>` | An attached project file (images). Never inline base64 |
| `plandesk://lib/<name>@<version>` | Curated library from the manifest (mermaid, Chart.js). Outside the manifest is refused at write |

Title resolution is what makes a copied flow wire itself to its own screens
without rewriting markup. A link built by JavaScript at runtime still
navigates but draws no line on the canvas.

### Network is dead

External scripts, stylesheets, fonts, and `fetch` are **blocked**, not
degraded — a screen that reaches for a CDN renders broken. Everything is
inline, an attached `plandesk://file/`, or a curated `plandesk://lib/`.

### Authoring skill

Flow-first conventions, mandatory unhappy paths, and the full authoring
loop live in `.agents/skills/plandesk-prototype/SKILL.md` (and its
`references/`). Read that skill when building or revising a prototype;
this section is the scheme and surface, not a second copy of those rules.

## Agent runs
1. Start a run at the beginning of any multi-step Plan Desk operation.
2. Record progress after each meaningful unit of work (not every tool call).
3. Complete or fail the run before the session ends — never leave one open.

## Never do

The highest-consequence guardrails — each section above states the positive
form; these are the ones worth a hard, consolidated reminder:

- Guess or hardcode IDs.
- End a turn on an unattended run by asking to continue — checkpoint, then
  keep going; stop only at a gate, a blocker, or an empty frontier (see
  "Executing the plan").
- Delete tasks, documents, notes, or artifacts — there is no delete tool by
  design; resolve, supersede, or set status instead.
- Batch status updates for the end of a session — statuses flip atomically as
  the work happens (see "Keeping the board true").
- Inline large images as base64 in a document/task/comment body — `attach_file`
  and embed the returned `url` instead.


