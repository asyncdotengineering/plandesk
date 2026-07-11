---
type: curator-skill
version: 1
---

# Curator: triage

Turns raw signal — client submissions, an ungroomed `backlog` column, or a
pasted brain-dump — into board-ready tasks, so the board stays true without
hand-grooming. Source-agnostic: one decision engine, three input adapters.
Uses existing Plan Desk MCP tools only — no new infrastructure.

**Lane: approve** — every proposal lands as a diff against the board; a human
resolves it (the `scope → todo` drag is that resolution — see
[autonomy.md](autonomy.md)).

## When to run this

- Explicitly asked to "triage the backlog" / "triage submissions" / "sort
  this brain-dump".
- From [autonomy.md](autonomy.md)'s loop, or a schedule/event trigger (see
  "Triggers" below).

## Input adapters

Pick a mode, or accept an explicit one from the caller:

| mode | source | when |
| --- | --- | --- |
| `submissions` | `list_submissions(project_id, status: "pending")` | a share/team workflow is pulling client feedback |
| `backlog` | `list_tasks(project_id, status: "backlog")` | solo curation — **the default** when no mode is given |
| `text` | pasted raw text, one item per paragraph/line the caller marks | a brain-dump session |

Each adapter normalizes its items to `{ id, title, body, source_ref }` before
they reach the decision engine — `source_ref` is a submission ID, a task ID,
or `"text:<n>"` for a pasted item (no stable ID exists yet).

## Decision engine

For every normalized item, in order:

1. **Cross-check open work.** Call `list_tasks(project_id)` (all statuses)
   and compare the item against every existing label + description. A match
   is a duplicate if it describes the same problem/outcome, not merely a
   related area — when unsure, prefer `accept-merge` over creating a near-
   duplicate task.
2. **Decide exactly one outcome:**
   - `reject` — noise, already shipped, or out of scope for this project.
     Leave the source untouched; for a submission, do not call
     `triage_submission` (rejecting is a human call unless the item is
     unambiguous spam/duplicate-of-duplicate — when in doubt, prefer
     `pending` over `reject`).
   - `accept-new` — genuinely new work. Draft a task in house style (see
     below) and `create_task(status: "scope", ...)`. **Never `status:
     "todo"`** — the human's `scope → todo` release is the approval gate,
     full stop.
   - `accept-merge` — duplicate of an existing task. For a submission, call
     `triage_submission({ submission_id, action: "accept", link_task_id })`.
     For a backlog/text item with no submission record, add a comment to the
     target task noting the source and leave the backlog task in place with a
     comment pointing at the survivor (do not delete — there is no delete tool
     by design).
   - **Ambiguous or high-severity** — do not force a decision. Leave the
     source `pending` (or the backlog task untouched) and post a proposal
     comment describing the fork; a human decides. Never silently drop an
     item — every item gets a decision or an explicit "needs a human" note.
3. **Draft in house style** (for `accept-new`): imperative, outcome-focused
   label ("Verb Noun in Location"); description with **Problem** / **Action
   Items** / **References** sections (reference class/method names, never
   line numbers — see `.plandesk/skill.md`); assign `tags` for area, plus a
   `lane` (`auto` / `approve` / `full`, see `.agents/factory/lanes.md`) and a
   `severity` (`low` / `medium` / `high`) chosen by blast radius, both
   recorded as tags since tasks have no dedicated severity field yet.
4. **Attach provenance.** Every `accept-new` or `accept-merge` decision
   carries `{ sources: [source_ref, ...], reason: "<why>" }`:
   - A one-line provenance summary as the first line of the task
     description's **References** section (or appended to the existing
     task's description for a merge): `Provenance: <decision> — <reason>
     (source: <source_ref>[, <source_ref>...])`.
   - The full detail as a comment on the task (via `add_comment` on the
     task's linked document if one exists, otherwise as a project note
     referencing the task) — this is the audit trail; the description line
     is the at-a-glance. See [provenance.md](provenance.md) for the
     authoritative convention.
5. **Emit a reasoning comment per decision** — even for `reject` and
   `pending` — so the drift and its fix are traceable later. Use
   `add_comment` on the linked document when the task has one; otherwise
   record the decision in a project note titled "Curator triage — <date>"
   and reference it from the task/submission.

## Dedup precision — start conservative

If dedup precision on real data is unacceptable, keep `accept-merge`
**propose-only** (a comment naming the suspected duplicate, decision left
`pending` for a human) rather than raising autonomy. Widen only once you have
evidence the matching is reliable.

## Contract (for callers / the autonomy loop)

```
triage(mode?: "submissions" | "backlog" | "text", items?: string)
  → for each normalized item:
      { decision: "reject" | "accept-new" | "accept-merge" | "pending",
        draft?: { label, description, tags, lane, severity },
        link_task_id?: string,
        provenance: { sources: string[], reason: string } }
```

- `status: "todo"` is never a valid output of this skill.
- A run that touches zero items (empty backlog / no pending submissions) is
  a no-op — report "nothing to triage", do not fabricate work.

## Triggers

The Curator is only "auto" if it runs without a human opening the app. See
[automation.md](automation.md) for how this skill is wired to a schedule and
to board events (new submission, task → `backlog`), and for the confidence
gate that decides `scope` (auto) vs `pending` (proposal comment, no board
write) per item.

## References

[autonomy.md](autonomy.md) (the loop that invokes this, and the human-gate
rule); [provenance.md](provenance.md) (the provenance shape every non-reject
decision carries); [automation.md](automation.md) (unattended triggers);
`.plandesk/skill.md` (house task conventions); `.agents/factory/lanes.md`
(lane vocabulary).
