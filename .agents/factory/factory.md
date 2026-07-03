---
type: factory
version: 1
---

# Factory contract

How delegated agent work cycles run in this repository. The bound Plan Desk
project is the scheduler and the single source of truth for work items; this
file is the policy the supervising agent follows.

## The cycle (one work item)

1. **Pull** — `get_next_task` on the bound project. Only `todo` tasks whose
   prerequisites are all `done` are workable; `scope` and `backlog` wait
   for a human to release them on the board.
2. **Read** — the task's linked spec document before touching anything.
3. **Red gate** — run the relevant verifier or gate command. If it is already
   green, demand a discriminative failing check first, or send the task back
   to `scope` with a comment. Green-at-start proves nothing.
4. **Act** — dispatch to an installed worker from [workers/](workers/) per
   [protocol.md](protocol.md): probe first, then the file's command template.
5. **Prove** — verify the worker's result claims per the protocol (re-run the
   claimed commands; exit codes are authoritative). No valid claims, no done.
6. **Observe** — read the diff (the hunks, not the worker transcript) before
   any status change.
7. **Gate** — apply the task's lane from [lanes.md](lanes.md): `auto`
   proceeds, `approve` waits on a human resolving the diff-summary comment,
   `full` runs an independent review plus a human.
8. **Report** — flip the task to `done` atomically with the verification and
   append one line to `runs/metrics.jsonl` (cost, duration, lane, worker,
   verdicts).

## Conventions

- Statuses flip atomically with the work event, never in batches.
- Review blockers become tasks with blocking edges — the board always shows
  why work is stuck.
- If a change balloons past its triaged complexity, the task goes back to
  `scope` with a comment explaining why.
- `runs/` is transient machine state (gitignored). Everything else under
  `.agents/` is authored policy — edit it, commit it, own it.
