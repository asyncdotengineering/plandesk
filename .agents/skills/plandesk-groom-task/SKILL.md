---
name: plandesk-groom-task
description: Groom one thin task — or a bare one-line requirement with no card yet — into a build contract in place: read the code it names, fill the description to build-contract depth, assign a lane, add the edges it implies. Use when asked to groom, refine, flesh out, size, or make a task buildable, when a ticket is too thin to hand to anyone, or when checking whether a batch is ready to release.
user-invocable: true
argument-hint: "<task id | 'all scope' | 'all todo' | a one-line requirement>"
---

# Groom a task

Takes a thin task — or a one-line requirement with no card yet — and makes it
buildable: reads the code it names, fills the description out to build-contract
depth, assigns a lane, and adds the edges it implies. In place, on the record
that already exists.

The gap it fills: [scope-work](../plandesk-scope-work/SKILL.md) drafts tasks only at
creation time, from whatever the source material happened to carry;
[foreman](../plandesk-foreman/SKILL.md) grooms only as a prelude to dispatching. Neither
can be pointed at the one-liner someone dropped on the board on a Tuesday. This
can.

**Lane: approve** — grooming rewrites what a task *means*, so the rewrite lands
as a board diff with a comment recording what was inferred, and that comment is
the gate's resolution surface.

It never changes status, and that is a boundary of this skill rather than a
statement about who may release: a groomer that released its own rewrite would
be judging readiness against a description it just wrote, which is not a check.
Who performs the `scope → todo` release is decided after this returns — see
[lanes.md](../../factory/lanes.md).

## When to run this

- "groom this task" / "flesh this out" / "make this buildable" / "this ticket is
  too thin to hand to anyone".
- A bare requirement with no card yet: "we need X" — create it, then groom it.
- Before releasing a batch: `all scope` reports which tasks are actually ready,
  so the release gate is an informed decision rather than a hopeful one.
- From [foreman](../plandesk-foreman/SKILL.md)'s cycle, when a task it pulled is not ready.

## Input adapters

| mode | argument | operates on |
| --- | --- | --- |
| `task` | a task id | that one task — **the default** |
| `filter` | `all scope`, `all todo`, or a goal name | every task in that set, thinnest first |
| `text` | a one-line requirement | **create-then-groom**: one `create_task(status: "scope")`, then groom it |

`text` mode creates exactly one task, in `scope`, and never dedups a batch — a
pile of raw signal is [scope-work](../plandesk-scope-work/SKILL.md)'s job, not this one.
Before creating, call `list_tasks` once: if the requirement is already on the
board, say so and groom the existing task instead of adding a near-duplicate.

## Definition of Ready

The readiness verdict for this repo — the one definition
[foreman](../plandesk-foreman/SKILL.md) and [scope-work](../plandesk-scope-work/SKILL.md) both
defer to, so there is one bar rather than three that drift.

Select the bar by the task's `kind` (default `build`).

### kind: `build`

A task is **ready** when a worker CLI with no session history, no access to this
conversation, and no author to ask could build it and prove it.

`.plandesk/skill.md`'s Task creation section owns the *shape* of a description —
which fields it carries. This owns the *verdict* — whether each field is good
enough yet:

| field | ready when | not ready when |
| --- | --- | --- |
| **Problem** | names the classes, methods, and files that change, and why | restates the label; "improve X"; a symptom with no located cause |
| **Action Items** | each is independently completable and observably done | a single item that is the whole task |
| **Interfaces** | signatures, endpoint shapes, CLI flags, config keys written out exactly | "add an API for it"; a type named but never shaped |
| **Pseudocode** | control flow for behavior the interfaces don't already make obvious | absent on non-obvious behavior — fine to skip on a small single-path edit |
| **Validation contract** | a command or observable outcome a third party can run, aligned to the parent Goal's `verification_surface` | "tests pass"; "it works"; nothing |
| **References** | the linked documents and related tasks, as links | a dangling mention of an external ticket ID |

Outside the description, two more rows: a **lane** from
[lanes.md](../../factory/lanes.md) chosen by blast radius, and every dependency the
task implies expressed as an **edge** rather than as prose.

Failing any row is not ready. Name the row and the reason — a verdict without
the row is an opinion.

### kind: `decision`

A decision task is **ready** when whoever owns the outcome can answer from the
description alone — no session history, no author to ask.

| field | ready when | not ready when |
| --- | --- | --- |
| **Question** | one question, answerable yes/no or by choosing among stated options | several questions bundled; a topic rather than a question |
| **Why it is open** | what forces the choice — the constraint or conflict, and what breaks either way | "we should decide this"; no stated cost of deciding wrong |
| **Options** | each with its cost, named concretely | one option; options that are not mutually exclusive |
| **Recommendation** | a proposed answer with reasoning | absent — a question with no proposal is a fork the agent is dodging |
| **Consequences** | what becomes true, and what it closes off | absent |
| **References** | the tasks and documents waiting on this | a dangling mention |

**Interfaces and Pseudocode are not required of a decision task.** A reader who
knows only the build bar will otherwise apply it and mark every decision task
not-ready forever.

The validation contract is fixed for every decision task — grooming states it
once rather than re-deriving it:

> Done when a `Decision:` document exists in the project's `Decisions` folder
> recording context, the call and its consequences; it is linked to this task;
> and every task that referenced this question links to it.

Grooming never invents an answer — a recommendation is a proposal for a human
to disagree with, not a resolution.

Failing any row is not ready. Name the row and the reason.

### Bugs: the root cause belongs in the task

