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

3. **Confirm or proceed.** If the user invoked standup without a follow-up
   instruction, stop after the briefing and ask what to tackle. If they said
   "standup then work", call `get_next_task` (or the named goal) and continue
   under the factory contract.

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
