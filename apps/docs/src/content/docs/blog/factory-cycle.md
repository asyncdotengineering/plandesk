---
title: 'Chat is a bad scheduler. We made the board the scheduler.'
description: How the Plan Desk factory turns one released task into one verified commit — and why your agent session should supervise the floor instead of scheduling it.
date: 2026-08-21
---

_Design notes behind the factory cycle — first written in July, now the contract every delegated run in this repo follows._

## The thing that kept breaking

An agent session is a good worker and a terrible scheduler.

Everything it knows about "what is next" lives in the transcript. The transcript is
capped, it is not addressable, and it dies with the window. So the loop degrades in
a specific way: the agent re-derives the plan each time, drifts a little on every
re-derivation, and eventually ships something confident and wrong. Restart the
session and there is nothing to resume from.

Our first attempt at fixing this was a state file — `.loop/state.md`, a mirrored task
list, WBS sidecars. It worked until two things wrote to it. Then it was one more
thing to reconcile.

The fix is not a better state file. It is to stop asking chat to hold state at all.

## The split

**Plan Desk is the scheduler.** Tasks, dependency edges, specs on nodes, comments,
agent runs — all of it durable, all of it addressable over MCP, all of it visible to
a person on a canvas.

**The agent session is the floor supervisor.** It routes, briefs, verifies, and
reports. It does not hold the plan and it does not — by default — write the code.

**Command-line workers are the ICs.** `claude`, `codex`, `cursor`, `grok`,
`opencode`, `pi`. Each does one scoped change and reports what it ran.

```
Plan Desk board + canvas          ← the human's control panel
        ▲ MCP
Agent session (/plandesk-foreman) ← floor supervisor: routes, briefs, verifies
        ▼ dispatch                 ▼ review
worker CLIs                        a worker from a different model family
        ▼
claims re-run by the supervisor → exit codes decide
```

Restarting a session costs nothing, because a session was never holding anything.
A fresh one calls `get_next_task` and is caught up.

## One work item, eight steps

The whole contract is eight steps over one task. It is short on purpose — a
supervisor that has to interpret its own process will interpret it differently
each time.

1. **Pull** — `get_next_task`. It returns only `todo` tasks whose prerequisites are
   `done`.
2. **Read** — the spec document linked to the task. Never a brief reconstructed
   from chat.
3. **Red gate** — run the check that must fail.
4. **Delegate** — probe a worker, write the brief, dispatch. One at a time per tree.
5. **Prove** — re-run every command the worker claims it ran.
6. **Observe** — read the diff. The hunks, not the worker's summary.
7. **Gate** — apply the task's risk lane.
8. **Ship** — flip the task to `done`, append one metrics line, commit that item alone.

Three of those are worth the argument.

### Step 1 is where the human gate actually lives

`scope` means awaiting release. `todo` means on the floor. `get_next_task` never
returns `scope` or `backlog`, so a task a person has not released is not
"deprioritised" — it is structurally invisible to the agent.

That matters more than it sounds. A gate enforced by the tool holds. A gate
enforced by a line in a prompt holds until the context is full.

### Step 3 exists because green-at-start proves nothing

A loop whose success condition is already true at turn zero will report success
and change nothing. It is the most common false positive in agent work, and it is
invisible in a transcript — the run looks clean.

So the supervisor must watch the check fail before it dispatches. If it cannot
make it fail, it does not have a task; it has a hypothesis, and the task goes back
to `scope` with a comment saying so.

### Step 5 is why we stopped reading worker summaries

A worker's report is intent, not fact. Ours reports a status, a list of claims, and
a question if it is blocked:

```json
{
  "status": "done",
  "claims": [{ "command": "pnpm test", "exit_code": 0 }]
}
```

The supervisor runs each claim again. The exit code is the authority. Two shapes
are failures, not successes: `done` with no claims (no evidence), and a claim that
does not reproduce (false evidence).

No worker grades its own work. That single rule removed most of what we used to
catch in review.

## Lanes, so "autonomous" means something specific

Every task carries a lane, chosen at intake by blast radius:

| Lane      | Applies to                            | Gate                                                    |
| --------- | ------------------------------------- | ------------------------------------------------------- |
| `auto`    | copy, docs, isolated changes          | proof and verifiers only                                |
| `approve` | ordinary feature work                 | supervisor posts a diff summary; someone clears it      |
| `full`    | schema, infra, auth, public contracts | independent cross-family review, then someone clears it |

A task with no lane is `approve`. It is never `auto` — a simple task is not an
unguarded task.

When a run is unattended the agent may clear its own gate, but it has to post the
reasoning as a board comment first. That comment is the override surface: you read
it later, reopen the task, revert the commit. "Autonomous" is then a bounded claim
rather than a vibe.

## Consequences we chose to keep

**One work item, one commit.** The commit subject names the task, so git history
and the board stay 1:1. It costs a rebase sometimes. It is worth it every time
somebody asks "why is this line here."

**Review blockers become tasks.** A not-ready review creates real tasks with
`blocks` edges into the parent — no sidecar files. The board always shows why work
is stuck, to a person, without opening a terminal.

**Escalation is a status change.** If a change balloons past the complexity it was
triaged at — the "you said low-risk and you are touching 400 files" signal — the
task goes back to `scope` with a comment. The supervisor is allowed to stop.

**Metrics ride in the commit.** `runs/` is throwaway machine state, except
`runs/metrics.jsonl`, which is tracked. Routing decisions and gate loosening are
supposed to be evidence-driven, and evidence that evaporates with the laptop can
justify nothing.

## What we deliberately did not build

An orchestrator daemon. A separate factory UI — the Plan Desk board already is the
UI, and a second one would immediately disagree with the first. Parallel worker
fleets inside one project; parallelism is separate projects in separate sessions
until serial is proven boring. Cloud sandboxes.

Every one of those was easy to justify and none of them were the bottleneck.

## Where it landed

The design is now the shipped contract. `plandesk factory init` writes it into a
repository as `.agents/` — policy files versioned next to the code they govern,
harness-neutral on purpose.

- [How the factory works](/reference/how-the-factory-works/) — the model: roles, cycle, lanes, workers
- [Factory workspace](/reference/factory/) — the file format and the flags
- [Drive the factory](/guides/drive-the-factory/) — a worked run, step by step