The Problem row's "a symptom with no located cause" is the rule for bugs, so
state it plainly. A bug is ready when its Problem carries **either**:

- **the located cause** — the file and function, and why it misbehaves; or
- **a repro plus a boundary** — the steps that reproduce it and what has already
  been ruled out.

**Never a guess dressed as a cause.** A guessed cause is worse than an absent
one: the worker inherits it as evidence and scopes the fix to it, so the real
defect survives and now has a test pinned to the wrong explanation.

Observed: *"clicking a task under a document's links does nothing."* Groomed
from the symptom, that becomes "fix the link" — and the fix would have pointed
at nothing, because the real cause was that the board's task drawer lived in
component state and no task was addressable by URL at all. The cause changed
what got built, not just where.

**An investigation is a legitimate task**, not an ungroomed one. When the cause
is unknown, the deliverable *is* the cause: the Validation contract is a
reproduction and a written finding, not a fix. Split the fix into its own task
once the cause is known — that second task is the one that carries it.

## Procedure

1. **Read before writing.** `get_task`, its linked documents, its comments, and
   the code the label points at. A groom written from the label alone is just a
   longer label.
2. **Ground every name in the repo.** Classes, methods, files, flags and config
   keys that appear in the rewrite must exist — grep them first. An interface
   invented at the desk is one the worker discovers is wrong halfway through.

   **Including names the task already carries.** A description you did not write
   is not evidence that what it names exists. A field, constant or endpoint named
   by an earlier author may be something *another task will build* rather than
   something built — and when it is, the dependency is real and needs an **edge**,
   not a mention.

   Observed: a sort task named a `priority` field and its ordering constant, both
   carried through grooming unchecked. Neither existed; the field was a separate
   unstarted task with no edge to it. The worker dispatched against that task did
   the only thing available — declared the vocabulary with no column behind it —
   which is a workaround caused by grooming, not by the worker. **An unbuilt
   dependency stated as fact is indistinguishable from a built one**, and the
   cost lands on whoever is asked to build against it.
3. **Fill only what the source supports.** Extend from what the title,
   description, comments, linked documents and the code already say.
4. **Mark what you inferred.** Anything derived rather than stated is prefixed
   `Inferred:` in the description and repeated in the comment, so a human
   scanning one comment can find every place you guessed.
5. **Name the decisions you don't own.** When readiness depends on a call that
   belongs to a human — a product choice, a schema tradeoff, an external
   dependency — do not resolve it. State it as an open question in the comment,
   leave that row not-ready, and carry on with the next task.
6. **Write it.** One `update_task` per task carrying the full rewritten
   description, plus typed `lane` and `severity` fields. Add every missing
   dependency with `create_edge`.
7. **Comment the diff.** One comment per groomed task: what changed, what was
   inferred, what is still open. Refer to tasks and documents by **label**, not
   bare id — see `.plandesk/skill.md`. This comment is the `approve` gate's
   resolution surface — a groom with no comment cannot be approved.
8. **Report short.** List what changed and what is still not ready, naming each
   task by label. Do not restate tasks that were already ready, and when most of
   a batch shares one defect, report the pattern once instead of once per task.

## Never fabricate scope

The failure mode that makes an automated groomer worse than none: it fills a
thin description with plausible requirements nobody asked for, and because the
prose now reads like a spec, the next reader treats the invention as intent.
The task quietly becomes a different task.

So: extend only from the source. Where the source runs out, the honest output is
an open question, not a confident paragraph. `Inferred:` on anything derived.
When the inference is load-bearing — it changes what gets built, not just how it
is described — the row stays not-ready until a human confirms it.

## Boundaries

- Never change status. Grooming makes a task buildable; releasing it is a
  separate judgement made against the groomed result, not part of producing it.
- Never dispatch. Handing the groomed task to a worker is
  [foreman](../plandesk-foreman/SKILL.md)'s cycle.
- Never dedup a batch, and never create more than one task in a run. That is
  [scope-work](../plandesk-scope-work/SKILL.md).
- Never split a task into slices. Slicing is a dispatch-time concern —
  [foreman](../plandesk-foreman/SKILL.md) and [slicing.md](../../factory/slicing.md). If a
  task is too big to be one build contract, say so and leave it; do not shard
  the board.
- Never rewrite a task that is already ready. A no-op is a good outcome.

## Contract (for callers / the autonomy loop)

```
groom(mode?: "task" | "filter" | "text", target?: string)
  → for each task:
      { task_id: string,
        kind: "build" | "decision",
        verdict: "ready" | "not-ready",
        failing: string[],          // Definition of Ready rows that failed (per kind)
        changed: string[],          // description fields rewritten
        inferred: string[],         // claims the source did not state
        open_questions: string[],   // decisions left to a human (not resolved here)
        provenance: { sources: string[], reason: string } }
```

- `status` is never an output of this skill.
- A run over an empty filter is a no-op — report "nothing to groom", do not
  invent work.
- Provenance uses the same `{ sources, reason }` shape recorded in
  [scope-work](../plandesk-scope-work/SKILL.md), so a task's history reads the same
  however it got onto the board.

## References

[foreman](../plandesk-foreman/SKILL.md) (dispatches what this makes ready);
[scope-work](../plandesk-scope-work/SKILL.md) (raw signal or a whole idea → new tasks,
and the provenance shape);
[autonomy](../plandesk-autonomy/SKILL.md) (the human-gate rule);
`.plandesk/skill.md` (the description shape this judges);
[lanes.md](../../factory/lanes.md) (lane vocabulary).
