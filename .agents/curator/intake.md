---
type: curator-skill
version: 1
---

# Curator: intake (the Planner)

Turns an idea, a rough ask, or an RFC into a scaffolded Plan Desk project —
tasks, dependency edges, lanes, and a Design doc — in one `scaffold_project_
from_plan` call. The greenfield-planning counterpart to [triage.md](triage.md)
(existing signal) and the factory (execution): Curator / Factory / Human are
the three roles; this is the Curator's planning half.

**Lane: approve** — a scaffolded project lands with tasks in `scope`/`todo`
per §3 below, never bypassing the human's release gate.

This targets `scaffold_project_from_plan` and the board directly — no file
output, no GitHub issues, no multi-session wizard. It is for standing up a new
plan, not for grooming an existing one.

## When to run this

- "Plan X into Plan Desk" / "turn this idea into tasks" / "scaffold a project
  for Y" / handed an existing RFC or PRD and asked to put it on the board.
- Not for adding a task or two to an existing project — use `create_task` /
  `create_edge` directly (see `.plandesk/skill.md`). This skill is for
  standing up a **new** project or a substantial new initiative inside one.

## The method (idea → board, four moves)

### 1. Problem framing (a few sentences, not a document)

Before decomposing, state: what must change, why now, and what "done" looks
like at the project level. If the ask is already an RFC/PRD, this is a
one-paragraph restatement, not new analysis — pull the problem statement and
scope boundary straight from it. If the ask is a raw idea, ask the minimum
clarifying questions needed to frame it (see "When to ask" below) — do not
silently assume a scope boundary on a genuinely ambiguous ask.

### 2. WBS with dependency edges (the shape of the plan)

Break the problem into a work-breakdown structure: each node is a task-sized
unit of work, imperative and outcome-focused ("Verb Noun in Location" — see
`.plandesk/skill.md`'s task-creation conventions, which this skill inherits
verbatim). For each task, decide:

- **Dependencies** — what must land first. Express as edges (`blocks`,
  `depends_on`, `feeds`, `enables`, `unblocks`, `clarifies`, `supports` — the
  vocabulary in `.plandesk/skill.md`). A plan with no edges is a list, not a
  graph — `get_next_task` only sequences correctly when the edges are real.
- **Lane** (`auto` / `approve` / `full`, from `.agents/factory/lanes.md`) —
  decided by blast radius at intake, same as the factory does for execution
  work. Record it in the task description alongside Problem/Action Items/
  References, e.g. `**Lane: full** — touches the schema.`
- **Grouping** — related tasks get adjacent canvas positions (space ~200
  units apart per `.plandesk/skill.md`); a blocker sits above what it blocks.

Each task description follows house style: **Problem** (what must change,
by class/method name — never line numbers), **Action Items** (specific,
independently completable), **References** (linked docs, related tasks, and —
when scaffolding from a source spec — the section it implements).

### 3. Status at creation — scope vs todo

- `scope` — the default for anything that needs design/sizing before a human
  would hand it to an agent, or for a whole new initiative pending review.
- `todo` — only for tasks that are already well-enough specified to execute
  immediately AND the human driving this planning session has explicitly
  said to release them (e.g. "plan this and start on the first chunk").
  **Never invent a `todo`** on the strength of the plan alone — the human's
  `scope → todo` release is the approval gate everywhere in this project
  (see [autonomy.md](autonomy.md)), and intake does not get a special
  exemption.

### 4. Design doc (the "why", linked to the first task)

One document, title-prefixed `Design:`, linked to the entry-point task
(usually the first/root task in the WBS). It carries: the one-liner, why this
shape (the tradeoffs the WBS encodes), what's explicitly out of scope, and
sequencing notes ("suggested order: A → B → C"). If the source was already
an RFC/PRD, link those documents too rather than duplicating their content
into the Design doc — the Design doc is the board-native index, not a
restatement.

## The one call

Prefer `scaffold_project_from_plan` over building a plan with many separate
`create_task`/`create_edge`/`create_document` calls — it is atomic (all
tasks, edges, and documents land together or not at all) and resolves your
chosen task `key`s to real IDs for you:

```
scaffold_project_from_plan({
  project_id?, name?, description?,   // project_id → add to that project; else name → new project
  tasks: [{ key, label, description, status, x, y }, ...],
  edges: [{ from: key, to: key, label }, ...],
  documents: [{ title, body, link_to: key, status_line }, ...],
})
```

