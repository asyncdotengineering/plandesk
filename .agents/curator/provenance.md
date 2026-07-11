---
type: curator-skill
version: 1
---

# Curator: provenance convention

The authoritative shape for "why does this task exist" — required output of
every [triage.md](triage.md) decision that isn't `reject`. Automated triage is
only trustworthy if every decision traces to its source: a task nobody can
explain back to a request is exactly the vacuous structure the board exists to
avoid — observation over assertion.

## What must be recorded

For every `accept-new`, `accept-merge`, or promotion decision:

```
{ sources: string[], reason: string }
```

- `sources` — the item ID(s) that led to this decision: a submission ID, a
  backlog task ID, `"text:<n>"` for a brain-dump line, or another task's ID
  when the decision merged one item into it. Always plural-capable — a merge
  of three duplicate reports into one task lists all three.
- `reason` — a one-clause, human-legible justification: *why* this became a
  task, or *why* it was merged rather than created new, or *why* it was
  promoted (e.g. severity). Not a restatement of the label.

## Dual storage

Both, always — they serve different readers:

1. **Description line** (at-a-glance, travels with the card): the first
   line of the task's **References** section —
   ```
   Provenance: <accept-new|accept-merge> — <reason> (source: <id>[, <id>...])
   ```
   A human scanning the board's `scope` column sees this without opening
   anything.
2. **Pinned detail** (the audit trail, full context): a comment via
   `add_comment` on the task's linked document if it has one; otherwise a
   project note titled `Curator triage — <date>` that lists every decision
   made in that triage run, cross-referenced from each affected task's
   description (`See note "Curator triage — <date>" for full context.`).
   Batch multiple decisions from the same run into one note rather than one
   note per task — it reads as a session log, not board clutter.

## Where this applies

- `.agents/curator/triage.md` — every `accept-new`/`accept-merge` decision,
  no exceptions; a decision missing provenance is an invalid triage output.
- `.agents/curator/automation.md` — scheduled/event-triggered runs carry the
  same requirement; an automated run is not exempt because a human wasn't
  watching it happen.
- Any future promotion logic (e.g. a `backlog → scope` auto-promotion) — the
  same `{sources, reason}` shape applies to promotions, not just creations.

## Non-goals

- No new schema/field — this rides on existing `description` + `add_comment`
  + `create_note`. Do not propose a dedicated `provenance` column; provenance
  is a courtesy to the reviewer, not a stored primitive.
- No cryptographic/immutable audit log — a human can edit a task description
  after the fact like anything else on the board.

## References

[triage.md](triage.md) (the only current producer of provenance);
`.plandesk/skill.md` (house task + note conventions).
