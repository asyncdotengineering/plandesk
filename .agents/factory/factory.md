---
type: factory
version: 2
---

# Factory contract

How delegated agent work cycles run in this repository. The bound Plan Desk
project is the scheduler and the single source of truth for work items; this
file is the policy the supervising agent follows.

## The cycle (one work item)

One work item at a time, one dispatch, one commit. Slice cutting, parallel
worktrees, and a stall heartbeat are documented extensions when a goal needs
them — [slicing.md](slicing.md), [brief.md](brief.md), [heartbeat.md](heartbeat.md)
— not the always-on default.

1. **Pull** — `get_next_task` on the bound project. Only `todo` tasks whose
   prerequisites are all `done` are workable; `scope` and `backlog` wait
   for a human to release them on the board. At session start, call
   `start_agent_run` before the first pull.
2. **Read** — the task's linked spec document before touching anything.
3. **Red gate** — run the relevant verifier or gate command. If it is already
   green, demand a discriminative failing check first, or send the task back
   to `scope` with a comment. Green-at-start proves nothing.
4. **Delegate** — brief and dispatch per [protocol.md](protocol.md); pick the
   worker per [routing.md](routing.md). One dispatch at a time per tree.
   Probe first, then the worker file's command template.
5. **Prove** — verify the worker's result claims per the protocol (re-run the
   claimed commands; exit codes are authoritative). A worker's summary is
   intent, not fact. No valid claims, no done.
6. **Observe** — read the diff (the hunks, not the worker transcript) before
   any status change.
7. **Gate** — apply the task's lane from [lanes.md](lanes.md): `auto`
   proceeds, `approve` waits on a human resolving the diff-summary comment,
   `full` runs an independent review plus a human.
8. **Ship** — flip the task to `done` atomically with the verification,
   commit that work item's diff as one atomic commit (subject references the
   task), call `record_agent_progress`, and append one line to
   `runs/metrics.jsonl` (cost, duration, lane, worker, verdicts).

## Supervisor posture — IC-first execution

The supervising agent orchestrates; IC workers execute. The supervisor's value
is briefs, verification, diff-reading, and integration — not typing the code.

- Default execution path for implementation work is the cycle above: brief →
  dispatch per [protocol.md](protocol.md) → verify claims → read the diff →
  integrate. The supervisor writes code inline only for: trivial edits,
  brief/spec authoring, integration and conflict resolution, review fixes
  under ~5 lines, or when no worker probe passes on this machine.
- **Routing is data, not prose.** Which worker suits which task lives in
  [routing.md](routing.md); each worker's probe and command live in
  [workers/](workers/) — edit those files, never restate routing tables in
  agent instructions. Route by the task:
  mechanical well-specified work → cheapest capable worker; user-facing or
  taste-sensitive work → high-taste worker; verification and review → a
  different model family than the author.
- **Standing escalation permission:** if a cheaper worker's output does not
  meet the bar, rerun or redo with a stronger one without asking. Judge the
  output, not the price tag — escalating costs less than shipping mediocre
  work.
- **Write for a weaker model.** Every brief, skill, and protocol step must be
  followable without the supervisor's judgment: "assess whether X" with no
  template, checklist, or command behind it is the violation. Concrete steps,
  decision tables, exit codes.
- **Artifacts compound; sessions don't.** A lesson learned the hard way
  in-session gets written down before the session ends — as a gotcha, a
  verifier, a worker-file note, or a skill a cheaper model can follow.

When the supervisor (or a worker with no harness) is typing the work itself,
use the IC spine in [execution.md](execution.md): decompose, drive a task list
to zero, verify, ship without pausing for permission.

## Goal completion is proven

The runner drives all cycle-tasks on a goal to `done`, then runs the goal's
`verification_surface` externally — a gate command this project defines, an
acceptance checklist, or human sign-off — and calls `complete_goal` with the
evidence. The API validates evidence against the declared surface — it never
executes shell. Green evidence completes the goal; red evidence sets the goal
`blocked` and files one `scope` remediation task.

When the frontier empties (or a gate blocks further work), call
`complete_agent_run`. Report at diff level: what shipped, what is gated on a
human, what failed and why. Leave the board true.

## Conventions

- Statuses flip atomically with the work event, never in batches.
- **One work item, one commit.** Commit only after the lane gate clears — for
  `auto`, right after your own verification; for `approve`/`full`, only once
  the human has resolved the gate and the task is `done`. The commit holds
  exactly that item's changes and its subject names the task, so git history
  stays 1:1 with the board. Never batch several done items into one commit, and
  never commit work whose gate hasn't cleared.
- Review blockers become tasks with blocking edges — the board always shows
  why work is stuck.
- If a change balloons past its triaged complexity, the task goes back to
  `scope` with a comment explaining why.
- `runs/` is transient machine state (gitignored). Everything else under
  `.agents/` is authored policy — edit it, commit it, own it.
