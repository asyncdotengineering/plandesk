---
name: plandesk-scope-work
description: Turns raw signal or a whole idea into board-ready Plan Desk tasks. Dedups client submissions, an ungroomed backlog, or a pasted brain-dump into `scope` tasks with recorded provenance, and scaffolds an idea, RFC, or PRD into a full project — tasks, dependency edges, lanes, and a Design doc — in one scaffold_project_from_plan call. Use whenever asked to triage a backlog or submissions, sort a brain-dump into tasks, plan a feature or RFC onto the board, scaffold a project, or decompose a Goal into cycle-sized tasks, even when Plan Desk is not named.
user-invocable: true
argument-hint: "[backlog | submissions | <brain-dump> | <idea, RFC, or PRD>]"
---

# Scope work onto the board

One skill, two shapes of input. Both end the same way: reviewable tasks in
`scope`, each with a lane and a traceable reason for existing.

| mode | input | produces |
| --- | --- | --- |
| `signal` | submissions, the `backlog` column, or a pasted brain-dump | deduped tasks, one decision per item |
| `plan` | an idea, RFC, PRD, or a Goal to decompose | a whole WBS — tasks, edges, and a `Design:` doc, in one atomic call |

Pick by what you were handed: a *pile of items that already exist* is `signal`;
*one thing that needs breaking down* is `plan`. When a brain-dump describes a
single coherent initiative rather than a list of unrelated asks, treat it as
`plan` — the edges matter more than the dedup.

**Lane: approve.** Everything here lands as a proposal, and the `scope → todo`
release is the resolution of that proposal — a separate act from making it.
This skill never performs it: a plan is not evidence that the plan was
accepted, and an intake that releases its own output has reviewed nothing.

Who may perform that release is decided elsewhere — by default a human, and
under [autonomy](../plandesk-autonomy/SKILL.md) an agent with its reasoning
posted first. Either way it is a decision taken *after* this skill returns.

## Rules both modes share

- **Never create a task as `todo`.** `scope` is the only valid status out of
  this skill, with one exception: the human driving the session explicitly said
  to release something ("plan this and start the first chunk"). A plan is not
  evidence that the work is approved.
- **Draft against the Definition of Ready** in
  [groom-task](../plandesk-groom-task/SKILL.md) — the one readiness bar this project
  keeps. Source material rarely clears every row; draft what it supports, never
  invent the rest, and leave the unmet rows for groom to finish.
- **Decision tasks for open questions.** When decomposition surfaces a question
  whose answer changes what gets built — a schema tradeoff, a product choice, a
  dependency call — create a `decision` task (`kind: 'decision'`, `status:
  'scope'`) rather than folding a guess into a build task's description. A guess
  written as a spec is indistinguishable from a decision to whoever reads it
  next. **Creating a decision task records the question; it does not answer it.**
  This skill does not resolve decision tasks — that is a conversation, and
  [autonomy](../plandesk-autonomy/SKILL.md) already forbids an agent settling a call
  that belongs to a human.
- **Refer to board items by name** in narration and comments — see
  `.plandesk/skill.md`. Ids are for tool calls.
- **Label in house style** — imperative and outcome-focused, "Verb Noun in
  Location", so the label alone says what done looks like.
- **Assign a lane by blast radius** (`auto` / `approve` / `full`, from
  [lanes.md](../../factory/lanes.md)) and a severity (`low` / `medium` / `high`),
  using the task's typed fields.
- **Record provenance** on everything created or merged (see below).

## Mode `signal` — a pile of items

Normalize each item to `{ id, title, body, source_ref }` first, where
`source_ref` is a submission ID, a backlog task ID, or `"text:<n>"` for a
brain-dump line.

- `submissions` → `list_submissions(project_id, status: "pending")`
- `backlog` → `list_tasks(project_id, status: "backlog")` — the default when no
  mode is given
- `text` → the pasted block, one item per paragraph or marked line

Then, for every item in order:

