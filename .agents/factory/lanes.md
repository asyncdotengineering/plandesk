---
type: lanes
---

# Risk lanes

Every work item gets a lane at intake, decided by blast radius. Gates are
loosened per lane only when the metrics ledger justifies it — cite the
evidence when you loosen one.

| lane    | applies to                                      | gate                                                           |
| ------- | ----------------------------------------------- | -------------------------------------------------------------- |
| auto    | isolated, low-blast-radius changes (copy, docs) | proof + verifiers only — no human                              |
| approve | routine feature work                            | diff summary posted as a comment; the gate-resolver clears it  |
| full    | schema, infra, auth, public contracts           | independent cross-family review, then the gate-resolver clears |

Whoever releases or merges a change owns the outcome.

**A task with no lane recorded is `approve`, never `auto`.** Simplicity is not
a lane assignment — treat an unlaned task as `approve` until a human or
[scope-work](../skills/plandesk-scope-work/SKILL.md) assigns one.

## Who resolves a gate — and the human override

The gates above name *what* must be satisfied, not *who* satisfies it.

- **Attended** (a human is in the session): the human resolves `approve` and
  `full` gates, and a skill running without an explicit autonomous posture
  waits for them.
- **Unattended** under [plandesk-autonomy](../skills/plandesk-autonomy/SKILL.md):
  the agent may resolve an `approve` or `full` gate and release `scope` → `todo`
  itself — **only** with the reasoning chain posted as a comment first (what
  "done" means here, what the lane requires, what verification ran, what would
  falsify the verdict). A `full` lane still requires an independent review pass
  by a different model family ([routing.md](routing.md)), never the author's
  own read-back.
- **The human is always the override.** Every gate resolution — theirs or the
  agent's — lives as a comment on the board, and that comment is the override
  surface: a human may reverse an agent-resolved gate, re-open the task, or
  revert the commit, and an explicit human instruction supersedes any
  agent-made gate decision on the spot. Agent resolution exists to keep the
  line moving, not to remove the human's authority — which is why nothing is
  ever **merged** to a protected branch, and no gate decision is left
  uncommented, without a human able to see and undo it.

[plandesk-autonomy](../skills/plandesk-autonomy/SKILL.md) is the authority on
when unattended resolution applies. Do not restate its conditions elsewhere — a
permission copied into a second file is a permission that drifts out of sync
with the first, which is exactly how this section came to exist.

## At intake

Assign each task a lane from this file at creation. Then stop. Intake scaffolds;
it does not execute the plan unless the human explicitly asked for that in the
same request — a boundary that holds regardless of who may release, because it
is about not conflating planning with building.
