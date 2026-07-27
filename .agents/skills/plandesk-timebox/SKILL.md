---
name: plandesk-timebox
description: Paces a long run in pomodoro-style timeboxes over a work list the user defines — sets an interval, works items until it expires, verifies what actually completed, reports at every boundary, and continues into the next box while work remains. Chain it onto another skill ("/plandesk-timebox 25m /plandesk-foreman next") or run it bare over a list of items. Use whenever asked to timebox, pomodoro, work in sprints or intervals, keep going for an hour, check in every N minutes, or grind through a list without going dark.
user-invocable: true
argument-hint: "[<interval, e.g. 25m>] [<a skill invocation, or a list of work items>]"
---

# Work in timeboxes

A pacing posture, not a task. It wraps a run in fixed intervals so a long
session surfaces on a cadence instead of disappearing for an hour and coming
back with a wall of diff.

The work list is **yours, not the board's**. Timebox drives what you handed it —
a list of things you want done, in the order you want them. It can be pointed at
the board when you ask for that explicitly, but it never goes shopping for work
on its own.

## How to chain it

```
/plandesk-timebox 25m /plandesk-foreman next     # a box per board item
/plandesk-timebox 50m                            # bare: paces the list you give it
/plandesk-timebox 25m clear the board            # explicit opt-in to board-driven work
/plandesk-autonomy /plandesk-timebox 25m /plandesk-foreman next
                                                 # no permission pauses, plus a surfacing cadence
```

Stacking with [autonomy](../plandesk-autonomy/SKILL.md) is the common pairing and the two
do different jobs: autonomy removes the pause between steps, timebox adds a
rhythm and a report. Neither grants a permission the wrapped skill didn't
already have.

## Set up the run

1. **Get the work list.** Ask for it if it wasn't given: a list of items, a file
   to work through, or a scope of changes. Write it down as harness tasks
   (`TaskCreate`) so progress survives your own forgetting. If the user said
   "clear the board" or named the board explicitly, the list is
   `get_next_task` — but only then.
2. **Set the interval.** Default 25 minutes when unspecified. Take what the user
   says over the default; "work for an hour" means one 60-minute box, not three
   of twenty.
3. **Stamp the clock.** There is no timer to install — record the start and read
   elapsed time at each boundary:
   ```bash
   date +%s      # capture at box start; box_end = start + interval_seconds
   ```
4. **Say the plan back** in one line: the interval, the item count, and what
   happens at the first boundary. A run nobody can predict is a run nobody can
   interrupt at a good moment.

## The cycle

```
box_start = date +%s
loop:
  item = next item on the list
  if item is null:
    stop — the list is done; final report
  work(item)                       # the wrapped skill's own procedure, in full
  verify(item)                     # its own completion check — exit codes, not claims
  commit/checkpoint(item)          # leave nothing half-applied
  if (date +%s) - box_start >= interval:
    checkpoint_report()            # see the template below
    box_start = date +%s           # next box
  continue loop
```

## The boundary rule — the timer is a checkpoint, not a kill signal

**When the interval expires mid-item, let the item finish.** Then verify,
commit, and only then checkpoint.

This is the whole design decision, and the reason is concrete: cutting a run
mid-item strands work in exactly the state that is hardest to recover — a worker
part-way through a change, nothing staged, nothing verified, and a report that
cannot honestly say what landed. A box that runs four minutes long costs four
minutes. A box that cuts clean through a dispatch costs the item.

So the interval governs *how often you surface*, never *where the work stops*.
If an item is so large that it routinely blows the box, that is a sizing
problem — say so at the checkpoint and suggest splitting it, rather than
shrinking the box until it cuts.

## The checkpoint report

At each boundary, keep it short enough to read on a phone:

```
Box N (25m) — 3 items, 2 done, 1 carried

  done      <item> — <what proves it: command + exit code>
  done      <item> — <proof>
  carried   <item> — <where it stands, what is next>

Next box: <what it will pick up>.  Remaining: <count>.
```

Report what is *proven*, not what was attempted. An item without a verification
result is `carried`, not `done` — this is the check the interval exists to
force, and reporting an unverified item as done makes every later box's report
worthless.

Then continue into the next box without waiting for a reply. The checkpoint is
a surfacing moment, not a permission request: the human reads it if they are
there and interrupts if they want to. If the wrapped skill's own lane gate
requires a human, that stop still binds — see
[lanes.md](../../factory/lanes.md).

## Breaks

After four boxes, take a longer checkpoint: re-read the work list against what
actually landed, drop items that are now moot, and say whether the remaining
list still matches what the user wanted. Long runs drift — the plan made sense
ninety minutes ago and the fourth box is where that is worth checking.

This is the agent's version of the pomodoro break. It is not idle time; it is
the moment the list gets re-derived from reality rather than from memory.

## When to stop instead of starting another box

- The list is empty. Report and end — do not go looking for adjacent work.
- Every remaining item is blocked, or gated on a human. Report what is blocking
  and on whom.
- Two consecutive boxes closed nothing. Something is wrong with the sizing, the
  environment, or the plan; another box will not fix it. Say what you observed
  and stop.
- The user asked for a fixed number of boxes and you have finished them.

## Gotchas

- Timeboxing paces work; it does not authorize any. A wrapped skill's lane gates
  and boundaries bind unchanged — see [autonomy](../plandesk-autonomy/SKILL.md) for what
  autonomy does and does not grant.
- The clock is read at boundaries, so it is only as granular as your items. One
  90-minute item inside a 25-minute box produces one box, not four — that is
  correct behavior, and the checkpoint should name it as a sizing problem.
- Do not let the box become a deadline the work is rushed to fit. Skipping
  verification to land inside the interval defeats the entire point; the box is
  a reporting rhythm, not a budget.
- Harness tasks are the per-session scratchpad for the list. If the run is
  board-driven, the board stays the source of truth and the harness list is
  re-derived from it after any compaction.

## References

[autonomy](../plandesk-autonomy/SKILL.md) (the posture this most often stacks with);
[foreman](../plandesk-foreman/SKILL.md) (the usual inner skill);
[lanes.md](../../factory/lanes.md) (gates a checkpoint never overrides);
`.agents/factory/heartbeat.md` (the stall-detection companion for a single long
dispatch, as opposed to pacing a whole run).
