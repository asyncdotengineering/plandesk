---
name: plandesk-autonomy
description: Runs another skill — or the whole Plan Desk board loop — unattended, without pausing for permission between steps, bounded strictly by the board's own risk lanes. Chain it onto any skill invocation ("/plandesk-autonomy /plandesk-foreman all todo") or run it bare to drive the board. Use whenever asked to work autonomously, run unattended, keep going without asking, clear the board on its own, or go do the whole thing — and whenever a long run must survive compaction without losing what is next.
user-invocable: true
argument-hint: "[<a skill invocation to run unattended> | nothing, to drive the board]"
---

# Run it unattended

A posture, not a task. It wraps something else and removes the pause-for-
permission between steps, while leaving every structural human gate standing.

Vendored on purpose: this file has **no runtime dependency on any global
skill** — not on a generic "drive any goal to done" posture, not on anything
under an operator's `~/.claude` or `~/.agents`. A Plan Desk project must behave
identically on a machine that has never seen those. This file is the whole
contract.

**Lane: full** — this governs autonomy itself. Treat changes to it with the
scrutiny of a public contract.

## How to chain it

Put it in front of whatever you want run unattended. The wrapped skill does the
work; this decides when it is allowed to keep going.

```
/plandesk-autonomy /plandesk-foreman all todo    # work the frontier without asking between items
/plandesk-autonomy /plandesk-groom-task all scope # groom the whole scope column in one pass
/plandesk-autonomy                                # no inner skill: drive the board loop below
/plandesk-autonomy /plandesk-timebox 25m /plandesk-foreman next
                                                  # stacks with pacing — see plandesk-timebox
```

When wrapping a skill, follow that skill's procedure exactly and change only
one thing: do not stop to ask whether to continue to its next step. Everything
else it says — its own boundaries, its lane, its verification — still binds.
This posture grants pace, never permission.

## The one rule everything else follows

**The board is the durable spine for what is next** — not your memory of the
plan, and not the harness's task list. Harness tasks are a fine per-session
scratchpad for the moves inside one item; they do not survive compaction and
they do not decide what comes next. Every "what's next" question is answered by
calling `get_next_task` against the bound project, never by recalling what you
decided three turns ago.

This is what lets a long run survive compaction — the board-as-memory hooks in
[hooks](../../factory/hooks/) re-inject exactly this state at the forget-moments.

## The bare loop

With no inner skill, this is what runs:

```
loop:
  task = get_next_task(project_id)          # the board decides, not you
  if task is null:
    stop — report and end (if the cause is an empty backlog rather than a
           lane block, offer plandesk-scope-work; do not run it unasked)
  if task.lane != "auto":
    stop — do not start it; see "Lane boundary" below
  work(task)
  checkpoint()                              # record_agent_progress
  update_task(task.id, status: "done")      # atomic with verification
  continue loop
```

One task at a time, serial — the same cycle as `.agents/factory/factory.md`.
This posture does not introduce a competing execution model; it is how an agent
runs *that* cycle without a human in the seat.

## Lane boundary — the hard stop

Check the task's lane in [lanes.md](../../factory/lanes.md) before starting:

| lane | behavior |
| --- | --- |
| `auto` | proceed — proof and verifiers only, no pause |
| `approve` | do the work, post the diff-summary comment, **then stop**. Never flip to `done`; a human resolves the comment |
| `full` | do the work, get an independent review (a separate pass, not your own read-back), post the summary plus the verdict, **then stop**. Never self-approve |

**An operational test, not a feeling:** the moment you learn a task's lane is
`approve` or `full` — before you touch it, or discovered mid-edit — the rule is
the same. Finish the smallest coherent unit you are already mid-edit on so the
tree is not left half-written, verify it, post the comment, stop. "I'm already
in it, might as well keep going" past that point is exactly the collapse this
table exists to prevent: a lane discovered late is not permission to finish more
than you would have started fresh.

A task with **no** lane recorded is not `auto` by default. Treat it as `approve`
until a human or [scope-work](../plandesk-scope-work/SKILL.md) assigns one. Never infer
`auto` from a task that merely looks simple.

## Releasing work — the board, or the human talking to you

Unattended, this posture never releases or approves on its own initiative. It
does not call `update_task(status: "todo")` on a `scope` task, does not flip an
`approve`/`full` task to `done`, and does not move work between lanes because it
judged the work ready. The gates hold against the agent's own judgement — "it
looks ready" is never self-authorization.

**But the human can drive those moves by talking to you.** When they say
"release task X", "move these to todo", "approve this one" — that instruction
*is* the authorization, exactly as if they had dragged the card. Carry it out
and confirm what you did. The gate exists to stop the *agent* deciding
unattended, not to stop the *human* deciding *through* the agent; nobody should
have to leave the conversation for a UI drag.

The line that holds: agent-initiated release or approval while unattended,
never. Human-instructed, always — then confirm. If it is genuinely unclear
whether an instruction means "release", ask once, then act.

## When to stop instead of pushing through

- A lane blocks you — stop and report. Do not route around it by splitting the
  task to dodge the lane or jumping to a "related" `auto` task instead. That is
  scope creep wearing productivity's clothes.
- `get_next_task` returns nothing but `scope`/`backlog` holds unreleased
  material — that is a human-attention gap, not a bug. Report it; do not
  self-release.
- A task balloons past its triaged size mid-work — send it back to `scope` with
  a comment explaining why, rather than pushing through with a workaround.
- The wrapped skill hits its own stopping condition — honour it. This posture
  never overrides another skill's boundaries; it only removes the pauses
  between steps that skill was already allowed to take.

## Gotchas

- Chaining this onto a skill does **not** widen that skill's permissions. A
  wrapped `plandesk-groom-task` still cannot change status; a wrapped
  `plandesk-scope-work` still cannot create a task as `todo`.
- The hooks this assumes live in `.agents/factory/hooks/`, wired into the
  project's `.claude/settings.json` by `plandesk factory init`. If they are not
  installed, say so and fall back to explicitly re-reading the board at the
  start of every resumed session rather than assuming continuity.
- Autonomy is about pace between steps, not about skipping verification. A run
  that goes faster by proving less has failed, however many tasks it closed.

## References

[lanes.md](../../factory/lanes.md) (lane vocabulary — the source of truth this defers
to rather than restates); `.agents/factory/factory.md` (the per-task cycle this
drives); [foreman](../plandesk-foreman/SKILL.md) and
[scope-work](../plandesk-scope-work/SKILL.md) (the skills most often wrapped);
[timebox](../plandesk-timebox/SKILL.md) (the pacing posture this stacks with);
[hooks](../../factory/hooks/) (the anchoring mechanism).
