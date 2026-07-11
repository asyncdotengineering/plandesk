---
type: curator-skill
version: 1
---

# Curator: autonomy posture (vendored, board-bound, lane-gated)

A distilled, project-local autonomy posture for driving this project's Plan
Desk board without pausing for permission on every step — bounded strictly
by the board's own lane gates. Vendored: this file has **no runtime
dependency on any global skill** (`autonomous-stand`, `autonomous-manager-
stand`, or anything under an operator's `~/.claude`/`~/.agents`). Copy it,
don't reference it.

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
long run survive compaction (see the board-as-memory hooks in [hooks/](hooks/):
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

## The one thing this posture can never do

**This posture never calls `update_task(status: "todo")` on a `scope` task —
full stop, no exception.** Not when a human asks for it in the same
conversation, not when the task looks obviously ready, not as a favor, not
"on the human's behalf." The `scope → todo` release is specifically the
human's own action on the board (the drag in the UI) — an agent executing
that status change, even at a human's explicit request, is not the same
event and does not satisfy the gate. If a human wants a task released, the
answer is "please release it on the board" — never "sure, I'll flip it."
This is not a lane-gated behavior to loosen later; it is the single
non-negotiable line in the whole Curator system — the human gates here are
structural, not a policy knob — and it has no "but the human told me to"
carve-out.

Corollary: this posture governs *this project's own dev-task board*
identically to how [triage.md](triage.md) governs the Curator *feature's*
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
this posture drives unattended); [triage.md](triage.md) (the parallel rule for
the Curator feature's own output); [hooks/](hooks/) (the anchoring mechanism
referenced above).