Give every task a stable `key` (a slug you choose, e.g. `c1`, `auth-migrate`)
and reference those keys — not IDs — in `edges` and `link_to`; the server's
`key_to_id` map in the response is how you find the real IDs afterward if you
need to comment on or otherwise follow up on a specific task in the same
session.

`scaffold_project_from_plan` handles **both** cases atomically — use it either way:

- **New project** — omit `project_id` and pass `name`. It creates the project
  and the whole plan in one call.
- **Existing or already-bound project** — pass `project_id` (the bound project
  from `.plandesk/config.json`). The plan is added to that project atomically,
  and new auto-laid-out tasks are placed below its existing nodes. **When the
  repo is already bound, always pass `project_id`** — creating a new project
  duplicates the bound one.

Reach for the granular tools (`create_task`, `create_edge`, `create_document`)
only for a one-off single addition — not for standing up a whole plan on either
a new or an existing project.

## Decomposing a Goal into cycle-sized tasks

A **Goal** is the durable, goal-altitude contract a human hands over
(`objective` + `verification_surface` + constraints/boundaries/budget). The
human authors the Goal; **the system owns cycle-sizing**. When asked to plan a
Goal (or a worker picks up a Goal that has no cycle-tasks yet), decompose it
here so no human ever crafts a too-big task.

Input is the Goal's `objective` and its `verification_surface` (the acceptance
that must end green). Output is a set of **cycle-sized tasks under that Goal**,
edge-sequenced, that together make the `verification_surface` pass.

### The sizing rule (the one rule that matters)

A task is cycle-sized when **one worker can take it start → proven-done in one
coherent pass** — one red gate made green, verified, with every changed line
tracing to that task. If you cannot describe a single checkable "done" for a
task, or it would need more than one verify-and-integrate pass, it is too big:
**split it** until each child is one cycle. Prefer more, smaller cycles over
fewer large ones — the loop (`get_next_task` → work → prove → done) only stays
unstuck when each step is genuinely one pass.

Each cycle-task carries its own acceptance in its **Action Items** (what makes
*this* task done), so the worker never has to guess. Sequence them with edges
(a task that needs another's output `depends_on` it) so `get_next_task`
(scoped to this Goal) walks the frontier in a runnable order.

### How to place tasks under the Goal

Use `create_task` with `goal_id` set to the Goal you are decomposing (each task
is a cycle *within* that Goal), then `create_edge` for the dependencies —
these are the granular "adding to an existing project" tools, not
`scaffold_project_from_plan` (which stands up a *new* project on the default
goal). Status is `scope` by default (the human's `scope → todo` release is the
gate here too — §3 applies unchanged; never auto-`todo`).

### Decompose-on-refusal (the safety net — refusal is not terminal)

If a worker in the loop hits a task that turns out too big to finish to the bar
in one pass, it does **not** bare-stop. It splits that task into cycle-sized
children (created under the same Goal via `create_task` with `goal_id`, back to
`scope`), records why in a comment, and lets the human release them. A too-big
task is a sizing miss to correct, never a dead end. This mirrors evidence-based
completion: a red `verification_surface` blocks the Goal and files a
remediation task rather than faking done.

## When to ask vs. proceed

- Multiple reasonable WBS shapes exist → pick the one that best matches
  existing project conventions (check for a similar prior project/board on
  Plan Desk first) and say so; don't silently guess when two shapes are
  genuinely different bets, surface the fork briefly.
- The idea has no clear scope boundary (e.g. "make the app better") → ask
  before scaffolding; a WBS built on an unbounded ask produces a plan nobody
  can execute.
- Everything else — proceed. This skill is for velocity: a human should be
  able to hand over an idea and get a reviewable plan back, not a Socratic
  dialogue.

## After scaffolding

Stop. Per `.agents/factory/workflow.md` §2 (Intake): "assign each task a lane
at creation... then stop — humans release `scope → todo` on the board." Do
not immediately start executing the plan you just scaffolded unless the
human explicitly asked for that in the same request.

## References

`.plandesk/skill.md` (task/document/edge conventions, inherited verbatim);
`.agents/factory/lanes.md` (lane vocabulary); `.agents/factory/workflow.md` §2
(the stop-after-intake rule); [plan-writer.md](plan-writer.md) (the upstream skill
that authors the RFC this one consumes); [triage.md](triage.md) and
[autonomy.md](autonomy.md) (the sibling Curator roles).
