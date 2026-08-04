---
name: plandesk-standup
description: Start-of-session standup — rebuild context from the last standdown, a session handoff, or git plus board state when no handoff exists. Use when opening a new session, resuming after compaction, asking what happened yesterday, or before pulling the next task.
user-invocable: true
argument-hint: "[optional focus, e.g. goal name]"
---

# Standup

Orient a **fresh session** before touching code. Read first, then propose what
to do — never assume you remember the last run.

## Source priority

Use the first source that exists and is plausibly current (same branch, last
24h, or user says "continue"):

1. **`.plandesk/standdown.md`** — written by [standdown](../plandesk-standdown/SKILL.md).
   Prefer this when present.
2. **Session handoff** — `HANDOFF.md`, `runs/handoff*.md`, or a path the user
   names. Skim only; do not treat stale release versions as current fact.
3. **Reconstruct** when neither exists:
   - Git: `git log --oneline -15`, `git status`, branch name.
   - Board (MCP): resolve project per [plandesk](../plandesk/SKILL.md), then
     `list_tasks` by status and `get_next_task`.
   - Optional: recent `runs/result-*.json` for verified claims from the last
     dispatch.

If sources disagree, say which you trust and why — do not merge silently.

## Workflow

1. **Read** per the priority above. When using standdown, quote nothing long —
   synthesize into a briefing.

2. **Brief the user** in this shape (adjust length to complexity):

   **Since last time** — what shipped or changed (commits + done tasks).

   **Current state** — branch cleanliness, in-flight tasks, blockers.

   **Next** — what `get_next_task` or the standdown suggests; one recommended
   first move.

   **Skills** — which skills fit the next move (foreman, groom-task, autonomy,
   etc.).

3. **Confirm, or start work.** If the user invoked standup without a follow-up
   instruction, stop after the briefing and ask what to tackle. If they said
   "standup then work" — or anything else meaning start, resume, or keep going —
   continue into the section below instead of stopping.

## Starting work from the briefing

Only when the user asked to work; a bare standup ends at the briefing.

Do **not** jump straight to `get_next_task`. Standdown wrote `## Suggested next`
and `## Blocked / needs human`, and step 1 just read them. A cold frontier pull
discards that and re-decides from scratch what the last session already decided —
which is how a plan survives as far as the briefing and dies there.

### 1. Build the work list

| rank | source | rule |
| --- | --- | --- |
| 1 | `in_progress` tasks | Only those confirmed yours by assignee and age (see **Do not**). One held by someone else is reported, never taken. |
| 2 | standdown `## Suggested next` | Each re-checked against the board as it is now — reconcile below. |
| 3 | `get_next_task` | Fills the remainder, and is the only source when there is no standdown. |

A goal named in the arguments scopes ranks 2 and 3 to that goal.

Put the list on the harness task list (`TaskCreate` / `TaskList` / `TaskUpdate`),
one entry per board item. That list is per-session scratch — the board stays the
source of truth ([plandesk](../plandesk/SKILL.md)), so re-derive from it after a
compaction rather than trusting the scratch copy.

### 2. Reconcile rank 2 before trusting it

A suggestion written yesterday is a claim about a board that has since moved.
`get_task` each one:

| found as | do |
| --- | --- |
| `todo`, unblocked | keep it, at its ranked position |
| `done` | drop it, say so in one line |
| `blocked` | drop it and name what it is waiting on |
| `scope` / `backlog` | drop it — a human has un-released it since |
| not found | drop it and say the id no longer resolves |

Never work a stale suggestion because it was written down. Executing yesterday's
plan against today's board — confidently, unattended — is worse than the cold
pull it replaces, and is the failure this step exists to prevent.

### 3. Report the list, then hand off

State the ordered list and every rank-2 drop with its reason, briefly. When the
run is about to go unattended, this is the last point at which a human can see
the list is wrong.

Then hand off and stop being involved:

```
/plandesk-autonomy /plandesk-timebox 25m /plandesk-foreman next
```

[foreman](../plandesk-foreman/SKILL.md) owns every dispatch, groom, status change and
commit from there; [autonomy](../plandesk-autonomy/SKILL.md) decides whether the run
pauses between items; [timebox](../plandesk-timebox/SKILL.md) sets the reporting cadence.
Drop the autonomy wrapper when the user wants to be asked between items, and drop
timebox when they did not ask for a cadence.

Nothing about lanes, verification or the dispatch protocol is restated here —
that is [factory.md](../../factory/factory.md), [lanes.md](../../factory/lanes.md) and
[protocol.md](../../factory/protocol.md), and a second copy would drift out of sync
with the first.

## When standdown is missing

Say explicitly: "No `.plandesk/standdown.md`; reconstructed from git and board."
That honesty matters — reconstructed context is thinner and may miss decisions
that never committed.

Offer to run `/plandesk-standdown` at the end of this session so the next
standup has a proper handoff.

## Do not

- Start implementing before the briefing unless the user said to skip standup.
- Re-read the entire prior conversation when a standdown or handoff exists.
- Treat `in_progress` tasks as yours without checking assignee and age.
