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
| Review, audit, security pass | **`pi` (`zai`/`glm-5.3`)** — see below |
| Mechanical and well-specified — rename, codemod, boilerplate | the cheapest worker that probes |
| Taste-sensitive — user-facing copy, layout, API ergonomics | the strongest worker available |
| Long-context — repo-wide survey, large migration | a worker with the largest context window |
| Non-code — planning, documentation, analysis | any worker; prefer one with strong prose |

## The default reviewer is `pi` on `zai`/`glm-5.3`

Decided 2026-08-02; rationale refreshed once the implementation workers' models
were pinned. Every `full`-lane review and every adversarial pass goes to `pi`
unless its probe fails; `codex` is no longer the default reviewer and is a
fallback only.

Two reasons:

- **1M context.** A review that must read a 48-file diff, the migration SQL, the
  author's notes and the board task in one pass is exactly the shape that gets
  truncated and produces a confident verdict on half the evidence.
- **Cross-family by construction.** Every implementation worker's model is
  pinned in its worker file — `cursor` on `composer-2.5`, `claude` on sonnet,
  `codex` on `gpt-5.6-luna`, `grok` on `grok-4.5` — and GLM appears in none of
  them, so a `pi` (`zai`/`glm-5.3`) review can never share the author's family.
  The pin is what makes this provable: an unpinned or `--model auto` worker
  would make the author's family unknowable, which is why
  [workers/cursor.md](workers/cursor.md) forbids `auto`. If a worker file's pin
  ever changes to a GLM-family model, this rationale breaks — update both files
  in the same edit.

If `pi`'s probe fails, fall through to `codex`, then `claude`. Never fall
through to the worker that authored the diff — if the fallback would be the
author, skip to the next family.

## The two rules that matter more than the table

- **Never review with the model that wrote it.** A reviewer sharing the author's
  family repeats the author's blind spots. Cross-family review is the single
  highest-yield routing decision, and it is worth overriding every other
  preference here to get it.
- **Escalate without asking.** If a cheaper worker's output does not clear the
  bar, rerun with a stronger one. Judge the output, not the price tag —
  re-dispatching costs less than shipping work that has to be unpicked later.

## The default IC

**The default IC is `cursor`, pinned to `composer-2.5`** (the pin lives in
[workers/cursor.md](workers/cursor.md), never in a brief). This section is the
*only* place a default is named — worker files describe capability and
mechanics, never rank; a "default" written into a worker file is a second copy
that drifts.

The evidence behind the choice is `runs/metrics.jsonl` (tracked in git — it
records worker, lane, verdicts and notes per cycle). Read it before assuming
the preference still holds, revisit the default when another worker
accumulates a clearly better clean-cycle record, and record a note when a
worker surprises you in either direction.

A worker file may name a model id. Model ids rot — a stale one fails the
dispatch instantly with an unknown-model error. When a dispatch fails that way,
fix the worker file as part of the cycle rather than working around it.
