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
| Review, audit, security pass | **`pi` (`zai`/`glm-5.2`)** — see below |
| Mechanical and well-specified — rename, codemod, boilerplate | the cheapest worker that probes |
| Taste-sensitive — user-facing copy, layout, API ergonomics | the strongest worker available |
| Long-context — repo-wide survey, large migration | a worker with the largest context window |
| Non-code — planning, documentation, analysis | any worker; prefer one with strong prose |

## The default reviewer is `pi` on `zai`/`glm-5.2`

Decided 2026-08-02. Every `full`-lane review and every adversarial pass goes to
`pi` unless its probe fails; `codex` is no longer the default reviewer and is a
fallback only.

Two reasons, and the second is the load-bearing one:

- **1M context.** A review that must read a 48-file diff, the migration SQL, the
  author's notes and the board task in one pass is exactly the shape that gets
  truncated and produces a confident verdict on half the evidence.
- **It is the only family we can *prove* is not the author's.** The default IC is
  `cursor`, which runs `--model auto` and routes per turn, so on any given
  dispatch nobody can say which family wrote the code. GLM is not in Cursor's
  routing pool, so `pi` satisfies the cross-family rule below *by construction*
  rather than by assumption. With `codex` the check was an assumption, and an
  unverifiable one.

If `pi`'s probe fails, fall through to `codex`, then `claude-glm`. Never fall
through to the worker that authored the diff.

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
