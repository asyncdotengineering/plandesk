---
name: plandesk-groom-task
description: "Groom one thin task, or a bare one-line requirement with no card yet, into a build contract in place: read the code it names, fill the description to build-contract depth, assign a lane, add the edges it implies. Use when asked to groom, refine, flesh out, size, or make a task buildable, when a ticket is too thin to hand to anyone, or when checking whether a batch is ready to release."
user-invocable: true
argument-hint: "<task id | 'all scope' | 'all todo' | a one-line requirement>"
---

# Groom a task

Takes a thin task — or a one-line requirement with no card yet — and makes it
buildable: reads the code it names, fills the description out to build-contract
depth, assigns a lane, and adds the edges it implies. In place, on the record
that already exists.

Read `references/background.md` when asked why grooming is separate or never releases a task.

**Lane: approve** — grooming rewrites what a task *means*, so the rewrite lands
as a board diff with a comment recording what was inferred, and that comment is
the gate's resolution surface.

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

Read `references/text-mode.md` when the input is a one-line requirement.

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
| **Non-goals** | names the adjacent work this task will not do and where it lands instead (an edge or another task) — fine to skip when the boundary is unambiguous | absent while the label or Problem invites a broader reading; "out of scope: everything else" |
| **References** | the linked documents and related tasks, as links | a dangling mention of an external ticket ID |

Outside the description, two more rows: a **lane** from
[lanes.md](../../factory/lanes.md) chosen by blast radius, and every dependency the
task implies expressed as an **edge** rather than as prose.

Failing any row is not ready. Name the row and the reason — a verdict without
the row is an opinion.

### kind: `decision`

Read `references/decision-tasks.md` when the task's `kind` is `decision`.

### Bugs: the root cause belongs in the task

Read `references/bug-tasks.md` when the task is a bug or an investigation.

## Procedure

1. **Read before writing.** `get_task`, its linked documents, its comments, and
   the code the label points at. A groom written from the label alone is just a
   longer label.
2. **Ground every name in the repo.** Classes, methods, files, flags and config
   keys that appear in the rewrite must exist — grep them first. An interface
   invented at the desk is one the worker discovers is wrong halfway through.

   Read `references/grounding-inherited-names.md` when the description already names a field or endpoint.
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

Read `references/non-goals-containment.md` when a task has no stated boundary.

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

Read `references/contract.md` when calling this skill from the autonomy loop.

## References

[foreman](../plandesk-foreman/SKILL.md) (dispatches what this makes ready);
[scope-work](../plandesk-scope-work/SKILL.md) (raw signal or a whole idea → new tasks,
and the provenance shape);
[autonomy](../plandesk-autonomy/SKILL.md) (the human-gate rule);
`.plandesk/skill.md` (the description shape this judges);
[lanes.md](../../factory/lanes.md) (lane vocabulary).
