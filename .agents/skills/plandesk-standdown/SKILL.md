---
name: plandesk-standdown
description: End-of-session standdown — distill what shipped, what blocked, and what is left into a speakable handoff for the next session. Use when wrapping up, ending a run, handing off to a human, or before compaction when the next agent needs context without re-reading the whole thread.
user-invocable: true
argument-hint: "[optional focus, e.g. goal name or 'today']"
---

# Standdown

Close the session with a **durable, speakable summary** another agent (or a
human) can read in under two minutes. The output is the input to
[standup](../plandesk-standup/SKILL.md).

## Output artifact

Write **`.plandesk/standdown.md`** in the repo root (create `.plandesk/` if
needed). Overwrite on each standdown — one current file, not a history pile.
Redact secrets (tokens, keys, PII).

Structure:

```markdown
# Standdown — <ISO date>

## Shipped
- …

## Decisions
- …

## Blocked / needs human
- …

## Still open
- …

## Suggested next
- …

## Suggested skills
- …
```

Bullets are **speakable** — past tense for shipped, present for state, imperative
for next. Name board items by label, not raw ids.

## Workflow

1. **Bound the window.** Default: this conversation. If the user named a goal or
   date in arguments, scope commits and board queries to that.

2. **Mine the thread with subagents (required).** Do not summarize from memory
   alone. Launch at least two focused subagents in parallel:
   - **Shipped** — read the conversation for completed work, verified gates,
     commits made, tasks flipped to `done`. Return bullet lines only.
   - **Open / blocked** — read for unfinished intentions, `blocked` results,
     lane gates waiting on a human, failing tests left behind, and decisions
     deferred. Return bullet lines only.

   If subagents are unavailable, say so in the standdown under Blocked and fall
   back to git + board only — do not pretend the thread was read.

3. **Ground in git** (repo root):
   ```bash
   git log --oneline -20
   git status --short
   ```
   Cross-check subagent bullets against commits actually on the branch.

4. **Ground in the board** when MCP is available:
   - Resolve the project per [plandesk](../plandesk/SKILL.md).
   - `list_tasks` filtered to `done` / `in_progress` / `scope` as needed.
   - Note `get_next_task` if it would return something actionable.

5. **Assemble** `.plandesk/standdown.md`. Deduplicate; prefer facts over
   narrative. Reference paths (`runs/result-*.json`, PRDs, ADRs) instead of
   pasting them.

6. **Say it once** to the user — the Shipped and Suggested next sections in
   plain language, one short paragraph. The file is the handoff; the paragraph
   is the standdown.

## Do not

- End on "I'll write the standdown now" — the file must exist before you stop.
- Duplicate entire specs or diffs; link or name them.
- Invent work the subagents or git log did not support.
