---
type: routing
version: 1
---

# Routing — which worker for which task

Routing is data, not judgment. [factory.md](factory.md) defers here rather than
restating a table in prose, and [workers/](workers/) holds each worker's probe
and command. This file answers only: *given this task, which file do I open?*

**Probe first, always.** A routing preference for a worker that is not installed
on this machine is worthless — fall through to the next candidate rather than
failing the dispatch.

## By task shape

| The task is… | Worker |
| --- | --- |
| Implementation — write, fix, refactor, add tests | the default IC (see below) |
| Review, audit, security pass | a **different model family** than the one that wrote the code |
| Mechanical and well-specified — rename, codemod, boilerplate | the cheapest worker that probes |
| Taste-sensitive — user-facing copy, layout, API ergonomics | the strongest worker available |
| Long-context — repo-wide survey, large migration | a worker with the largest context window |
| Non-code — planning, documentation, analysis | any worker; prefer one with strong prose |

## The two rules that matter more than the table

- **Never review with the model that wrote it.** A reviewer sharing the author's
  family repeats the author's blind spots. Cross-family review is the single
  highest-yield routing decision, and it is worth overriding every other
  preference here to get it.
- **Escalate without asking.** If a cheaper worker's output does not clear the
  bar, rerun with a stronger one. Judge the output, not the price tag —
  re-dispatching costs less than shipping work that has to be unpicked later.

## Choosing the default IC

Whichever worker this repository has the most clean cycles with in
`runs/metrics.jsonl`. That file is the routing evidence: it records worker,
lane, verdicts and notes per cycle. Read it before assuming a preference, and
record a note when a worker surprises you in either direction.

A worker file may name a model id. Model ids rot — a stale one fails the
dispatch instantly with an unknown-model error. When a dispatch fails that way,
fix the worker file as part of the cycle rather than working around it.