1. **Cross-check open work.** `list_tasks(project_id)` across all statuses and
   compare against every existing label and description. A match is a duplicate
   when it describes the same problem or outcome — not merely the same area.
   When unsure, prefer merging over creating a near-duplicate.

   **A near-match that is already `done` is context, not noise.** The default
   instinct is to discard it — it is not a duplicate, so it does not change the
   decision. Read it anyway: how a comparable problem was investigated and
   resolved is the most useful thing on the board for whoever picks this up, and
   it is invisible to them unless you carry it. Cite it in the new task's
   **References** as `Prior art: <label> — <what it established>`. This matters
   most for the person with the least history, which is usually whoever is
   newest or an agent with none at all.
2. **Decide exactly one outcome:**
   - `reject` — noise, already shipped, or out of scope. Leave the source
     untouched. For a submission, do not call `triage_submission` unless the
     item is unambiguous spam; when in doubt, leave it `pending`.
   - `accept-new` — genuinely new. `create_task(status: "scope", ...)`.
   - `accept-merge` — a duplicate. For a submission,
     `triage_submission({ submission_id, action: "accept", link_task_id })`. For
     a backlog or text item, comment on the surviving task and leave the
     original in place pointing at it — there is no delete tool by design.
   - `pending` — ambiguous or high-severity. Do not force it. Post a comment
     describing the fork and let a human decide. Every item gets a decision or
     an explicit "needs a human"; silently dropping one is the failure mode.
3. **Comment the reasoning** — even for `reject` and `pending`, so the decision
   is traceable later.

**Dedup precision.** If matching proves unreliable on real data, drop
`accept-merge` to propose-only — a comment naming the suspected duplicate, the
decision left `pending` — rather than raising autonomy. Widen only on evidence.

## Mode `plan` — one thing to break down

### 1. Frame the problem

A few sentences: what must change, why now, what "done" looks like at the
project level. From an RFC or PRD this is a restatement, not new analysis. From
a raw idea with no scope boundary — "make the app better" — ask before
scaffolding; a WBS on an unbounded ask produces a plan nobody can execute.

### 2. Build the WBS with real edges

**If the source is a Plan Desk document that already carries a decomposition
sketch, convert it — do not re-derive it.** A `Design:` document written by
[plan-writer](../plandesk-plan-writer/SKILL.md) ends with a numbered sketch of the
major pieces in landing order. That list *is* the WBS: read it with
`get_document`, create one task per entry in the order given, and link each back
to the source document.

Re-deriving a decomposition someone already reasoned through is how a plan
quietly becomes a different plan — the author's sequencing carried an argument,
and rebuilding it from the prose loses whichever part of that argument you did
not re-read. Split or merge an entry only when you can say why, and say so in
the task.

Everything below applies to entries that need work the sketch did not state, and
to sources with no sketch at all.

Each node is one task-sized unit. For each, decide its dependencies and express
them as edges (`blocks`, `depends_on`, `feeds`, `enables`, `unblocks`,
`clarifies`, `supports`). **A plan with no edges is a list, not a graph** —
`get_next_task` only sequences correctly when the edges are real. Group related
tasks on the canvas (~200 units apart), blockers above what they block.

Pull the interfaces, pseudocode, and validation detail **out of** the source RFC
and into each task's own description, so a worker executes the task without
re-reading the parent. Descriptions stay consumer-clean — link a Plan Desk
document rather than citing an external ticket ID inline.

### 3. Write the Design doc

One document, `Design:` prefix, linked to the entry-point task. It carries the
one-liner, why this shape (the tradeoffs the WBS encodes), what is explicitly
out of scope, and sequencing notes. If the source was already an RFC, link it
rather than restating it — the Design doc is the board-native index.

### 4. Make one call

```
scaffold_project_from_plan({
  project_id?, name?, description?,   // project_id → add to it; else name → new project
  tasks: [{ key, label, description, status, x, y }, ...],
  edges: [{ from: key, to: key, label }, ...],
  documents: [{ title, body, link_to: key, status_line }, ...],
})
```

