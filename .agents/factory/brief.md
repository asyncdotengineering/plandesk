# Briefing a slice

Optional companion for multi-slice dispatch. A slice is dispatched exactly as
[protocol.md](protocol.md) specifies — brief to `runs/brief-<task>.md`, dispatch
a probed worker from [workers/](workers/), receive `runs/result-<task>.json`,
verify engine-side. This file records only what multi-slice work adds on top;
it does not restate the dispatch or result contract.

## Addition 1 — the spec travels as a live share link

Do not paste a task's spec into the brief. Mint `create_share_link` on the
slice's WBS document (or its goal), `expires: 7d`, and put the returned
`markdown_url` in the brief as `Context:`. The worker `curl`s it for the current
task descriptions, edges, and comments — **live** board state, not a frozen
copy. Write the slice's task list, branch, and integration point to
`runs/wbs-<slice>.md` beside the brief.

## Addition 2 — say why, not only what

A brief that states the change without the intent behind it forces the worker to
infer one, and it will infer wrong at exactly the ambiguous moments where the
judgment matters. One or two lines is enough: what larger goal this slice serves,
who it is for, and what the output unlocks.

This is cheap and it pays off at the edges — the worker that knows a slice exists
to make a later migration land green makes different calls about where to put a
seam than one that only knows the acceptance criteria.

## Addition 3 — one worktree per slice

protocol.md forbids two dispatches in one repo tree — they corrupt each other.
Concurrent slices each get their own `git worktree` on branch `<type>/<slice>`
off the integration base; install once per worktree before dispatch. Within a
worktree, protocol.md's one-dispatch-at-a-time still holds. A single slice may
run in place.

## Self-containment

Every contract a slice needs — posture, gates, verification, result shape — is a
factory file under `.agents/`. A brief that reaches outside `.agents/` for a
contract is the bug.
