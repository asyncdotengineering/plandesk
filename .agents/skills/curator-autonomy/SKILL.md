---
name: curator-autonomy
description: Board-bound, lane-gated autonomy posture for driving this project's Plan Desk board unattended without breaching the human gates. Use when running the board loop autonomously.
---

# Curator: autonomy posture (vendored, board-bound, lane-gated)

A distilled, project-local autonomy posture for driving this project's Plan
Desk board without pausing for permission on every step — bounded strictly
by the board's own lane gates. Vendored: this file has **no runtime
dependency on any global skill** (generic "drive any goal to done" postures,
or anything under an operator's `~/.claude`/`~/.agents`). Copy it, don't
reference it.

**Lane: full** — this governs autonomy itself; treat changes to this file
with the same scrutiny as a public contract.

## Why a distilled copy, not a dependency

A generic "drive any goal to done" autonomy posture defaults to shipping
without pausing, which would steamroll this project's structural human gates
if wedged in unmodified. A Plan Desk project must work identically on a
machine that has never seen any such global skill. This file is the whole
contract; nothing here reaches outside the project.

## The one rule everything else follows

**The board is the durable spine for what's next — not your own memory of
the plan, and not the harness's ephemeral task list.** (Harness tasks are
fine as a per-session scratchpad for the moves within one item; they just
don't survive compaction and don't decide what's next.) Every "what's next"
question is answered by calling `get_next_task` against the bound project —
never by recalling what you decided three turns ago. This is what makes a
long run survive compaction (see the board-as-memory hooks in [hooks](../../factory/hooks/):
they re-inject exactly this state at the forget-moments).

## The loop

```
loop:
  task = get_next_task(project_id)          # the board decides, not you
  if task is null:
    stop — nothing actionable, report and end (or hand off to Curator triage
           if the reason is an empty backlog, not a lane block)
  if task.lane != "auto":
    stop — do not start it; see "Lane boundary" below
  work(task)                                  # do the task
  checkpoint()                                # record_agent_progress; the
                                               # Stop/PreCompact hooks also
                                               # persist this automatically
  update_task(task.id, status: "done")        # atomic with verification
  continue loop
```

- One task at a time, serial — matches `.agents/factory/factory.md`'s own
  cycle; this posture does not introduce a second, competing execution
  model, it is how an agent runs *that* cycle unattended.
- `record_agent_progress` after each meaningful unit of work, not every tool
  call — same cadence as `.plandesk/skill.md` already specifies.

## Lane boundary — the hard stop

Consult `.agents/factory/lanes.md` for the task's lane before starting:

| lane | this posture's behavior |
| --- | --- |
| `auto` | proceed autonomously — proof + verifiers only, no pause |
| `approve` | do the work, post the diff-summary comment, **then stop** — never flip to `done`; a human resolves the comment |
| `full` | do the work, get an independent review (a separate agent/pass, not your own read-back), post the diff-summary + review verdict, **then stop** — never self-approve, never flip to `done` |

**Operational test, not a feeling:** the moment you learn a task's lane is
`approve` or `full` — whether that's before you touch it, or only discovered
mid-edit — the rule is identical: finish the smallest coherent unit of work
you're already mid-edit on (don't leave the tree in a half-written state),
verify it, post the comment, and **stop there**. "I'm already in it, might
as well keep going" past that point is exactly the collapse this table
exists to prevent — a discovered-late lane is not an excuse to finish more
than you'd have started fresh.

A task with no lane recorded is **not** `auto` by default — treat it as
`approve` until a human or the intake skill assigns one explicitly. Never
infer `auto` from a task merely "looking simple."

## Releasing and moving work — by the board *or* by talking to the agent

**Unattended, this posture never releases or approves on its own initiative.**
Running the loop by itself, the agent does not call `update_task(status:
"todo")` on a `scope` task, does not flip an `approve`/`full` task to `done`,
and does not move work between lanes because it *decided* the work was ready.
The board's gates hold against the agent's *own* judgement — "it looks ready"
is never self-authorization.

**But the human can drive those moves by talking to the agent — they do not
have to open the web UI.** When the human explicitly asks — "release task X",
"move these to todo", "approve this one", "flip that lane" — that instruction
*is* the authorization, exactly as if they had dragged the card on the board.
The agent carries it out (`update_task`, lane / status change) and confirms
what it did. The gate exists to stop the *agent* from deciding unattended, not
to stop the *human* from deciding *through* the agent: talking to the agent is
a first-class way to drive the board, so the human never has to leave the
conversation for a UI drag.

The line that still holds: **agent-initiated** release or approval while
unattended — never; **human-instructed** release or approval — do it, then
confirm. If it is genuinely unclear whether an instruction really means
"release" or "approve", ask once, then act.

Corollary: this posture governs *this project's own dev-task board*
identically to how [triage](../curator-triage/SKILL.md) governs the Curator *feature's*
output — an agent operating under this posture is bound by the same rule it
is helping build.

## Anchoring across compaction

This posture assumes the board-as-memory hooks are installed (`.agents/
curator/hooks/`, wired into the project's `.claude/settings.json` —
`plandesk factory init` does this). If they are not yet installed, that is a
gap: say so, and fall back to reading the board explicitly (`get_next_task`,
the current `in_progress` task, its linked document) at the start of every
resumed session rather than assuming continuity.

## When to escalate instead of proceeding

- A task's lane blocks you (`approve`/`full`) — stop and report, do not find
  a workaround (e.g. splitting the task to dodge the lane, or skipping
  straight to a "related" `auto` task instead — that is scope-creep dressed
  as productivity).
- `get_next_task` returns nothing actionable but `scope`/`backlog` has
  material sitting unreleased — that's a human-attention gap, not a bug;
  report it, do not self-release.
- A task balloons past its triaged complexity mid-work — send it back to
  `scope` with a comment explaining why (per `factory.md`'s own convention),
  don't push through with a workaround.

## References

`.agents/factory/lanes.md` (lane vocabulary, source of truth this file defers
to rather than restates); `.agents/factory/factory.md` (the per-task cycle
this posture drives unattended); [triage](../curator-triage/SKILL.md) (the parallel rule for
the Curator feature's own output); [hooks](../../factory/hooks/) (the anchoring mechanism
referenced above).