Give every task a stable `key` you choose (`c1`, `auth-migrate`) and reference
those keys — never IDs — in `edges` and `link_to`. The response's `key_to_id`
map is how you find real IDs afterward. It is atomic: the whole plan lands or
none of it does.

**When the repo is already bound, always pass `project_id`** from
`.plandesk/config.json`. Omitting it creates a second project duplicating the
bound one — the most expensive mistake available here, because the board splits
and neither half is complete.

Reach for `create_task` / `create_edge` / `create_document` only for a one-off
single addition.

### Decomposing a Goal

A Goal is the durable contract a human hands over (`objective` +
`verification_surface` + constraints). The human authors it; **the system owns
cycle-sizing.** Output is cycle-sized tasks under that Goal, edge-sequenced,
that together make the `verification_surface` pass.

A task is cycle-sized when **one worker can take it start → proven-done in one
coherent pass** — one red gate made green, verified, every changed line tracing
to that task. If you cannot state a single checkable "done", or it would need
more than one verify-and-integrate pass, split it. Prefer more small cycles over
fewer large ones; the loop only stays unstuck when each step is genuinely one
pass.

Place these with `create_task` + `goal_id` and `create_edge` — not
`scaffold_project_from_plan`, which stands up a new project on the default goal.

**Refusal is not terminal.** A worker that finds a task too big to finish to the
bar splits it into cycle-sized children under the same Goal, back in `scope`,
and records why in a comment. A too-big task is a sizing miss to correct, never
a dead end.

## Provenance — why each task exists

Automated task creation is only trustworthy when every task traces to what
caused it. A task nobody can explain back to a request is the vacuous structure
the board exists to prevent.

Every `accept-new`, `accept-merge`, or promotion records `{ sources, reason }`
in two places, because they serve different readers:

- **In the description** — the first line of the **References** section, so a
  human scanning the `scope` column sees it without opening anything:
  `Provenance: <decision> — <reason> (source: <id>[, <id>...])`
- **In a comment** — the full context, via `add_comment` on the task's linked
  document, or a project note titled `Scope work — <date>` listing every
  decision from that run. Batch a run's decisions into one note; it reads as a
  session log rather than board clutter.

`sources` is always plural-capable — merging three duplicate reports lists all
three. `reason` is one human-legible clause explaining *why this became a task*
or *why it merged*, not a restatement of the label.

This rides on existing fields. Do not propose a dedicated provenance column; it
is a courtesy to the reviewer, not a stored primitive.

## When you are done

Stop. Assign the lanes, then hand back — the `scope → todo` release happens
after this skill returns, by whoever [lanes.md](../../factory/lanes.md) says may
make it. Do not start executing the plan you just scaffolded unless the human
asked for that in the same request.

Then offer the next step rather than taking it: if any task landed thinner than
the Definition of Ready, say which, and offer
[groom-task](../plandesk-groom-task/SKILL.md) to finish them. Offering beats doing here —
grooming rewrites what a task means, and the human about to review this batch
should choose whether that happens before or after they look at it.

## Gotchas

- `scaffold_project_from_plan` resolves `key`s, not IDs. Passing a real task ID
  in `edges.from` fails the whole atomic call.
- A brain-dump often contains both shapes — three unrelated bugs *and* one
  initiative. Split the input and run both modes rather than forcing one.
- `list_tasks(project_id)` without a status filter is what makes dedup work;
  filtering to `scope` hides the duplicate that is already `done`.

## References

[groom-task](../plandesk-groom-task/SKILL.md) (the Definition of Ready this drafts
against, and where thin drafts get finished);
[plan-writer](../plandesk-plan-writer/SKILL.md) (authors the RFC this consumes);
[foreman](../plandesk-foreman/SKILL.md) (executes what a human releases);
[autonomy](../plandesk-autonomy/SKILL.md) (the human-gate rule);
`.plandesk/skill.md` (task, document, and edge conventions);
[lanes.md](../../factory/lanes.md) (lane vocabulary and the stop-after-intake rule).
